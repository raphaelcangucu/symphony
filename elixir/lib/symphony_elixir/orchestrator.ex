defmodule SymphonyElixir.Orchestrator do
  @moduledoc """
  Polls the issue tracker and dispatches repository copies to agent-backed workers.
  """

  use GenServer
  require Logger
  import Bitwise, only: [<<<: 2]

  alias SymphonyElixir.{
    AgentExecution,
    AgentRunner,
    Config,
    Issue,
    ProjectConfig,
    Repo,
    RunContract,
    StatusDashboard,
    Tracker,
    Workspace
  }

  alias SymphonyElixir.Evidence
  alias SymphonyElixir.GitHub.IssueMarker
  alias SymphonyElixir.LocalTracker.{Context, Repository}
  alias SymphonyElixir.Orchestrator.Grouping
  alias SymphonyElixir.PublicRouting
  alias SymphonyElixir.PushNotifications.Dispatcher, as: PushDispatcher
  alias SymphonyElixir.RunContract.Finalizer
  alias SymphonyElixir.Settings.Orchestration, as: OrchestrationSettings
  alias SymphonyElixir.Tracker.Sync.LocalStore

  @incomplete_run_label "symphony:incomplete"
  @blocked_run_label "symphony:blocked"

  @continuation_retry_delay_ms 1_000
  @failure_retry_base_ms 10_000
  # Slightly above the dashboard render interval so "checking now…" can render.
  @poll_transition_render_delay_ms 20
  @empty_agent_totals %{
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    seconds_running: 0
  }

  defmodule State do
    @moduledoc """
    Runtime state for the orchestrator polling loop.
    """

    defstruct [
      :poll_interval_ms,
      :max_concurrent_agents,
      :next_poll_due_at_ms,
      :poll_check_in_progress,
      running: %{},
      completed: MapSet.new(),
      claimed: MapSet.new(),
      retry_attempts: %{},
      agent_totals: nil,
      agent_totals_by_project: %{},
      agent_rate_limits: nil,
      publish_contract_deps: nil
    ]
  end

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    warn_on_invalid_config()

    now_ms = System.monotonic_time(:millisecond)

    state = %State{
      poll_interval_ms: Config.poll_interval_ms(),
      max_concurrent_agents: Config.max_concurrent_agents(),
      next_poll_due_at_ms: now_ms,
      poll_check_in_progress: false,
      agent_totals: @empty_agent_totals,
      agent_totals_by_project: %{},
      agent_rate_limits: nil,
      publish_contract_deps: Keyword.get(opts, :publish_contract_deps)
    }

    run_terminal_workspace_cleanup()
    :ok = schedule_tick(0)

    {:ok, state}
  end

  @impl true
  def handle_info(:tick, state) do
    state = refresh_runtime_config(state)
    state = %{state | poll_check_in_progress: true, next_poll_due_at_ms: nil}

    notify_dashboard()
    :ok = schedule_poll_cycle_start()
    {:noreply, state}
  end

  def handle_info(:run_poll_cycle, state) do
    state = refresh_runtime_config(state)
    state = maybe_dispatch(state)
    now_ms = System.monotonic_time(:millisecond)
    next_poll_due_at_ms = now_ms + state.poll_interval_ms
    :ok = schedule_tick(state.poll_interval_ms)

    state = %{state | poll_check_in_progress: false, next_poll_due_at_ms: next_poll_due_at_ms}

    notify_dashboard()
    {:noreply, state}
  end

  def handle_info(
        {:DOWN, ref, :process, _pid, reason},
        %{running: running} = state
      ) do
    case find_issue_id_for_ref(running, ref) do
      nil ->
        {:noreply, state}

      issue_id ->
        {running_entry, state} = pop_running_entry(state, issue_id)
        state = record_session_completion_totals(state, running_entry)
        session_id = running_entry_session_id(running_entry)

        state =
          case reason do
            :normal ->
              Logger.info("Agent task completed for issue_id=#{issue_id} session_id=#{session_id}; checking completion transition")

              apply_normal_completion(state, running_entry, issue_id)

            _ ->
              Logger.warning("Agent task exited for issue_id=#{issue_id} session_id=#{session_id} reason=#{inspect(reason)}; scheduling retry")

              next_attempt = next_retry_attempt_from_running(running_entry)

              schedule_issue_retry(state, issue_id, next_attempt, %{
                identifier: running_entry.identifier,
                project_slug: running_entry.issue.project_slug,
                error: AgentExecution.format_failure(reason)
              })
          end

        Logger.info("Agent task finished for issue_id=#{issue_id} session_id=#{session_id} reason=#{inspect(reason)}")

        notify_dashboard()
        {:noreply, state}
    end
  end

  def handle_info(
        {:codex_worker_update, issue_id, %{event: _, timestamp: _} = update},
        %{running: running} = state
      ) do
    case Map.get(running, issue_id) do
      nil ->
        {:noreply, state}

      running_entry ->
        {updated_running_entry, token_delta} = integrate_codex_update(running_entry, update)

        state =
          state
          |> apply_codex_token_delta(running_entry_project_slug(running_entry), token_delta)
          |> apply_agent_rate_limits(update)

        notify_dashboard()
        {:noreply, %{state | running: Map.put(running, issue_id, updated_running_entry)}}
    end
  end

  def handle_info({:codex_worker_update, _issue_id, _update}, state), do: {:noreply, state}

  def handle_info({:agent_outcome, issue_id, outcome}, %{running: running} = state) do
    case Map.get(running, issue_id) do
      nil ->
        {:noreply, state}

      running_entry ->
        updated = Map.put(running_entry, :agent_outcome, outcome)
        {:noreply, %{state | running: Map.put(running, issue_id, updated)}}
    end
  end

  def handle_info({:retry_issue, issue_id}, state) do
    result =
      case pop_retry_attempt_state(state, issue_id) do
        {:ok, attempt, metadata, state} -> handle_retry_issue(state, issue_id, attempt, metadata)
        :missing -> {:noreply, state}
      end

    notify_dashboard()
    result
  end

  def handle_info(msg, state) do
    Logger.debug("Orchestrator ignored message: #{inspect(msg)}")
    {:noreply, state}
  end

  defp warn_on_invalid_config do
    # Multi-project orchestration validates each project's config independently
    # (at save via parse_workflow_markdown and at resolve). There is no global
    # WORKFLOW.md to validate here, so only the legacy single-tracker mode runs
    # the global validation.
    if Config.tracker_sync_enabled?() do
      :ok
    else
      warn_on_invalid_global_config()
    end
  end

  defp warn_on_invalid_global_config do
    case Config.validate!() do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Configuration warning: #{reason}")

        IO.puts(
          :stderr,
          IO.ANSI.yellow() <>
            IO.ANSI.bright() <>
            "\n⚠  Configuration warning: #{reason}\n" <>
            IO.ANSI.reset()
        )
    end
  end

  defp maybe_dispatch(%State{} = state) do
    # Non-forced so the engine's per-project pull gate (tracker_sync_min_pull_ms)
    # coalesces remote pulls; the poll still flushes queued outbox writes.
    SymphonyElixir.Tracker.Sync.Engine.request_sync()
    state = reconcile_running_issues(state)

    with :ok <- global_config_gate(),
         {:ok, issues} <- Tracker.fetch_candidate_issues(),
         true <- available_slots(state) > 0 do
      choose_issues(issues, state)
    else
      {:error, reason} when is_binary(reason) ->
        Logger.error(reason)
        state

      {:error, reason} ->
        Logger.error("Failed to fetch from tracker: #{inspect(reason)}")
        state

      false ->
        state
    end
  end

  @doc false
  @spec global_config_gate_for_test() :: :ok | {:error, term()}
  def global_config_gate_for_test, do: global_config_gate()

  # In the global-less, multi-project orchestration model (`tracker_sync_enabled?`)
  # each project's config is validated in isolation by the tracker reader and
  # `dispatch_decision/1`. A misconfigured GLOBAL tracker (e.g. a linear
  # `WORKFLOW.md` without an API key) must therefore NOT abort the dispatch loop
  # for every project. Only the legacy single-global-tracker mode gates the whole
  # loop on `Config.validate!/0`.
  defp global_config_gate do
    if Config.tracker_sync_enabled?() do
      :ok
    else
      Config.validate!()
    end
  end

  defp reconcile_running_issues(%State{} = state) do
    state = reconcile_stalled_running_issues(state)
    running_ids = Map.keys(state.running)

    if running_ids == [] do
      state
    else
      case Tracker.fetch_issue_states_by_ids(running_ids) do
        {:ok, issues} ->
          reconcile_running_issue_states(issues, state)

        {:error, reason} ->
          Logger.debug("Failed to refresh running issue states: #{inspect(reason)}; keeping active workers")

          state
      end
    end
  end

  @doc false
  @spec reconcile_issue_states_for_test([Issue.t()], term()) :: term()
  def reconcile_issue_states_for_test(issues, %State{} = state) when is_list(issues) do
    reconcile_running_issue_states(issues, state)
  end

  def reconcile_issue_states_for_test(issues, state) when is_list(issues) do
    reconcile_running_issue_states(issues, state)
  end

  @doc false
  @spec should_manual_dispatch_issue_for_test(Issue.t()) :: boolean()
  def should_manual_dispatch_issue_for_test(%Issue{} = issue) do
    manual_dispatch_candidate?(issue)
  end

  @doc false
  @spec should_dispatch_issue_for_test(Issue.t(), term()) :: boolean()
  def should_dispatch_issue_for_test(%Issue{} = issue, %State{} = state) do
    sets = project_state_sets(issue)
    should_dispatch_issue?(issue, state, dispatch_set(sets), terminal_set(sets))
  end

  @doc false
  @spec revalidate_issue_for_dispatch_for_test(Issue.t(), ([String.t()] -> term())) ::
          {:ok, Issue.t()} | {:skip, Issue.t() | :missing} | {:error, term()}
  def revalidate_issue_for_dispatch_for_test(%Issue{} = issue, issue_fetcher)
      when is_function(issue_fetcher, 1) do
    revalidate_issue_for_dispatch(issue, issue_fetcher)
  end

  @doc false
  @spec sort_issues_for_dispatch_for_test([Issue.t()]) :: [Issue.t()]
  def sort_issues_for_dispatch_for_test(issues) when is_list(issues) do
    sort_issues_for_dispatch(issues)
  end

  defp reconcile_running_issue_states(issues, state) do
    returned_ids = MapSet.new(issues, & &1.id)

    missing_ids =
      state.running
      |> Map.keys()
      |> Enum.reject(&MapSet.member?(returned_ids, &1))

    state =
      Enum.reduce(issues, state, fn issue, state_acc ->
        sets = project_state_sets(issue)
        reconcile_issue_state(issue, state_acc, active_set(sets), terminal_set(sets))
      end)

    terminate_missing_running_issues(state, missing_ids)
  end

  defp terminate_missing_running_issues(%State{} = state, []), do: state

  defp terminate_missing_running_issues(%State{} = state, missing_ids) do
    Enum.reduce(missing_ids, state, fn issue_id, state_acc ->
      case Map.get(state_acc.running, issue_id) do
        nil ->
          state_acc

        %{identifier: identifier} = _running_entry ->
          Logger.info("Issue no longer visible, stopping active agent issue_id=#{issue_id} issue_identifier=#{identifier || issue_id}")

          terminate_running_issue(state_acc, issue_id, true)

        _running_entry ->
          Logger.info("Issue no longer visible, stopping active agent issue_id=#{issue_id}")
          terminate_running_issue(state_acc, issue_id, true)
      end
    end)
  end

  defp reconcile_issue_state(%Issue{} = issue, state, active_states, terminal_states) do
    cond do
      terminal_issue_state?(issue.state, terminal_states) ->
        Logger.info("Issue moved to terminal state: #{issue_context(issue)} state=#{issue.state}; stopping active agent")

        terminate_running_issue(state, issue.id, true)

      !issue_routable_to_worker?(issue) ->
        Logger.info("Issue no longer routed to this worker: #{issue_context(issue)} assignee=#{inspect(issue.assignee_id)}; stopping active agent")

        terminate_running_issue(state, issue.id, false)

      active_issue_state?(issue.state, active_states) ->
        refresh_running_issue_state(state, issue)

      true ->
        Logger.info("Issue moved to non-active state: #{issue_context(issue)} state=#{issue.state}; stopping active agent")

        terminate_running_issue(state, issue.id, false)
    end
  end

  defp reconcile_issue_state(_issue, state, _active_states, _terminal_states), do: state

  defp refresh_running_issue_state(%State{} = state, %Issue{} = issue) do
    case Map.get(state.running, issue.id) do
      %{issue: _} = running_entry ->
        %{state | running: Map.put(state.running, issue.id, %{running_entry | issue: issue})}

      _ ->
        state
    end
  end

  defp terminate_running_issue(%State{} = state, issue_id, cleanup_workspace) do
    case Map.get(state.running, issue_id) do
      nil ->
        release_issue_claim(state, issue_id)

      %{pid: pid, ref: ref, identifier: identifier} = running_entry ->
        state = record_session_completion_totals(state, running_entry)

        if cleanup_workspace do
          cleanup_issue_workspace(identifier)
        end

        if is_pid(pid) do
          terminate_task(pid)
        end

        if is_reference(ref) do
          Process.demonitor(ref, [:flush])
        end

        %{
          state
          | running: Map.delete(state.running, issue_id),
            claimed: MapSet.delete(state.claimed, issue_id),
            retry_attempts: Map.delete(state.retry_attempts, issue_id)
        }

      _ ->
        release_issue_claim(state, issue_id)
    end
  end

  defp reconcile_stalled_running_issues(%State{} = state) do
    timeout_ms = Config.agent_stall_timeout_ms()

    cond do
      timeout_ms <= 0 ->
        state

      map_size(state.running) == 0 ->
        state

      true ->
        now = DateTime.utc_now()

        Enum.reduce(state.running, state, fn {issue_id, running_entry}, state_acc ->
          restart_stalled_issue(state_acc, issue_id, running_entry, now, timeout_ms)
        end)
    end
  end

  defp restart_stalled_issue(state, issue_id, running_entry, now, timeout_ms) do
    elapsed_ms = stall_elapsed_ms(running_entry, now)

    if is_integer(elapsed_ms) and elapsed_ms > timeout_ms do
      identifier = Map.get(running_entry, :identifier, issue_id)
      session_id = running_entry_session_id(running_entry)

      Logger.warning("Issue stalled: issue_id=#{issue_id} issue_identifier=#{identifier} session_id=#{session_id} elapsed_ms=#{elapsed_ms}; restarting with backoff")

      next_attempt = next_retry_attempt_from_running(running_entry)

      state
      |> terminate_running_issue(issue_id, false)
      |> schedule_issue_retry(issue_id, next_attempt, %{
        identifier: identifier,
        project_slug: running_entry.issue.project_slug,
        error: "stalled for #{elapsed_ms}ms without codex activity"
      })
    else
      state
    end
  end

  defp stall_elapsed_ms(running_entry, now) do
    running_entry
    |> last_activity_timestamp()
    |> case do
      %DateTime{} = timestamp ->
        max(0, DateTime.diff(now, timestamp, :millisecond))

      _ ->
        nil
    end
  end

  defp last_activity_timestamp(running_entry) when is_map(running_entry) do
    Map.get(running_entry, :last_codex_timestamp) || Map.get(running_entry, :started_at)
  end

  defp last_activity_timestamp(_running_entry), do: nil

  defp terminate_task(pid) when is_pid(pid) do
    case Task.Supervisor.terminate_child(SymphonyElixir.Orchestrator.TaskSupervisor, pid) do
      :ok ->
        :ok

      {:error, :not_found} ->
        Process.exit(pid, :shutdown)
    end
  end

  defp terminate_task(_pid), do: :ok

  defp choose_issues(issues, state) do
    issues
    |> Grouping.dispatch_candidates()
    |> sort_issues_for_dispatch()
    |> Enum.reduce(state, fn issue, acc -> maybe_dispatch_candidate(acc, issue, issues) end)
  end

  defp maybe_dispatch_candidate(state, issue, all_issues) do
    case dispatch_decision(issue) do
      {:ok, sets} ->
        members = Grouping.members_for(issue, all_issues)

        if should_dispatch_issue?(issue, state, dispatch_set(sets), terminal_set(sets)) and
             not any_member_blocked?(members, terminal_set(sets)) do
          dispatch_issue(state, issue, nil, members)
        else
          state
        end

      {:skip, reason} ->
        Logger.warning("Skipping dispatch; project not runnable for #{issue_context(issue)}: #{reason}")
        state
    end
  end

  defp any_member_blocked?(members, terminal_states) when is_list(members) do
    Enum.any?(members, &issue_blocked_by_non_terminal?(&1, terminal_states))
  end

  defp sort_issues_for_dispatch(issues) when is_list(issues) do
    Enum.sort_by(issues, fn
      %Issue{} = issue ->
        {priority_rank(issue.priority), issue_created_at_sort_key(issue), issue.identifier || issue.id || ""}

      _ ->
        {priority_rank(nil), issue_created_at_sort_key(nil), ""}
    end)
  end

  defp priority_rank(priority) when is_integer(priority) and priority in 1..4, do: priority
  defp priority_rank(_priority), do: 5

  defp issue_created_at_sort_key(%Issue{created_at: %DateTime{} = created_at}) do
    DateTime.to_unix(created_at, :microsecond)
  end

  defp issue_created_at_sort_key(%Issue{}), do: 9_223_372_036_854_775_807
  defp issue_created_at_sort_key(_issue), do: 9_223_372_036_854_775_807

  defp should_dispatch_issue?(
         %Issue{} = issue,
         %State{running: running, claimed: claimed} = state,
         active_states,
         terminal_states
       ) do
    candidate_issue?(issue, active_states, terminal_states) and
      !issue_blocked_by_non_terminal?(issue, terminal_states) and
      !MapSet.member?(claimed, issue.id) and
      !Map.has_key?(running, issue.id) and
      available_slots(state) > 0 and
      state_slots_available?(issue, running)
  end

  defp should_dispatch_issue?(_issue, _state, _active_states, _terminal_states), do: false

  defp state_slots_available?(%Issue{state: issue_state}, running) when is_map(running) do
    limit = Config.max_concurrent_agents_for_state(issue_state)
    used = running_issue_count_for_state(running, issue_state)
    limit > used
  end

  defp state_slots_available?(_issue, _running), do: false

  defp running_issue_count_for_state(running, issue_state) when is_map(running) do
    normalized_state = normalize_issue_state(issue_state)

    Enum.count(running, fn
      {_id, %{issue: %Issue{state: state_name}}} ->
        normalize_issue_state(state_name) == normalized_state

      _ ->
        false
    end)
  end

  defp candidate_issue?(
         %Issue{
           id: id,
           identifier: identifier,
           title: title,
           state: state_name
         } = issue,
         active_states,
         terminal_states
       )
       when is_binary(id) and is_binary(identifier) and is_binary(title) and is_binary(state_name) do
    issue_admitted_by_label?(issue) and
      active_issue_state?(state_name, active_states) and
      !terminal_issue_state?(state_name, terminal_states)
  end

  defp candidate_issue?(_issue, _active_states, _terminal_states), do: false

  # When the `require_symphony_label` setting is on (default), only issues whose
  # labels admit a Symphony agent are auto-dispatched. When off, the label gate
  # is bypassed and any active, assigned issue is eligible.
  defp issue_admitted_by_label?(%Issue{} = issue) do
    not OrchestrationSettings.require_symphony_label?() or issue_routable_to_worker?(issue)
  end

  defp issue_routable_to_worker?(%Issue{assigned_to_worker: assigned_to_worker})
       when is_boolean(assigned_to_worker),
       do: assigned_to_worker

  defp issue_routable_to_worker?(_issue), do: true

  defp issue_blocked_by_non_terminal?(%Issue{blocked_by: blockers}, terminal_states) when is_list(blockers) do
    Enum.any?(blockers, fn
      %{state: blocker_state} when is_binary(blocker_state) ->
        !terminal_issue_state?(blocker_state, terminal_states)

      _ ->
        true
    end)
  end

  defp issue_blocked_by_non_terminal?(_issue, _terminal_states), do: false

  defp terminal_issue_state?(state_name, terminal_states) when is_binary(state_name) do
    MapSet.member?(terminal_states, normalize_issue_state(state_name))
  end

  defp terminal_issue_state?(_state_name, _terminal_states), do: false

  defp active_issue_state?(state_name, active_states) when is_binary(state_name) do
    MapSet.member?(active_states, normalize_issue_state(state_name))
  end

  defp active_issue_state?(_state_name, _active_states), do: false

  defp normalize_issue_state(state_name) when is_binary(state_name) do
    String.downcase(String.trim(state_name))
  end

  # Per-project state classification (global-less): each issue is evaluated
  # against its OWN project's configured active/dispatch/terminal states. Issues
  # without a resolvable project fall back to the code-default states.
  #
  # The resolver returns normalized state *lists* in a `{active, dispatch,
  # terminal}` tuple; the `*_set/1` accessors build the MapSet fresh at the point
  # of use. Routing plain lists (not MapSets) through the tuple avoids breaking
  # the opaque MapSet type that membership checks rely on.
  defp project_state_sets(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case resolve_project_for_states(slug) do
      {:ok, config} -> state_lists_from_config(config)
      :error -> global_state_lists()
    end
  end

  defp project_state_sets(_issue), do: global_state_lists()

  defp global_state_lists do
    {normalize_states(Config.active_states()), normalize_states(Config.dispatch_states()), normalize_states(Config.terminal_states())}
  end

  defp state_lists_from_config(%ProjectConfig{} = config) do
    {
      normalize_states(config.active_states || Config.active_states()),
      normalize_states(config.dispatch_states || Config.dispatch_states()),
      normalize_states(config.terminal_states || Config.terminal_states())
    }
  end

  defp normalize_states(states) when is_list(states) do
    states |> Enum.map(&normalize_issue_state/1) |> Enum.filter(&(&1 != ""))
  end

  defp normalize_states(_states), do: []

  defp active_set({active, _dispatch, _terminal}), do: MapSet.new(active)
  defp dispatch_set({_active, dispatch, _terminal}), do: MapSet.new(dispatch)
  defp terminal_set({_active, _dispatch, terminal}), do: MapSet.new(terminal)

  defp resolve_project_for_states(slug) do
    case Context.get_project(slug) do
      {:ok, project} -> {:ok, project |> Repo.preload(:setup) |> ProjectConfig.resolve()}
      _ -> :error
    end
  end

  # Resolves the dispatch decision for a candidate issue: its per-project state
  # sets, or a skip signal when the issue's project cannot run on its own (no
  # prompt / no tracker identity). Issues without a project fall back to global.
  defp dispatch_decision(%Issue{project_slug: slug} = _issue) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        case project |> Repo.preload(:setup) |> ProjectConfig.resolve_runnable() do
          {:ok, config} -> {:ok, state_lists_from_config(config)}
          {:skip, reason} -> {:skip, reason}
        end

      _ ->
        {:ok, global_state_lists()}
    end
  end

  defp dispatch_decision(_issue), do: {:ok, global_state_lists()}

  defp dispatch_issue(%State{} = state, issue, attempt, members) do
    case revalidate_issue_for_dispatch(issue, &Tracker.fetch_issue_states_by_ids/1) do
      {:ok, %Issue{} = refreshed_issue} ->
        do_dispatch_issue(state, refreshed_issue, attempt, members)

      {:skip, :missing} ->
        Logger.info("Skipping dispatch; issue no longer active or visible: #{issue_context(issue)}")
        state

      {:skip, %Issue{} = refreshed_issue} ->
        Logger.info("Skipping stale dispatch after issue refresh: #{issue_context(refreshed_issue)} state=#{inspect(refreshed_issue.state)} blocked_by=#{length(refreshed_issue.blocked_by)}")

        state

      {:error, reason} ->
        Logger.warning("Skipping dispatch; issue refresh failed for #{issue_context(issue)}: #{inspect(reason)}")
        state
    end
  end

  defp do_dispatch_issue(%State{} = state, issue, attempt, members) do
    recipient = self()
    issue = Tracker.enrich_issue(issue)
    agent_kind = AgentRunner.issue_agent_kind(issue)

    case Task.Supervisor.start_child(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
           AgentRunner.run(issue, recipient, attempt: attempt, members: members)
         end) do
      {:ok, pid} ->
        ref = Process.monitor(pid)

        Logger.info("Dispatching #{if members == [], do: "issue", else: "group"} to agent: #{issue_context(issue)} members=#{length(members)} pid=#{inspect(pid)} attempt=#{inspect(attempt)}")

        running = Map.put(state.running, issue.id, dispatch_running_entry(pid, ref, issue, agent_kind, attempt, members))

        claimed =
          issue
          |> Grouping.claim_ids(members)
          |> Enum.reduce(state.claimed, fn id, acc -> MapSet.put(acc, id) end)

        %{state | running: running, claimed: claimed, retry_attempts: Map.delete(state.retry_attempts, issue.id)}

      {:error, reason} ->
        Logger.error("Unable to spawn agent for #{issue_context(issue)}: #{inspect(reason)}")
        next_attempt = if is_integer(attempt), do: attempt + 1, else: nil

        schedule_issue_retry(state, issue.id, next_attempt, %{
          identifier: issue.identifier,
          project_slug: issue.project_slug,
          error: "failed to spawn agent: #{inspect(reason)}"
        })
    end
  end

  defp dispatch_running_entry(pid, ref, %Issue{} = issue, agent_kind, attempt, members) do
    %{
      pid: pid,
      ref: ref,
      identifier: issue.identifier,
      issue: issue,
      members: members,
      agent_kind: agent_kind,
      agent_goal: Map.get(issue, :agent_goal),
      goal: nil,
      session_id: nil,
      last_codex_message: nil,
      last_codex_timestamp: nil,
      last_codex_event: nil,
      codex_app_server_pid: nil,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      codex_last_reported_input_tokens: 0,
      codex_last_reported_output_tokens: 0,
      codex_last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: normalize_retry_attempt(attempt),
      started_at: DateTime.utc_now()
    }
  end

  defp revalidate_issue_for_dispatch(%Issue{id: issue_id}, issue_fetcher)
       when is_binary(issue_id) and is_function(issue_fetcher, 1) do
    case issue_fetcher.([issue_id]) do
      {:ok, [%Issue{} = refreshed_issue | _]} ->
        if retry_candidate_issue?(refreshed_issue) do
          {:ok, refreshed_issue}
        else
          {:skip, refreshed_issue}
        end

      {:ok, []} ->
        {:skip, :missing}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp revalidate_issue_for_dispatch(issue, _issue_fetcher), do: {:ok, issue}

  defp complete_issue(%State{} = state, issue_id) do
    %{
      state
      | completed: MapSet.put(state.completed, issue_id),
        retry_attempts: Map.delete(state.retry_attempts, issue_id)
    }
  end

  defp apply_normal_completion(%State{} = state, running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:error, reason} ->
        Logger.warning("Agent run failed for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier} reason=#{inspect(reason)}; scheduling retry")

        next_attempt = next_retry_attempt_from_running(running_entry)

        schedule_issue_retry(state, issue_id, next_attempt, %{
          identifier: running_entry.identifier,
          project_slug: running_entry.issue.project_slug,
          error: AgentExecution.format_failure(reason)
        })

      _other ->
        apply_successful_completion(state, running_entry, issue_id)
    end
  end

  defp apply_successful_completion(%State{} = state, running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:incomplete, {:validate_gate, _violations}} ->
        Logger.warning("Validate gate incomplete for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier}; skipping completion transition")

        maybe_annotate_incomplete(running_entry, issue_id)
        complete_issue(state, issue_id)

      {:incomplete, {:publish_gate, _violations}} ->
        Logger.warning("Publish gate incomplete for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier}; skipping completion transition")

        maybe_annotate_incomplete(running_entry, issue_id)
        complete_issue(state, issue_id)

      _other ->
        apply_gated_successful_completion(state, running_entry, issue_id)
    end
  end

  defp apply_gated_successful_completion(%State{} = state, running_entry, issue_id) do
    issue = running_entry.issue
    workspace = Workspace.path_for_issue(issue)
    deps = publish_contract_deps_for(issue, state.publish_contract_deps)

    case run_publish_contract(issue, workspace, deps) do
      {:ok, prs} ->
        remove_label(running_entry, @blocked_run_label)
        record_run_pull_requests(issue, prs)
        Enum.each(Map.get(running_entry, :members, []), &record_run_pull_requests(&1, prs))
        persist_evidence(running_entry, issue, workspace)
        maybe_annotate_incomplete(running_entry, issue_id)
        apply_transition_after_contract(state, running_entry, issue_id)

      {:blocked, violations, reason} ->
        Logger.warning("Run blocked for issue_id=#{issue_id} issue_identifier=#{issue.identifier} reason=#{inspect(reason)}; skipping completion transition")

        annotate_blocked(running_entry, issue_id, violations)
        complete_issue(state, issue_id)
    end
  end

  @doc false
  @spec run_publish_contract(Issue.t(), Path.t(), map()) ::
          {:ok, [map()]} | {:blocked, [map()], term()}
  def run_publish_contract(%Issue{} = issue, workspace, deps) do
    repo_states = deps.repo_states.(workspace)

    case deps.evaluate.(repo_states, deps.pr_checker) do
      :satisfied ->
        {:ok, deps.pull_requests.(repo_states, deps.pr_checker)}

      {:violations, violations} ->
        Logger.warning("Publish contract violated for issue_id=#{issue.id} issue_identifier=#{issue.identifier} violations=#{inspect(violations)}; invoking finalizer")

        finalize_result = deps.finalize.(workspace, issue)
        fresh_states = deps.repo_states.(workspace)

        case deps.evaluate.(fresh_states, deps.pr_checker) do
          :satisfied ->
            {:ok, collect_publish_prs(fresh_states, deps, finalize_result)}

          {:violations, remaining_violations} ->
            {:blocked, remaining_violations, finalize_block_reason(finalize_result, remaining_violations)}
        end
    end
  end

  defp collect_publish_prs(fresh_states, deps, finalize_result) do
    from_checker = deps.pull_requests.(fresh_states, deps.pr_checker)
    from_finalizer = finalize_prs(finalize_result)

    Enum.uniq_by(from_checker ++ from_finalizer, &Map.get(&1, :url))
  end

  defp finalize_prs({:ok, prs}) when is_list(prs), do: prs
  defp finalize_prs({:partial, prs, _failures}) when is_list(prs), do: prs
  defp finalize_prs(_other), do: []

  defp finalize_block_reason({:partial, _prs, failures}, _remaining) when failures != [],
    do: {:partial_failure, failures}

  defp finalize_block_reason(_finalize_result, remaining_violations),
    do: {:gate_still_violated, remaining_violations}

  @doc false
  @spec default_publish_contract_deps() :: map()
  def default_publish_contract_deps do
    %{
      repo_states: &RunContract.repo_states/1,
      evaluate: &RunContract.evaluate_publish/2,
      pull_requests: &RunContract.pull_requests/2,
      finalize: &Finalizer.finalize/2,
      pr_checker: RunContract.gh_pr_checker()
    }
  end

  defp publish_contract_deps_for(%Issue{} = issue, nil), do: publish_contract_deps_for(issue, default_publish_contract_deps())

  defp publish_contract_deps_for(%Issue{} = issue, base) when is_map(base) do
    default_branches = project_repo_default_branches(issue.project_slug)
    marker_key = publish_marker_key(issue)
    identifier = issue.identifier

    Map.merge(base, %{
      repo_states: fn workspace -> RunContract.repo_states(workspace, default_branches: default_branches) end,
      pr_checker: RunContract.gh_pr_checker(issue_identifier: identifier, marker_key: marker_key),
      finalize: fn workspace, iss ->
        Finalizer.finalize(workspace, iss, default_branches: default_branches)
      end
    })
  end

  defp project_repo_default_branches(slug) when is_binary(slug) and slug != "" do
    import Ecto.Query

    case Context.get_project(slug) do
      {:ok, project} ->
        Repository
        |> where([repo], repo.project_id == ^project.id)
        |> Repo.all()
        |> Enum.reduce(%{}, fn repo, acc ->
          branch = repo.default_branch || repo.selected_branch
          key = repo.workspace_path || repo.github_full_name

          if is_binary(key) and is_binary(branch) and branch != "" do
            Map.put(acc, key, branch)
          else
            acc
          end
        end)

      {:error, _} ->
        %{}
    end
  end

  defp project_repo_default_branches(_slug), do: %{}

  defp publish_marker_key(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        ProjectConfig.source_control_issue_marker_key(ProjectConfig.resolve(project))

      _ ->
        IssueMarker.default_key()
    end
  rescue
    _ -> IssueMarker.default_key()
  end

  defp publish_marker_key(_issue), do: IssueMarker.default_key()

  @doc false
  @spec blocked_comment_body([map()]) :: String.t()
  def blocked_comment_body(violations) do
    """
    ## Codex Workpad

    > 🛑 Symphony auto-note: this run is **blocked** — the publish gate could not be
    > satisfied even after corrective turns and the mechanical finalizer.
    >
    #{Enum.map_join(violations, "\n", fn v -> "> - #{v.repo}: #{v.detail}" end)}
    >
    > The issue was NOT moved to review. Fix the underlying problem (auth, remote,
    > branch state), then move the issue back to an active state to re-dispatch.
    """
  end

  defp record_run_pull_requests(%Issue{project_slug: slug, identifier: identifier}, prs)
       when is_binary(slug) and slug != "" and is_binary(identifier) and is_list(prs) and prs != [] do
    marker_key = publish_marker_key(%Issue{project_slug: slug, identifier: identifier})
    verified_prs = Enum.filter(prs, &run_pull_request_matches_issue?(&1, identifier, marker_key))

    case verified_prs do
      [] ->
        if prs != [] do
          Logger.warning("Skipping run PR links issue=#{identifier}: no PR matched Symphony-Issue marker #{marker_key}")
        end

        :ok

      linked ->
        case Context.get_project(slug) do
          {:ok, project} ->
            Enum.each(linked, &persist_run_pull_request(project.id, identifier, &1))

          {:error, error} ->
            Logger.warning("Cannot persist run PR links issue=#{identifier}: project lookup failed #{inspect(error)}")
        end
    end
  end

  defp record_run_pull_requests(_issue, _prs), do: :ok

  defp run_pull_request_matches_issue?(pr, identifier, marker_key) do
    case Map.get(pr, :body) do
      body when is_binary(body) ->
        identifier in IssueMarker.extract(body, marker_key)

      _ ->
        false
    end
  end

  defp persist_run_pull_request(project_id, identifier, pr) do
    case LocalStore.upsert_run_pull_request(project_id, identifier, pr) do
      {:ok, _record} -> :ok
      {:error, error} -> Logger.warning("Failed to persist run PR link issue=#{identifier} url=#{pr[:url]}: #{inspect(error)}")
    end
  end

  defp annotate_blocked(running_entry, issue_id, violations) do
    case Tracker.upsert_workpad(issue_id, blocked_comment_body(violations)) do
      :ok -> :ok
      {:error, error} -> Logger.warning("Failed to post blocked comment issue_id=#{issue_id}: #{inspect(error)}")
    end

    add_label(running_entry, @blocked_run_label)
    PushDispatcher.agent_run_blocked(running_entry.issue, violations)
  end

  # Persists the run's evidence (when the agent produced a valid manifest) and
  # posts a `## Codex Evidence` comment on the issue. Best-effort: evidence
  # absence never blocks the completion flow here (the VALIDATE gate already ran
  # in the agent runner when the project requires evidence).
  defp persist_evidence(running_entry, %Issue{project_slug: slug, identifier: identifier} = issue, workspace)
       when is_binary(slug) and slug != "" and is_binary(identifier) do
    case Evidence.Manifest.read(workspace) do
      {:ok, _manifest} ->
        manifest_map =
          workspace
          |> Evidence.Manifest.dir()
          |> Path.join("manifest.json")
          |> File.read!()
          |> Jason.decode!()

        store_and_comment(running_entry, issue, workspace, manifest_map)

      {:error, _no_manifest} ->
        :ok
    end
  end

  defp persist_evidence(_running_entry, _issue, _workspace), do: :ok

  defp store_and_comment(running_entry, issue, workspace, manifest_map) do
    opts = [session_id: Map.get(running_entry, :session_id)]

    case Evidence.Store.persist(issue.project_slug, issue.identifier, workspace, manifest_map, opts) do
      {:ok, record} ->
        post_evidence_comment(issue, record)
        SymphonyElixir.PushNotifications.Dispatcher.evidence_generated(issue, record)

      {:error, error} ->
        Logger.warning("Failed to persist evidence issue=#{issue.identifier}: #{inspect(error)}")
        :ok
    end
  end

  # One evidence comment per issue, edited in place with the latest run (same
  # pattern as the workpad); the per-attempt history lives in the Evidence tab.
  defp post_evidence_comment(%Issue{id: issue_id} = issue, record) do
    body = evidence_comment_body(record, issue, symphony_base_url())

    case Tracker.upsert_evidence(issue_id, body) do
      :ok -> :ok
      {:error, error} -> Logger.warning("Failed to post evidence comment issue_id=#{issue_id}: #{inspect(error)}")
    end
  end

  @doc false
  @spec evidence_comment_body(Evidence.Record.t(), Issue.t(), String.t()) :: String.t()
  def evidence_comment_body(record, issue, base_url) do
    runs = record.manifest["runs"] || []

    rows =
      Enum.map_join(runs, "\n", fn run ->
        "| #{run["kind"]} | #{run["repo"]} | `#{run["command"]}` | #{run["status"]} | #{summary_cell(run["summary"])} |"
      end)

    screenshots =
      runs
      |> Enum.flat_map(&List.wrap(&1["screenshots"]))
      |> Enum.take(4)
      |> Enum.map_join("\n", fn rel ->
        "![#{markdown_image_alt(rel)}](#{evidence_artifact_url(record, issue, rel, base_url)})"
      end)

    ui_note = if record.ui_change, do: " (UI change: e2e + visual capture required)", else: ""

    """
    ## Codex Evidence

    Run `#{record.run_id}` — overall **#{record.status}**#{ui_note}.

    | Kind | Repo | Command | Status | Summary |
    |---|---|---|---|---|
    #{rows}

    #{screenshots}

    Full artifacts (videos, reports, traces): Evidence tab in Symphony.
    """
  end

  defp summary_cell(%{"total" => total, "passed" => passed, "failed" => failed}),
    do: "#{passed}/#{total} passed, #{failed} failed"

  defp summary_cell(_summary), do: "-"

  defp evidence_artifact_url(record, issue, rel, base_url) do
    encoded_rel =
      rel
      |> String.split("/")
      |> Enum.map(&URI.encode/1)
      |> Enum.join("/")

    "#{base_url}/api/tracker/v1/projects/#{issue.project_slug}/issues/#{issue.identifier}/evidence/#{record.run_id}/artifacts/#{encoded_rel}"
  end

  defp markdown_image_alt(rel) do
    rel
    |> Path.basename()
    |> String.replace("\\", "\\\\")
    |> String.replace("[", "\\[")
    |> String.replace("]", "\\]")
    |> String.replace("(", "\\(")
    |> String.replace(")", "\\)")
  end

  # Prefer the publicly reachable tunnel URL so remote renderers (GitHub, Linear,
  # Jira) can actually fetch the embedded artifacts; fall back to the loopback
  # host when the tunnel is off.
  defp symphony_base_url do
    PublicRouting.public_base_url() || "http://#{Config.server_host()}:#{Config.server_port()}"
  end

  # Existing transition flow, extracted from the pre-contract apply_normal_completion body.
  defp apply_transition_after_contract(%State{} = state, running_entry, issue_id) do
    case apply_completion_transition(state, issue_id, running_entry.issue) do
      {:transitioned, transitioned_state} ->
        transition_group_members(running_entry)
        transitioned_state

      result when result in [:not_configured, :not_visible] ->
        state
        |> complete_issue(issue_id)
        |> schedule_issue_retry(issue_id, 1, %{
          identifier: running_entry.identifier,
          project_slug: running_entry.issue.project_slug,
          delay_type: :continuation
        })

      {:error, reason} ->
        schedule_issue_retry(state, issue_id, next_retry_attempt_from_running(running_entry), %{
          identifier: running_entry.identifier,
          project_slug: running_entry.issue.project_slug,
          error: "completion transition failed: #{inspect(reason)}"
        })
    end
  end

  defp transition_group_members(running_entry) do
    members = Map.get(running_entry, :members, [])

    Enum.each(members, fn %Issue{} = member ->
      transitions = completion_transitions_for(member)

      with dest when is_binary(dest) <- member_destination(member, transitions),
           :ok <- Tracker.update_issue_state(member.id, dest) do
        Logger.info("Moved grouped member after completion: #{issue_context(member)} -> #{dest}")
      else
        _ -> :ok
      end
    end)

    :ok
  end

  defp member_destination(%Issue{id: id, state: state}, transitions) do
    case Tracker.fetch_issue_states_by_ids([id]) do
      {:ok, [%Issue{state: current} | _]} -> Map.get(transitions, current)
      _ -> Map.get(transitions, state)
    end
  end

  # Resolve completion transitions from the issue we already hold (so the
  # per-project config is keyed off its project_slug). Only when transitions are
  # actually configured do we re-fetch the issue's current state from the tracker
  # to decide the destination; with no transitions we short-circuit to
  # :not_configured without touching the tracker.
  defp apply_completion_transition(%State{} = state, issue_id, %Issue{} = running_issue) do
    transitions = completion_transitions_for(running_issue)

    if map_size(transitions) > 0 do
      case Tracker.fetch_issue_states_by_ids([issue_id]) do
        {:ok, [%Issue{} = issue | _]} ->
          apply_completion_transition_for_issue(state, issue_id, issue, transitions)

        {:ok, _other} ->
          :not_visible

        {:error, reason} ->
          {:error, reason}
      end
    else
      :not_configured
    end
  end

  defp apply_completion_transition(%State{} = state, issue_id, _running_issue) do
    case Tracker.fetch_issue_states_by_ids([issue_id]) do
      {:ok, [%Issue{} = issue | _]} ->
        apply_completion_transition_for_issue(state, issue_id, issue, completion_transitions_for(issue))

      {:ok, _other} ->
        :not_visible

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp apply_completion_transition_for_issue(%State{} = state, issue_id, %Issue{} = issue, transitions) do
    case Map.get(transitions, issue.state) do
      destination when is_binary(destination) ->
        case Tracker.update_issue_state(issue.id, destination) do
          :ok ->
            Logger.info("Moved issue after normal agent completion: #{issue_context(issue)} #{issue.state} -> #{destination}")

            {:transitioned, release_issue_claim(complete_issue(state, issue_id), issue_id)}

          {:error, reason} ->
            Logger.warning("Failed to move issue after normal completion: #{issue_context(issue)} #{issue.state} -> #{destination}: #{inspect(reason)}")

            {:error, reason}
        end

      _no_transition ->
        :not_configured
    end
  end

  # Per-project completion transitions take precedence; fall back to the
  # process-level config only when the project declares none.
  defp completion_transitions_for(%Issue{project_slug: slug}) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} ->
        case project |> Repo.preload(:setup) |> ProjectConfig.resolve() do
          %ProjectConfig{completion_transitions: %{} = transitions}
          when map_size(transitions) > 0 ->
            transitions

          _ ->
            Config.completion_transitions()
        end

      _ ->
        Config.completion_transitions()
    end
  end

  defp completion_transitions_for(_issue), do: Config.completion_transitions()

  # When the agent run ended incomplete (e.g. it exhausted max_turns with the issue
  # still active rather than finishing the work), the issue is still promoted per
  # completion_transitions, but we leave a workpad note and a warning label so a human
  # reviewer knows there may be no PR and the work likely is not done.
  defp maybe_annotate_incomplete(running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:incomplete, reason} ->
        Logger.warning("Agent run incomplete for issue_id=#{issue_id} reason=#{inspect(reason)}; annotating before completion transition")

        post_incomplete_workpad_comment(issue_id, reason)
        add_incomplete_label(running_entry)
        PushDispatcher.agent_run_incomplete(running_entry.issue, reason)
        :ok

      _ ->
        :ok
    end
  end

  defp post_incomplete_workpad_comment(issue_id, reason) do
    case Tracker.upsert_workpad(issue_id, incomplete_workpad_comment_body(reason)) do
      :ok ->
        :ok

      {:error, error} ->
        Logger.warning("Failed to post incomplete workpad comment issue_id=#{issue_id}: #{inspect(error)}")
        :ok
    end
  end

  @doc false
  @spec incomplete_workpad_comment_body(term()) :: String.t()
  def incomplete_workpad_comment_body(reason) do
    handoff_note = incomplete_handoff_note(reason)

    """
    ## Codex Workpad

    > ⚠️ Symphony auto-note: this agent run ended **incomplete** (#{incomplete_reason_text(reason)}).
    >
    > #{handoff_note}
    > - Please review the workspace state and move the issue back to Rework (or re-dispatch) if the task is not actually done.
    """
  end

  defp incomplete_handoff_note({:validate_gate, violations}) do
    cond do
      Evidence.Gate.environment_blocked_only?(violations) ->
        "- The issue was **not** moved to review — required tests could not run in the workspace environment (e.g. no Docker/network). This is an environment blocker, not necessarily a code failure: fix the environment (or sandbox capabilities) and re-dispatch."

      Enum.any?(violations, &(&1.kind == :judge_rejected)) ->
        reasons = violations |> Enum.filter(&(&1.kind == :judge_rejected)) |> Enum.map_join("; ", & &1.detail)
        "- The issue was **not** moved to review — the independent validation judge rejected the evidence (#{reasons}). The tests do not yet prove the change; fix the tests/evidence and re-dispatch."

      true ->
        "- The issue was **not** moved to review — evidence/validation is missing or failing."
    end
  end

  defp incomplete_handoff_note({:publish_gate, _}),
    do: "- The issue was **not** moved to review — publish requirements (PRs / pushed branches) are unsatisfied."

  defp incomplete_handoff_note(_),
    do: "- No pull request was confirmed for this issue at handoff.\n    > - The issue was moved to its review state automatically by the orchestrator, not by the agent finishing the work."

  defp incomplete_reason_text(:max_turns), do: "reached the configured max turns with the issue still active"

  defp incomplete_reason_text({:publish_gate, _violations}),
    do: "ended with the publish gate unsatisfied (deliverables missing)"

  defp incomplete_reason_text({:validate_gate, violations}) do
    if Evidence.Gate.environment_blocked_only?(violations) do
      "ended with required tests blocked by the workspace environment (e.g. missing Docker/network), not a code failure"
    else
      "ended with the validate gate unsatisfied (test/e2e evidence missing or failing)"
    end
  end

  defp incomplete_reason_text(other), do: "reason=#{inspect(other)}"

  defp add_incomplete_label(running_entry), do: add_label(running_entry, @incomplete_run_label)

  defp add_label(%{issue: %Issue{identifier: identifier, project_slug: slug}}, label)
       when is_binary(identifier) and is_binary(slug) and slug != "" do
    case Context.add_issue_label(slug, identifier, label) do
      {:ok, _issue} ->
        :ok

      {:error, error} ->
        Logger.warning("Failed to add label #{label} issue=#{identifier} project=#{slug}: #{inspect(error)}")
        :ok
    end
  end

  defp add_label(_running_entry, _label), do: :ok

  defp remove_label(%{issue: %Issue{identifier: identifier, project_slug: slug}}, label)
       when is_binary(identifier) and is_binary(slug) and slug != "" do
    case Context.remove_issue_label(slug, identifier, label) do
      {:ok, _issue} ->
        :ok

      {:error, error} ->
        Logger.warning("Failed to remove label #{label} issue=#{identifier} project=#{slug}: #{inspect(error)}")
        :ok
    end
  end

  defp remove_label(_running_entry, _label), do: :ok

  defp schedule_issue_retry(%State{} = state, issue_id, attempt, metadata)
       when is_binary(issue_id) and is_map(metadata) do
    previous_retry = Map.get(state.retry_attempts, issue_id, %{attempt: 0})
    next_attempt = if is_integer(attempt), do: attempt, else: previous_retry.attempt + 1
    delay_ms = retry_delay(next_attempt, metadata)
    old_timer = Map.get(previous_retry, :timer_ref)
    due_at_ms = System.monotonic_time(:millisecond) + delay_ms
    identifier = pick_retry_identifier(issue_id, previous_retry, metadata)
    project_slug = pick_retry_project_slug(previous_retry, metadata)
    error = pick_retry_error(previous_retry, metadata)

    if is_reference(old_timer) do
      Process.cancel_timer(old_timer)
    end

    timer_ref = Process.send_after(self(), {:retry_issue, issue_id}, delay_ms)

    error_suffix = if is_binary(error), do: " error=#{error}", else: ""

    Logger.warning("Retrying issue_id=#{issue_id} issue_identifier=#{identifier} in #{delay_ms}ms (attempt #{next_attempt})#{error_suffix}")

    maybe_notify_agent_retry(next_attempt, identifier, project_slug, error)

    %{
      state
      | retry_attempts:
          Map.put(state.retry_attempts, issue_id, %{
            attempt: next_attempt,
            timer_ref: timer_ref,
            due_at_ms: due_at_ms,
            identifier: identifier,
            project_slug: project_slug,
            error: error
          })
    }
  end

  defp pop_retry_attempt_state(%State{} = state, issue_id) do
    case Map.get(state.retry_attempts, issue_id) do
      %{attempt: attempt} = retry_entry ->
        metadata = %{
          identifier: Map.get(retry_entry, :identifier),
          project_slug: Map.get(retry_entry, :project_slug),
          error: Map.get(retry_entry, :error)
        }

        {:ok, attempt, metadata, %{state | retry_attempts: Map.delete(state.retry_attempts, issue_id)}}

      _ ->
        :missing
    end
  end

  defp handle_retry_issue(%State{} = state, issue_id, attempt, metadata) do
    case Tracker.fetch_candidate_issues() do
      {:ok, issues} ->
        issues
        |> find_issue_by_id(issue_id)
        |> handle_retry_issue_lookup(state, issue_id, attempt, metadata)

      {:error, reason} ->
        Logger.warning("Retry poll failed for issue_id=#{issue_id} issue_identifier=#{metadata[:identifier] || issue_id}: #{inspect(reason)}")

        {:noreply,
         schedule_issue_retry(
           state,
           issue_id,
           attempt + 1,
           Map.merge(metadata, %{error: "retry poll failed: #{inspect(reason)}"})
         )}
    end
  end

  defp handle_retry_issue_lookup(%Issue{} = issue, state, issue_id, attempt, metadata) do
    terminal_states = terminal_set(project_state_sets(issue))

    cond do
      terminal_issue_state?(issue.state, terminal_states) ->
        Logger.info("Issue state is terminal: issue_id=#{issue_id} issue_identifier=#{issue.identifier} state=#{issue.state}; removing associated workspace")

        cleanup_issue_workspace(issue.identifier)
        {:noreply, release_issue_claim(state, issue_id)}

      retry_candidate_issue?(issue) ->
        handle_active_retry(state, issue, attempt, metadata)

      true ->
        Logger.debug("Issue left active states, removing claim issue_id=#{issue_id} issue_identifier=#{issue.identifier}")

        {:noreply, release_issue_claim(state, issue_id)}
    end
  end

  defp handle_retry_issue_lookup(nil, state, issue_id, _attempt, _metadata) do
    Logger.debug("Issue no longer visible, removing claim issue_id=#{issue_id}")
    {:noreply, release_issue_claim(state, issue_id)}
  end

  defp cleanup_issue_workspace(identifier) when is_binary(identifier) do
    Workspace.remove_issue_workspaces(identifier)
  end

  defp cleanup_issue_workspace(_identifier), do: :ok

  defp run_terminal_workspace_cleanup do
    case Tracker.fetch_issues_by_states(Config.terminal_states()) do
      {:ok, issues} ->
        issues
        |> Enum.each(fn
          %Issue{identifier: identifier} when is_binary(identifier) ->
            cleanup_issue_workspace(identifier)

          _ ->
            :ok
        end)

      {:error, reason} ->
        Logger.warning("Skipping startup terminal workspace cleanup; failed to fetch terminal issues: #{inspect(reason)}")
    end
  end

  defp notify_dashboard do
    StatusDashboard.notify_update()
  end

  defp handle_active_retry(state, issue, attempt, metadata) do
    if retry_candidate_issue?(issue) and
         dispatch_slots_available?(issue, state) do
      {:noreply, dispatch_issue(state, issue, attempt, [])}
    else
      Logger.debug("No available slots for retrying #{issue_context(issue)}; retrying again")

      {:noreply,
       schedule_issue_retry(
         state,
         issue.id,
         attempt + 1,
         Map.merge(metadata, %{
           identifier: issue.identifier,
           project_slug: issue.project_slug,
           error: "no available orchestrator slots"
         })
       )}
    end
  end

  defp release_issue_claim(%State{} = state, issue_id) do
    %{state | claimed: MapSet.delete(state.claimed, issue_id)}
  end

  defp retry_delay(attempt, metadata) when is_integer(attempt) and attempt > 0 and is_map(metadata) do
    if metadata[:delay_type] == :continuation and attempt == 1 do
      @continuation_retry_delay_ms
    else
      failure_retry_delay(attempt)
    end
  end

  defp failure_retry_delay(attempt) do
    max_delay_power = min(attempt - 1, 10)
    min(@failure_retry_base_ms * (1 <<< max_delay_power), Config.max_retry_backoff_ms())
  end

  defp normalize_retry_attempt(attempt) when is_integer(attempt) and attempt > 0, do: attempt
  defp normalize_retry_attempt(_attempt), do: 0

  defp next_retry_attempt_from_running(running_entry) do
    case Map.get(running_entry, :retry_attempt) do
      attempt when is_integer(attempt) and attempt > 0 -> attempt + 1
      _ -> nil
    end
  end

  defp pick_retry_identifier(issue_id, previous_retry, metadata) do
    metadata[:identifier] || Map.get(previous_retry, :identifier) || issue_id
  end

  defp pick_retry_project_slug(previous_retry, metadata) do
    metadata[:project_slug] || Map.get(previous_retry, :project_slug)
  end

  defp pick_retry_error(previous_retry, metadata) do
    metadata[:error] || Map.get(previous_retry, :error)
  end

  defp maybe_notify_agent_retry(next_attempt, identifier, project_slug, error)
       when is_integer(next_attempt) and next_attempt >= 1 do
    if notify_agent_retry_error?(error) and is_binary(identifier) and is_binary(project_slug) and project_slug != "" do
      PushDispatcher.agent_retry_scheduled(%{
        identifier: identifier,
        project_slug: project_slug,
        attempt: next_attempt,
        error: error
      })
    end

    :ok
  end

  defp maybe_notify_agent_retry(_next_attempt, _identifier, _project_slug, _error), do: :ok

  defp notify_agent_retry_error?(error) when is_binary(error) do
    not String.contains?(error, "no available orchestrator slots")
  end

  defp notify_agent_retry_error?(_error), do: true

  defp find_issue_by_id(issues, issue_id) when is_binary(issue_id) do
    Enum.find(issues, fn
      %Issue{id: ^issue_id} ->
        true

      _ ->
        false
    end)
  end

  defp find_issue_id_for_ref(running, ref) do
    running
    |> Enum.find_value(fn {issue_id, %{ref: running_ref}} ->
      if running_ref == ref, do: issue_id
    end)
  end

  defp running_entry_session_id(%{session_id: session_id}) when is_binary(session_id),
    do: session_id

  defp running_entry_session_id(_running_entry), do: "n/a"

  defp issue_context(%Issue{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp available_slots(%State{} = state) do
    max(
      (state.max_concurrent_agents || Config.max_concurrent_agents()) - map_size(state.running),
      0
    )
  end

  @spec cancel_retry(String.t()) :: :ok | :not_found | :unavailable
  def cancel_retry(identifier) when is_binary(identifier) do
    cancel_retry(__MODULE__, identifier)
  end

  @spec cancel_retry(GenServer.server(), String.t()) :: :ok | :not_found | :unavailable
  def cancel_retry(server, identifier) when is_binary(identifier) do
    if Process.whereis(server) do
      GenServer.call(server, {:cancel_retry, identifier})
    else
      :unavailable
    end
  end

  @doc """
  Stops an in-flight agent run for `identifier` if one is active.

  Used by the hard-reset control: terminates the running task, demonitors it, and
  clears the in-memory running/claimed/retry state (turn and token counters) so a
  subsequent dispatch starts from a clean slate. The on-disk workspace is left
  intact. Returns `:not_found` when no run is active for the issue.
  """
  @spec stop_issue(String.t()) :: :ok | :not_found | :unavailable
  def stop_issue(identifier) when is_binary(identifier) do
    stop_issue(__MODULE__, identifier)
  end

  @spec stop_issue(GenServer.server(), String.t()) :: :ok | :not_found | :unavailable
  def stop_issue(server, identifier) when is_binary(identifier) do
    if Process.whereis(server) do
      GenServer.call(server, {:stop_issue, identifier})
    else
      :unavailable
    end
  end

  @spec request_refresh() :: map() | :unavailable
  def request_refresh do
    request_refresh(__MODULE__)
  end

  @spec request_refresh(GenServer.server()) :: map() | :unavailable
  def request_refresh(server) do
    if Process.whereis(server) do
      GenServer.call(server, :request_refresh)
    else
      :unavailable
    end
  end

  @doc """
  Dispatches a specific issue immediately for manual resume/restart controls.

  Unlike the poll loop, this accepts issues in `active_states` (not only
  `dispatch_states`), which covers workflows where work moves to an in-progress
  column after the first dispatch.
  """
  @spec request_dispatch(String.t()) :: {:ok, map()} | {:error, term()} | :unavailable
  def request_dispatch(identifier) when is_binary(identifier) do
    request_dispatch(__MODULE__, identifier)
  end

  @spec request_dispatch(GenServer.server(), String.t()) :: {:ok, map()} | {:error, term()} | :unavailable
  def request_dispatch(server, identifier) when is_binary(identifier) do
    if Process.whereis(server) do
      GenServer.call(server, {:request_dispatch, identifier})
    else
      :unavailable
    end
  end

  @spec steer(String.t(), String.t(), pid() | nil) :: :ok | {:error, term()}
  def steer(identifier, message, reply_to \\ nil) do
    steer(__MODULE__, identifier, message, reply_to)
  end

  @spec steer(GenServer.server(), String.t(), String.t(), pid() | nil) :: :ok | {:error, term()}
  def steer(server, identifier, message, reply_to) do
    if Process.whereis(server) do
      GenServer.call(server, {:steer, identifier, message, reply_to})
    else
      {:error, :unavailable}
    end
  end

  @spec snapshot() :: map() | :timeout | :unavailable
  def snapshot, do: snapshot(__MODULE__, 15_000)

  @spec snapshot(GenServer.server(), timeout()) :: map() | :timeout | :unavailable
  def snapshot(server, timeout) do
    if Process.whereis(server) do
      try do
        GenServer.call(server, :snapshot, timeout)
      catch
        :exit, {:timeout, _} -> :timeout
        :exit, _ -> :unavailable
      end
    else
      :unavailable
    end
  end

  @impl true
  def handle_call(:snapshot, _from, state) do
    state = refresh_runtime_config(state)
    now = DateTime.utc_now()
    now_ms = System.monotonic_time(:millisecond)

    running =
      state.running
      |> Enum.map(fn {issue_id, metadata} ->
        %{
          issue_id: issue_id,
          identifier: metadata.identifier,
          project_slug: metadata.issue.project_slug,
          state: metadata.issue.state,
          agent_kind: Map.get(metadata, :agent_kind),
          agent_goal: Map.get(metadata, :agent_goal),
          goal: Map.get(metadata, :goal),
          session_id: metadata.session_id,
          codex_app_server_pid: metadata.codex_app_server_pid,
          agent_input_tokens: metadata.agent_input_tokens,
          agent_output_tokens: metadata.agent_output_tokens,
          agent_total_tokens: metadata.agent_total_tokens,
          turn_count: Map.get(metadata, :turn_count, 0),
          started_at: metadata.started_at,
          last_codex_timestamp: metadata.last_codex_timestamp,
          last_codex_message: metadata.last_codex_message,
          last_codex_event: metadata.last_codex_event,
          runtime_seconds: running_seconds(metadata.started_at, now)
        }
      end)

    retrying =
      state.retry_attempts
      |> Enum.map(fn {issue_id, %{attempt: attempt, due_at_ms: due_at_ms} = retry} ->
        %{
          issue_id: issue_id,
          attempt: attempt,
          due_in_ms: max(0, due_at_ms - now_ms),
          identifier: Map.get(retry, :identifier),
          project_slug: Map.get(retry, :project_slug),
          error: Map.get(retry, :error)
        }
      end)

    {:reply,
     %{
       running: running,
       retrying: retrying,
       agent_totals: state.agent_totals,
       agent_totals_by_project: Map.get(state, :agent_totals_by_project, %{}),
       rate_limits: Map.get(state, :agent_rate_limits),
       polling: %{
         checking?: state.poll_check_in_progress == true,
         next_poll_in_ms: next_poll_in_ms(state.next_poll_due_at_ms, now_ms),
         poll_interval_ms: state.poll_interval_ms
       }
     }, state}
  end

  def handle_call({:cancel_retry, identifier}, _from, state) do
    case cancel_retry_for_identifier(state, identifier) do
      {:ok, updated_state} ->
        notify_dashboard()
        {:reply, :ok, updated_state}

      :not_found ->
        {:reply, :not_found, state}
    end
  end

  def handle_call({:stop_issue, identifier}, _from, state) do
    case find_running_id_by_identifier(state, identifier) do
      nil ->
        {:reply, :not_found, state}

      issue_id ->
        Logger.info("Stopping agent run for issue_identifier=#{String.trim(identifier)} issue_id=#{issue_id} (hard reset)")

        state = terminate_running_issue(state, issue_id, false)
        notify_dashboard()
        {:reply, :ok, state}
    end
  end

  def handle_call(:request_refresh, _from, state) do
    now_ms = System.monotonic_time(:millisecond)
    already_due? = is_integer(state.next_poll_due_at_ms) and state.next_poll_due_at_ms <= now_ms
    coalesced = state.poll_check_in_progress == true or already_due?

    unless coalesced do
      :ok = schedule_tick(0)
    end

    {:reply,
     %{
       queued: true,
       coalesced: coalesced,
       requested_at: DateTime.utc_now(),
       operations: ["poll", "reconcile"]
     }, state}
  end

  def handle_call({:request_dispatch, identifier}, _from, state) do
    normalized = String.trim(identifier)

    case fetch_issue_by_identifier(normalized) do
      {:ok, %Issue{} = issue} ->
        cond do
          Map.has_key?(state.running, issue.id) ->
            {:reply, {:error, :already_running}, state}

          manual_dispatch_candidate?(issue) ->
            state =
              state
              |> cancel_retry_in_state(normalized)
              |> release_issue_claim(issue.id)

            if dispatch_slots_available?(issue, state) do
              state = dispatch_issue_for_manual_resume(state, issue)
              notify_dashboard()
              {:reply, {:ok, %{dispatched: true, issue_identifier: issue.identifier}}, state}
            else
              {:reply, {:error, :no_slots}, state}
            end

          true ->
            {:reply, {:error, :not_dispatchable}, state}
        end

      {:error, :not_found} ->
        {:reply, {:error, :issue_not_found}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:steer, identifier, message, reply_to}, _from, state) do
    trimmed = if is_binary(message), do: String.trim(message), else: ""

    case find_running_by_identifier(state, identifier) do
      %{pid: pid} when is_pid(pid) and trimmed != "" ->
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], reply_to})
        {:reply, :ok, state}

      %{pid: pid} when is_pid(pid) ->
        {:reply, {:error, :empty_message}, state}

      _other ->
        {:reply, {:error, :ActiveTurnNotSteerable}, state}
    end
  end

  defp find_running_by_identifier(%State{running: running}, identifier) when is_binary(identifier) do
    normalized = String.trim(identifier)

    running
    |> Map.values()
    |> Enum.find(fn metadata ->
      is_binary(metadata.identifier) and String.trim(metadata.identifier) == normalized
    end)
  end

  defp find_running_by_identifier(_state, _identifier), do: nil

  defp find_running_id_by_identifier(%State{running: running}, identifier) when is_binary(identifier) do
    normalized = String.trim(identifier)

    Enum.find_value(running, fn {issue_id, metadata} ->
      if is_binary(metadata.identifier) and String.trim(metadata.identifier) == normalized do
        issue_id
      else
        nil
      end
    end)
  end

  defp find_running_id_by_identifier(_state, _identifier), do: nil

  defp cancel_retry_for_identifier(%State{} = state, identifier) when is_binary(identifier) do
    normalized = String.trim(identifier)

    case find_retry_issue_id(state.retry_attempts, normalized) do
      nil ->
        :not_found

      issue_id ->
        previous_retry = Map.get(state.retry_attempts, issue_id, %{})

        if is_reference(Map.get(previous_retry, :timer_ref)) do
          Process.cancel_timer(previous_retry.timer_ref)
        end

        updated_state = %{
          state
          | retry_attempts: Map.delete(state.retry_attempts, issue_id),
            claimed: MapSet.delete(state.claimed, issue_id)
        }

        Logger.info("Cancelled agent retry for issue_identifier=#{normalized} issue_id=#{issue_id}")
        {:ok, updated_state}
    end
  end

  defp find_retry_issue_id(retry_attempts, normalized) when is_map(retry_attempts) and is_binary(normalized) do
    Enum.find_value(retry_attempts, fn {issue_id, entry} ->
      case Map.get(entry, :identifier) do
        identifier when is_binary(identifier) ->
          if String.trim(identifier) == normalized, do: issue_id, else: nil

        _ ->
          nil
      end
    end)
  end

  defp integrate_codex_update(running_entry, %{event: event, timestamp: timestamp} = update) do
    token_delta = extract_token_delta(running_entry, update)
    agent_input_tokens = Map.get(running_entry, :agent_input_tokens, 0)
    agent_output_tokens = Map.get(running_entry, :agent_output_tokens, 0)
    agent_total_tokens = Map.get(running_entry, :agent_total_tokens, 0)
    codex_app_server_pid = Map.get(running_entry, :codex_app_server_pid)
    last_reported_input = Map.get(running_entry, :codex_last_reported_input_tokens, 0)
    last_reported_output = Map.get(running_entry, :codex_last_reported_output_tokens, 0)
    last_reported_total = Map.get(running_entry, :codex_last_reported_total_tokens, 0)
    turn_count = Map.get(running_entry, :turn_count, 0)

    {
      Map.merge(running_entry, %{
        last_codex_timestamp: timestamp,
        last_codex_message: summarize_codex_update(update),
        session_id: session_id_for_update(running_entry.session_id, update),
        last_codex_event: event,
        goal: goal_for_update(running_entry, update),
        codex_app_server_pid: codex_app_server_pid_for_update(codex_app_server_pid, update),
        agent_input_tokens: agent_input_tokens + token_delta.input_tokens,
        agent_output_tokens: agent_output_tokens + token_delta.output_tokens,
        agent_total_tokens: agent_total_tokens + token_delta.total_tokens,
        codex_last_reported_input_tokens: max(last_reported_input, token_delta.input_reported),
        codex_last_reported_output_tokens: max(last_reported_output, token_delta.output_reported),
        codex_last_reported_total_tokens: max(last_reported_total, token_delta.total_reported),
        turn_count: turn_count_for_update(turn_count, running_entry.session_id, update)
      }),
      token_delta
    }
  end

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid})
       when is_binary(pid),
       do: pid

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid})
       when is_integer(pid),
       do: Integer.to_string(pid)

  defp codex_app_server_pid_for_update(_existing, %{codex_app_server_pid: pid}) when is_list(pid),
    do: to_string(pid)

  defp codex_app_server_pid_for_update(existing, _update), do: existing

  defp session_id_for_update(_existing, %{session_id: session_id}) when is_binary(session_id),
    do: session_id

  defp session_id_for_update(existing, _update), do: existing

  defp goal_for_update(running_entry, update) do
    existing = Map.get(running_entry, :goal)

    case goal_update_payload(update) do
      :clear ->
        nil

      %{} = goal ->
        normalize_goal_payload(goal, Map.get(running_entry, :agent_kind), existing)

      nil ->
        existing
    end
  end

  defp goal_update_payload(%{payload: %{"method" => "thread/goal/cleared"}}), do: :clear
  defp goal_update_payload(%{payload: %{"method" => "thread/goal/updated", "params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(%{payload: %{"method" => "turn/completed", "params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(%{payload: %{"params" => %{"goal" => goal}}}), do: goal
  defp goal_update_payload(_update), do: nil

  defp normalize_goal_payload(goal, agent_kind, existing) when is_map(goal) do
    prompt_goal? = agent_kind in ["claude", "cursor"]

    %{
      kind: if(prompt_goal?, do: "workflow", else: "goal"),
      source: if(prompt_goal?, do: "prompt", else: "native"),
      objective: goal_value(goal, "objective") || map_value(existing, :objective),
      status: goal_value(goal, "status") || map_value(existing, :status) || "active",
      token_budget: goal_value(goal, "tokenBudget") || map_value(existing, :token_budget),
      tokens_used: goal_value(goal, "tokensUsed") || map_value(existing, :tokens_used),
      time_used_seconds: goal_value(goal, "timeUsedSeconds") || map_value(existing, :time_used_seconds),
      updated_at: goal_value(goal, "updatedAt") || map_value(existing, :updated_at),
      capabilities: if(prompt_goal?, do: ["view"], else: ["get", "edit", "pause", "resume", "clear"])
    }
  end

  defp normalize_goal_payload(_goal, _agent_kind, existing), do: existing

  defp goal_value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Macro.underscore(key) |> String.to_atom())
  rescue
    ArgumentError -> Map.get(map, key)
  end

  defp map_value(map, key) when is_map(map), do: Map.get(map, key)
  defp map_value(_map, _key), do: nil

  defp turn_count_for_update(existing_count, existing_session_id, %{
         event: :session_started,
         session_id: session_id
       })
       when is_integer(existing_count) and is_binary(session_id) do
    if session_id == existing_session_id do
      existing_count
    else
      existing_count + 1
    end
  end

  defp turn_count_for_update(existing_count, _existing_session_id, _update)
       when is_integer(existing_count),
       do: existing_count

  defp turn_count_for_update(_existing_count, _existing_session_id, _update), do: 0

  defp summarize_codex_update(update) do
    %{
      event: update[:event],
      message: update[:payload] || update[:raw],
      timestamp: update[:timestamp]
    }
  end

  defp schedule_tick(delay_ms) do
    :timer.send_after(delay_ms, self(), :tick)
    :ok
  end

  defp schedule_poll_cycle_start do
    :timer.send_after(@poll_transition_render_delay_ms, self(), :run_poll_cycle)
    :ok
  end

  defp next_poll_in_ms(nil, _now_ms), do: nil

  defp next_poll_in_ms(next_poll_due_at_ms, now_ms) when is_integer(next_poll_due_at_ms) do
    max(0, next_poll_due_at_ms - now_ms)
  end

  defp pop_running_entry(state, issue_id) do
    {Map.get(state.running, issue_id), %{state | running: Map.delete(state.running, issue_id)}}
  end

  defp record_session_completion_totals(state, running_entry) when is_map(running_entry) do
    runtime_seconds = running_seconds(running_entry.started_at, DateTime.utc_now())

    completion_delta = %{
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: runtime_seconds
    }

    %{
      state
      | agent_totals: apply_token_delta(state.agent_totals, completion_delta),
        agent_totals_by_project:
          apply_project_token_delta(
            state.agent_totals_by_project,
            running_entry_project_slug(running_entry),
            completion_delta
          )
    }
  end

  defp record_session_completion_totals(state, _running_entry), do: state

  defp refresh_runtime_config(%State{} = state) do
    %{
      state
      | poll_interval_ms: Config.poll_interval_ms(),
        max_concurrent_agents: Config.max_concurrent_agents()
    }
  end

  defp retry_candidate_issue?(%Issue{} = issue) do
    sets = project_state_sets(issue)

    candidate_issue?(issue, dispatch_set(sets), terminal_set(sets)) and
      !issue_blocked_by_non_terminal?(issue, terminal_set(sets))
  end

  defp manual_dispatch_candidate?(%Issue{} = issue) do
    sets = project_state_sets(issue)

    candidate_issue?(issue, active_set(sets), terminal_set(sets)) and
      !issue_blocked_by_non_terminal?(issue, terminal_set(sets))
  end

  defp fetch_issue_by_identifier(identifier) when is_binary(identifier) do
    case Tracker.fetch_issue_states_by_ids([identifier]) do
      {:ok, [%Issue{} = issue | _]} -> {:ok, issue}
      {:ok, []} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  defp dispatch_issue_for_manual_resume(%State{} = state, issue) do
    case manual_revalidate_issue(issue) do
      {:ok, refreshed_issue} -> do_dispatch_issue(state, refreshed_issue, nil, [])
      _other -> state
    end
  end

  defp manual_revalidate_issue(%Issue{id: issue_id}) when is_binary(issue_id) do
    case Tracker.fetch_issue_states_by_ids([issue_id]) do
      {:ok, [%Issue{} = refreshed_issue | _]} ->
        if manual_dispatch_candidate?(refreshed_issue) do
          {:ok, refreshed_issue}
        else
          {:skip, refreshed_issue}
        end

      {:ok, []} ->
        {:skip, :missing}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp cancel_retry_in_state(%State{} = state, identifier) when is_binary(identifier) do
    case cancel_retry_for_identifier(state, identifier) do
      {:ok, updated_state} -> updated_state
      :not_found -> state
    end
  end

  defp dispatch_slots_available?(%Issue{} = issue, %State{} = state) do
    available_slots(state) > 0 and state_slots_available?(issue, state.running)
  end

  defp apply_codex_token_delta(
         %{agent_totals: agent_totals, agent_totals_by_project: by_project} = state,
         project_slug,
         %{input_tokens: input, output_tokens: output, total_tokens: total} = token_delta
       )
       when is_integer(input) and is_integer(output) and is_integer(total) do
    %{
      state
      | agent_totals: apply_token_delta(agent_totals, token_delta),
        agent_totals_by_project: apply_project_token_delta(by_project, project_slug, token_delta)
    }
  end

  defp apply_codex_token_delta(state, _project_slug, _token_delta), do: state

  defp apply_project_token_delta(by_project, project_slug, token_delta)
       when is_map(by_project) and is_binary(project_slug) and project_slug != "" do
    current = Map.get(by_project, project_slug, @empty_agent_totals)
    Map.put(by_project, project_slug, apply_token_delta(current, token_delta))
  end

  defp apply_project_token_delta(by_project, _project_slug, _token_delta), do: by_project

  defp running_entry_project_slug(%{issue: %{project_slug: slug}}), do: slug
  defp running_entry_project_slug(%{project_slug: slug}), do: slug
  defp running_entry_project_slug(_running_entry), do: nil

  defp apply_agent_rate_limits(%State{} = state, %{rate_limits: %{} = rate_limits}),
    do: %{state | agent_rate_limits: rate_limits}

  defp apply_agent_rate_limits(state, _update), do: state

  defp apply_token_delta(agent_totals, token_delta) do
    input_tokens = Map.get(agent_totals, :input_tokens, 0) + token_delta.input_tokens
    output_tokens = Map.get(agent_totals, :output_tokens, 0) + token_delta.output_tokens
    total_tokens = Map.get(agent_totals, :total_tokens, 0) + token_delta.total_tokens

    seconds_running =
      Map.get(agent_totals, :seconds_running, 0) + Map.get(token_delta, :seconds_running, 0)

    %{
      input_tokens: max(0, input_tokens),
      output_tokens: max(0, output_tokens),
      total_tokens: max(0, total_tokens),
      seconds_running: max(0, seconds_running)
    }
  end

  defp extract_token_delta(running_entry, update) do
    running_entry = running_entry || %{}
    usage = update[:usage] || %{}

    {
      compute_token_delta(running_entry, usage, :input_tokens, :codex_last_reported_input_tokens),
      compute_token_delta(running_entry, usage, :output_tokens, :codex_last_reported_output_tokens),
      compute_token_delta(running_entry, usage, :total_tokens, :codex_last_reported_total_tokens)
    }
    |> then(fn {input, output, total} ->
      %{
        input_tokens: input.delta,
        output_tokens: output.delta,
        total_tokens: total.delta,
        input_reported: input.reported,
        output_reported: output.reported,
        total_reported: total.reported
      }
    end)
  end

  defp compute_token_delta(running_entry, usage, token_key, reported_key) do
    next_total = Map.get(usage, token_key)
    prev_reported = Map.get(running_entry, reported_key, 0)

    delta =
      if is_integer(next_total) and next_total >= prev_reported do
        next_total - prev_reported
      else
        0
      end

    %{
      delta: max(delta, 0),
      reported: if(is_integer(next_total), do: next_total, else: prev_reported)
    }
  end

  defp running_seconds(%DateTime{} = started_at, %DateTime{} = now) do
    max(0, DateTime.diff(now, started_at, :second))
  end

  defp running_seconds(_started_at, _now), do: 0
end
