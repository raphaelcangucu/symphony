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
    SessionEvents,
    SessionLog,
    StatusDashboard,
    Tracker,
    WorkerFailure,
    Workspace
  }

  alias SymphonyElixir.Agent.{ExecutionSession, ExecutionTranscript}
  alias SymphonyElixir.Assistant.{GoalRun, History}
  alias SymphonyElixir.Evidence
  alias SymphonyElixir.GitHub.IssueMarker
  alias SymphonyElixir.LocalTracker.{Context, IssueMapper, Repository}

  alias SymphonyElixir.Orchestrator.{
    AgentTotals,
    BundleCoordinator,
    BundleGate,
    DispatchOrder,
    IncompleteReason,
    RunUpdate,
    WorkerTerminator
  }

  alias SymphonyElixir.PublicRouting
  alias SymphonyElixir.PushNotifications.Dispatcher, as: PushDispatcher
  alias SymphonyElixir.RunContract.Finalizer
  alias SymphonyElixir.Settings.Lab, as: LabSettings
  alias SymphonyElixir.Settings.Orchestration, as: OrchestrationSettings
  alias SymphonyElixir.Tracker.Sync.{Engine, LocalStore}
  alias SymphonyElixir.Tracker.Workpad
  alias SymphonyElixir.Workpad.{ExecutionBundle, UnifiedUnitPlan}

  @incomplete_run_label "symphony:incomplete"
  @blocked_run_label "symphony:blocked"

  @continuation_retry_delay_ms 1_000
  @failure_retry_base_ms 10_000
  # Slightly above the dashboard render interval so "checking now…" can render.
  @poll_transition_render_delay_ms 20
  # Emit one structured token-progress log each time a run crosses this many
  # cumulative tokens, so live monitoring can follow burn precisely.
  @token_progress_log_interval 1_000_000
  @empty_agent_totals AgentTotals.empty()

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
      # Issue ids the operator paused (`stop_issue`). Gated out of autonomous
      # dispatch/retry until an explicit resume/dispatch clears them, so a paused
      # run is not silently re-picked by the poll loop.
      paused: MapSet.new(),
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
    state = maybe_automatically_dispatch(state)
    now_ms = System.monotonic_time(:millisecond)
    next_poll_due_at_ms = now_ms + state.poll_interval_ms
    :ok = schedule_tick(state.poll_interval_ms)

    state = %{state | poll_check_in_progress: false, next_poll_due_at_ms: next_poll_due_at_ms}

    notify_dashboard()
    {:noreply, state}
  end

  # credo:disable-for-lines:50
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

              if queued_execution_instruction?(running_entry) do
                # A provider that cannot be steered receives the operator's
                # message on a subsequent turn. Keep the task dispatchable
                # rather than completing it underneath that durable queue.
                finish_execution_session(running_entry, "active")
                requeue_execution_instruction(state, running_entry, issue_id)
              else
                finish_execution_session(running_entry, execution_completion_status(running_entry))
                apply_normal_completion(state, running_entry, issue_id)
              end

            _ ->
              Logger.warning("Agent task exited for issue_id=#{issue_id} session_id=#{session_id} reason=#{inspect(reason)}; scheduling retry")

              finish_execution_session(running_entry, "aborted")

              unless WorkerFailure.crash_exception?(reason) do
                record_session_abort(
                  running_entry,
                  "worker_exit",
                  WorkerFailure.format_exit_reason(reason)
                )
              end

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
        {updated_running_entry, token_delta} = RunUpdate.integrate(running_entry, update)
        {updated_running_entry, transcript_changed?} = ExecutionTranscript.record(updated_running_entry, update)
        persist_execution_model_provenance(updated_running_entry, update)
        persist_execution_provider_binding(updated_running_entry, update)
        broadcast_execution_history(updated_running_entry, transcript_changed?)

        state =
          state
          |> apply_codex_token_delta(running_entry_project_slug(running_entry), token_delta)
          |> apply_agent_rate_limits(update)

        state = %{state | running: Map.put(state.running, issue_id, updated_running_entry)}
        maybe_log_token_progress(running_entry, updated_running_entry)
        maybe_notify_agent_attention(running_entry, update)
        state = maybe_enforce_token_budget(state, issue_id, updated_running_entry)

        notify_dashboard()
        {:noreply, state}
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
    Engine.request_sync()
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

  # A manual-only Host still reconciles any in-flight worker, but it never
  # selects a different task from the candidate pool. This is intentionally an
  # instance switch rather than a task flag so the selected task can be started
  # through the normal `request_dispatch/1` contract from the mobile app.
  defp maybe_automatically_dispatch(%State{} = state) do
    if Config.orchestrator_auto_dispatch?() do
      maybe_dispatch(state)
    else
      reconcile_running_issues(state)
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
    DispatchOrder.sort(issues)
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

        state
        |> finish_wait_state_execution_session(issue)
        |> terminate_running_issue(issue.id, false)
    end
  end

  defp reconcile_issue_state(_issue, state, _active_states, _terminal_states), do: state

  defp finish_wait_state_execution_session(%State{} = state, %Issue{} = issue) do
    if wait_issue_state?(issue) do
      state.running
      |> Map.get(issue.id)
      |> finish_execution_session("completed")
    end

    state
  end

  defp wait_issue_state?(%Issue{state: state_name, project_slug: slug})
       when is_binary(state_name) do
    normalized = normalize_issue_state(state_name)
    Enum.any?(wait_states_for_slug(slug), fn wait_state -> normalize_issue_state(wait_state) == normalized end)
  end

  defp wait_issue_state?(_issue), do: false

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
            paused: MapSet.delete(state.paused, issue_id),
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

      record_session_abort(
        running_entry,
        "stall_timeout",
        "No agent activity for #{elapsed_ms}ms (limit #{timeout_ms}ms)"
      )

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
    WorkerTerminator.stop(pid)
  end

  defp terminate_task(_pid), do: :ok

  defp record_session_abort(%{} = running_entry, reason, detail)
       when is_binary(reason) and is_binary(detail) do
    case running_entry_workspace(running_entry) do
      workspace when is_binary(workspace) ->
        SessionEvents.append_abort(workspace, reason, detail: detail)

      _ ->
        :ok
    end
  end

  defp record_session_abort(_running_entry, _reason, _detail), do: :ok

  defp record_session_run_failure(%{} = running_entry, reason) do
    case running_entry_workspace(running_entry) do
      workspace when is_binary(workspace) ->
        SessionEvents.append_run_failure(workspace, reason)

      _ ->
        :ok
    end
  end

  defp record_session_run_failure(_running_entry, _reason), do: :ok

  defp running_entry_workspace(%{issue: %{} = issue} = running_entry) do
    SessionLog.run_log_workspace(issue, Map.get(running_entry, :run_opts, []))
  end

  defp running_entry_workspace(_running_entry), do: nil

  defp queued_execution_instruction?(%{execution_session_id: session_id})
       when is_integer(session_id) do
    case History.get_thread(session_id) do
      {:ok, thread} -> History.pending_turns(thread) != []
      _ -> false
    end
  rescue
    _error -> false
  end

  defp queued_execution_instruction?(_running_entry), do: false

  defp requeue_execution_instruction(state, running_entry, issue_id) do
    Logger.info("Continuing task for queued operator instruction: issue_id=#{issue_id} session_id=#{running_entry_session_id(running_entry)}")

    schedule_issue_retry(state, issue_id, 1, %{
      identifier: running_entry.identifier,
      project_slug: running_entry.issue.project_slug,
      delay_type: :continuation
    })
  end

  # Best-effort terminal-status update for a run's execution session. No-ops when
  # the run has no execution session id, and never raises into the caller.
  defp finish_execution_session(running_entry, status)
       when is_map(running_entry) and is_binary(status) do
    case Map.get(running_entry, :execution_session_id) do
      id when is_integer(id) ->
        try do
          ExecutionSession.finish(id, status)
        rescue
          error -> Logger.warning("ExecutionSession.finish failed: #{Exception.message(error)}")
        end

        :ok

      _ ->
        :ok
    end
  end

  defp finish_execution_session(_running_entry, _status), do: :ok

  defp persist_execution_model_provenance(running_entry, update)
       when is_map(running_entry) and is_map(update) do
    session_id = Map.get(running_entry, :execution_session_id)

    attrs =
      []
      |> maybe_put_provenance(:resolved_model, Map.get(update, :resolved_model))
      |> maybe_put_provenance(:resolved_effort, Map.get(update, :resolved_effort))

    if is_integer(session_id) and attrs != [] do
      case ExecutionSession.put_model_provenance(session_id, attrs) do
        {:ok, _thread} -> :ok
        {:error, reason} -> Logger.warning("ExecutionSession provenance update failed: #{inspect(reason)}")
      end
    end

    :ok
  rescue
    error ->
      Logger.warning("ExecutionSession provenance update failed: #{Exception.message(error)}")
      :ok
  end

  defp persist_execution_provider_binding(
         %{execution_session_id: session_id},
         %{provider: provider, conversation_id: conversation_id}
       )
       when is_integer(session_id) and is_binary(provider) and is_binary(conversation_id) do
    case ExecutionSession.put_provider_binding(session_id, provider, conversation_id) do
      {:ok, _thread} ->
        :ok

      {:error, reason} ->
        Logger.warning("ExecutionSession provider binding update failed: #{inspect(reason)}")
    end
  rescue
    error ->
      Logger.warning("ExecutionSession provider binding update failed: #{Exception.message(error)}")
      :ok
  end

  defp persist_execution_provider_binding(_running_entry, _update), do: :ok

  # Execution transcripts are persisted outside an interactive channel. Fan a
  # history refresh to every channel attached to the task-native session so the
  # Android screen that is already open receives the new durable entries.
  defp broadcast_execution_history(%{execution_session_id: id}, true) when is_integer(id) do
    GoalRun.broadcast_from(self(), id, {:execution_history_updated})
  end

  defp broadcast_execution_history(_running_entry, _changed?), do: :ok

  defp maybe_put_provenance(attrs, _key, value) when not is_binary(value), do: attrs

  defp maybe_put_provenance(attrs, key, value) do
    case String.trim(value) do
      "" -> attrs
      normalized -> Keyword.put(attrs, key, normalized)
    end
  end

  defp execution_completion_status(running_entry) when is_map(running_entry) do
    case Map.get(running_entry, :agent_outcome) do
      {:error, _} -> "aborted"
      {:incomplete, _} -> "aborted"
      _ -> "completed"
    end
  end

  defp execution_completion_status(_running_entry), do: "completed"

  defp choose_issues(issues, state) do
    candidates = DispatchOrder.sort(issues)

    held = held_child_issue_ids(candidates)

    Enum.reduce(candidates, state, fn issue, acc -> maybe_dispatch_candidate(acc, issue, held) end)
  end

  defp maybe_dispatch_candidate(state, issue, held) do
    case dispatch_decision(issue) do
      {:ok, sets} ->
        cond do
          coordinator_parent_dispatch_held?(issue) ->
            Logger.info("Holding coordinator-parent dispatch; child runs incomplete for #{issue_context(issue)}")

            state

          should_dispatch_issue?(issue, state, dispatch_set(sets), terminal_set(sets)) and
              not MapSet.member?(held, issue.id) ->
            dispatch_issue(state, issue, nil)

          true ->
            state
        end

      {:skip, reason} ->
        Logger.warning("Skipping dispatch; project not runnable for #{issue_context(issue)}: #{reason}")
        state
    end
  end

  @doc false
  @spec held_child_issue_ids_for_test([Issue.t()], keyword()) :: MapSet.t()
  def held_child_issue_ids_for_test(candidates, opts) when is_list(candidates) do
    held_child_issue_ids(candidates, opts)
  end

  # Bundle-aware dispatch gate: a child_run unit is held until its sibling
  # dependencies are done and the shared contracts it consumes are ready. The
  # parent's execution bundle is loaded once per parent per poll cycle (local
  # tracker only); remote-only parents cannot be resolved here and are left
  # un-gated (the coordinator prompt still orders them). Liveness: a candidate
  # whose bundle/units cannot be resolved is never added to the held set.
  # credo:disable-for-lines:80
  defp held_child_issue_ids(candidates, opts \\ []) do
    bundle_loader = Keyword.get(opts, :bundle_loader, &load_parent_bundle/1)
    # Dependents release once their predecessor reaches human review (its PR is
    # open) — NOT only when it is terminal. Parent completion uses the stricter
    # terminal-only `resolve_done_units/1`.
    done_resolver = Keyword.get(opts, :done_units, &resolve_released_units/1)

    candidates
    |> Enum.filter(&child_candidate?/1)
    |> Enum.group_by(& &1.parent_identifier)
    |> Enum.reduce(MapSet.new(), fn {parent_identifier, children}, acc ->
      case bundle_loader.(parent_identifier) do
        {:ok, %ExecutionBundle{} = bundle} ->
          done_units = done_resolver.(bundle)

          contract_status =
            bundle
            |> BundleCoordinator.contract_status()
            |> ready_owner_released_contracts(bundle, done_units)

          Enum.reduce(children, acc, fn child, inner ->
            cond do
              not lab_bundle_child_orchestration?(opts) and BundleCoordinator.coordinator?(bundle) ->
                Logger.info("Holding child dispatch (unified parent): #{issue_context(child)} parent=#{parent_identifier}")

                MapSet.put(inner, child.id)

              BundleGate.held?(bundle, child.identifier, done_units, contract_status) ->
                Logger.info("Holding child dispatch (bundle gate): #{issue_context(child)} parent=#{parent_identifier}")
                MapSet.put(inner, child.id)

              true ->
                inner
            end
          end)

        _ ->
          acc
      end
    end)
  end

  defp child_candidate?(%Issue{parent_identifier: parent, id: id})
       when is_binary(parent) and parent != "" and is_binary(id),
       do: true

  defp child_candidate?(_issue), do: false

  # Once a contract's owner unit is released (reached human review / terminal), the
  # contract it produces is final — it lands in the owner's open PR. Force those
  # contracts to `:ready` so a consumer is not held on a stale `:draft`/`:changing`
  # status the owner never got to flip. `released_units` are unit ids; contract
  # `owner_unit` is a unit id, so they match directly.
  defp ready_owner_released_contracts(contract_status, %ExecutionBundle{shared_contracts: contracts}, released_units)
       when is_map(contract_status) do
    Enum.reduce(List.wrap(contracts), contract_status, fn contract, acc ->
      owner = Map.get(contract, :owner_unit)
      id = Map.get(contract, :id)

      if is_binary(owner) and is_binary(id) and MapSet.member?(released_units, owner) do
        Map.put(acc, id, :ready)
      else
        acc
      end
    end)
  end

  defp ready_owner_released_contracts(contract_status, _bundle, _released_units), do: contract_status

  # Loads and parses the `### Execution bundle` from a parent's local workpad.
  # Returns `:error` for remote-only parents (no local workpad), which leaves the
  # child un-gated rather than blocking it.
  defp load_parent_bundle(parent_identifier) when is_binary(parent_identifier) do
    with slug when is_binary(slug) <- Context.find_project_slug(parent_identifier),
         {:ok, comments} <- Context.list_comments(slug, parent_identifier),
         body when is_binary(body) <- workpad_body_from_comments(comments),
         {:ok, %ExecutionBundle{} = bundle} <- ExecutionBundle.parse(body) do
      {:ok, bundle}
    else
      _ -> :error
    end
  end

  defp load_parent_bundle(_parent_identifier), do: :error

  defp workpad_body_from_comments(comments) when is_list(comments) do
    Enum.find_value(comments, fn comment ->
      body = comment_body(comment)
      if is_binary(body) and Workpad.workpad?(body), do: body
    end)
  end

  defp workpad_body_from_comments(_comments), do: nil

  defp comment_body(%{body: body}), do: body
  defp comment_body(comment) when is_map(comment), do: Map.get(comment, :body) || Map.get(comment, "body")
  defp comment_body(_comment), do: nil

  # A child_run unit counts as "done" only when its issue resolves to a terminal
  # state. Unresolved units are treated as not-done so a dependent stays held
  # (never released on missing data); this keeps the gate conservative for the
  # local bundles it applies to.
  defp resolve_done_units(%ExecutionBundle{} = bundle) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.reduce(MapSet.new(), fn unit, acc ->
      if unit_done?(unit), do: MapSet.put(acc, unit.id), else: acc
    end)
  end

  defp unit_done?(%{issue: identifier}) when is_binary(identifier) and identifier != "" do
    with slug when is_binary(slug) <- Context.find_project_slug(identifier),
         {:ok, record} <- Context.get_issue(slug, identifier) do
      terminal_record_state?(record)
    else
      _ -> false
    end
  end

  defp unit_done?(_unit), do: false

  # A child_run unit "releases" its dependents once its issue reaches human review
  # (its PR is open — a `wait` status) OR a terminal state. This is deliberately
  # earlier than `resolve_done_units/1` (terminal-only, used for parent
  # completion): a dependent forks off the predecessor's branch and continues
  # while the predecessor's PR is still in review, so we do NOT wait for the merge.
  # Unresolved units are treated as not-released so a dependent stays held.
  defp resolve_released_units(%ExecutionBundle{} = bundle) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.reduce(MapSet.new(), fn unit, acc ->
      if unit_released?(unit), do: MapSet.put(acc, unit.id), else: acc
    end)
  end

  defp unit_released?(%{issue: identifier}) when is_binary(identifier) and identifier != "" do
    with slug when is_binary(slug) <- Context.find_project_slug(identifier),
         {:ok, record} <- Context.get_issue(slug, identifier) do
      released_record_state?(record, wait_states_for_slug(slug))
    else
      _ -> false
    end
  end

  defp unit_released?(_unit), do: false

  # "Human review" is matched by the project's configured `wait_states` (status
  # *name*), NOT the status *category*: GitHub-backed boards classify a review
  # column as category `started`, so a category check would never fire. Terminal
  # states always release.
  @doc false
  @spec released_record_state?(map(), [String.t()]) :: boolean()
  def released_record_state?(%{status: %{is_terminal: true}}, _wait_states), do: true

  def released_record_state?(%{status: %{name: name}}, wait_states)
      when is_binary(name) and is_list(wait_states) do
    normalized = normalize_issue_state(name)
    Enum.any?(wait_states, fn ws -> normalize_issue_state(ws) == normalized end)
  end

  def released_record_state?(_record, _wait_states), do: false

  defp wait_states_for_slug(slug) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} ->
        case project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:wait_states) do
          states when is_list(states) and states != [] -> states
          _ -> Config.wait_states()
        end

      _ ->
        Config.wait_states()
    end
  rescue
    _ -> Config.wait_states()
  end

  defp wait_states_for_slug(_slug), do: Config.wait_states()

  defp terminal_record_state?(%{status: %{is_terminal: terminal}}) when is_boolean(terminal), do: terminal
  defp terminal_record_state?(_record), do: false

  defp should_dispatch_issue?(
         %Issue{} = issue,
         %State{running: running, claimed: claimed, paused: paused} = state,
         active_states,
         terminal_states
       ) do
    candidate_issue?(issue, active_states, terminal_states) and
      !issue_blocked_by_non_terminal?(issue, terminal_states) and
      !provider_resume_blocked?(issue) and
      !MapSet.member?(claimed, issue.id) and
      !MapSet.member?(paused, issue.id) and
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
    {
      normalize_states(Config.active_states()),
      normalize_states(Config.dispatch_states()),
      normalize_states(Config.terminal_states())
    }
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

  defp dispatch_issue(%State{} = state, issue, attempt) do
    case revalidate_issue_for_dispatch(issue, &Tracker.fetch_issue_states_by_ids/1) do
      {:ok, %Issue{} = refreshed_issue} ->
        do_dispatch_issue(state, refreshed_issue, attempt)

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

  defp do_dispatch_issue(%State{} = state, issue, attempt) do
    recipient = self()
    issue = Tracker.enrich_issue(issue)
    agent_kind = AgentRunner.issue_agent_kind(issue)
    bundle_ctx = bundle_run_context(issue)
    run_opts = agent_run_opts(issue, agent_kind, bundle_ctx.run_opts, attempt)
    execution_session = ensure_execution_session(issue, agent_kind, bundle_ctx, run_opts)

    run_opts =
      case execution_session do
        %{id: id} when is_integer(id) -> Keyword.put(run_opts, :assistant_thread_id, id)
        _ -> run_opts
      end

    case Task.Supervisor.start_child(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
           AgentRunner.run(issue, recipient, run_opts)
         end) do
      {:ok, pid} ->
        ref = Process.monitor(pid)

        Logger.info("Dispatching issue to agent: #{issue_context(issue)} pid=#{inspect(pid)} attempt=#{inspect(attempt)} role=#{bundle_ctx.role}")

        if bundle_ctx.role == :child do
          Logger.info(
            "[bundle] dispatch child=#{issue.identifier} parent=#{inspect(bundle_ctx.parent_identifier)} unit=#{inspect(bundle_ctx.unit_id)} repo=#{inspect(bundle_ctx.repo)} " <>
              "worktree=#{Keyword.get(bundle_ctx.run_opts, :worktree) == true} base=#{inspect(Keyword.get(bundle_ctx.run_opts, :worktree_repo))} branch=#{inspect(Keyword.get(bundle_ctx.run_opts, :worktree_branch))} " <>
              "pr_base=#{inspect(Keyword.get(bundle_ctx.run_opts, :pr_base))} reuse_parent_setup=#{Keyword.get(bundle_ctx.run_opts, :reuse_parent_setup) == true} " <>
              "budget=#{Config.agent_token_budget()} pid=#{inspect(pid)} attempt=#{inspect(attempt)}"
          )
        end

        running_entry =
          dispatch_running_entry(pid, ref, issue, agent_kind, attempt, bundle_ctx)
          |> Map.put(:execution_session_id, execution_session_id(execution_session))

        running = Map.put(state.running, issue.id, running_entry)

        claimed = MapSet.put(state.claimed, issue.id)

        %{
          state
          | running: running,
            claimed: claimed,
            paused: MapSet.delete(state.paused, issue.id),
            retry_attempts: Map.delete(state.retry_attempts, issue.id)
        }

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

  # Create the task-native chat before the worker starts. The runner receives
  # its id and can consume durable queued instructions on its next turn. This
  # avoids the previous race where the transcript existed only after a worker
  # had already emitted raw events.
  defp ensure_execution_session(%Issue{} = issue, agent_kind, bundle_ctx, run_opts) do
    workspace = SessionLog.run_log_workspace(issue, bundle_ctx.run_opts)
    settings = AgentRunner.agent_settings_opts(issue)

    case workspace do
      path when is_binary(path) and path != "" ->
        case ExecutionSession.ensure(issue.project_slug, issue.identifier,
               workspace_path: path,
               agent_kind: agent_kind,
               requested_model: Keyword.get(run_opts, :model) || Keyword.get(settings, :model),
               requested_effort: Keyword.get(run_opts, :effort) || Keyword.get(settings, :effort),
               unit_id: bundle_ctx.unit_id,
               bundle_role: to_string(bundle_ctx.role)
             ) do
          {:ok, session} ->
            session

          {:error, reason} ->
            Logger.warning("ExecutionSession.ensure failed: #{inspect(reason)}")
            nil
        end

      _ ->
        nil
    end
  rescue
    error ->
      Logger.warning("ExecutionSession.ensure failed: #{Exception.message(error)}")
      nil
  end

  defp execution_session_id(%{id: id}) when is_integer(id), do: id
  defp execution_session_id(_session), do: nil

  defp agent_run_opts(%Issue{} = issue, agent_kind, bundle_run_opts, attempt)
       when is_binary(agent_kind) and is_list(bundle_run_opts) do
    opts = [attempt: attempt] ++ bundle_run_opts

    with project_slug when is_binary(project_slug) <- issue.project_slug,
         identifier when is_binary(identifier) <- issue.identifier,
         {:ok, conversation_ref} <-
           ExecutionSession.latest_conversation_ref(project_slug, identifier, agent_kind) do
      Keyword.put(opts, :conversation_ref, conversation_ref)
    else
      _ -> opts
    end
  end

  @doc false
  @spec agent_run_opts_for_test(Issue.t(), String.t(), keyword(), non_neg_integer() | nil) ::
          keyword()
  def agent_run_opts_for_test(%Issue{} = issue, agent_kind, bundle_run_opts, attempt),
    do: agent_run_opts(issue, agent_kind, bundle_run_opts, attempt)

  defp dispatch_running_entry(pid, ref, %Issue{} = issue, agent_kind, attempt, bundle_ctx) do
    agent_settings = AgentRunner.agent_settings_opts(issue)

    %{
      pid: pid,
      ref: ref,
      identifier: issue.identifier,
      issue: issue,
      agent_kind: agent_kind,
      model: Keyword.get(agent_settings, :model),
      effort: Keyword.get(agent_settings, :effort),
      agent_goal: Map.get(issue, :agent_goal),
      goal: nil,
      session_id: nil,
      execution_session_id: nil,
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
      started_at: DateTime.utc_now(),
      bundle_role: bundle_ctx.role,
      parent_identifier: bundle_ctx.parent_identifier,
      unit_id: bundle_ctx.unit_id,
      repo: bundle_ctx.repo,
      child_identifiers: bundle_ctx.child_identifiers,
      run_opts: bundle_ctx.run_opts
    }
  end

  @typedoc """
  Bundle execution context computed for an issue at dispatch time, used to route
  child runs into isolated worktrees and to tag the running entry for the
  hierarchical observability view.
  """
  @type bundle_context :: %{
          role: :parent | :parent_unified | :child | :standalone,
          parent_identifier: String.t() | nil,
          unit_id: String.t() | nil,
          repo: String.t() | nil,
          child_identifiers: [String.t()],
          run_opts: keyword()
        }

  @doc """
  Computes the bundle execution context for an issue at dispatch time.

  A subtask (an issue carrying a `parent_identifier`) runs as a `:child` in a git
  worktree branched off its parent's checkout when that checkout is a git repo,
  so siblings never share a working tree; otherwise it gracefully falls back to
  the standard per-issue workspace. Non-subtask issues are `:standalone` and run
  unchanged. The workspace resolver and git-repo probe are injectable for tests.
  """
  @spec bundle_run_context(Issue.t(), keyword()) :: bundle_context()
  def bundle_run_context(issue, opts \\ [])

  def bundle_run_context(%Issue{parent_identifier: parent, identifier: identifier} = issue, opts)
      when is_binary(parent) and parent != "" do
    workspace_resolver = Keyword.get(opts, :workspace_resolver, &Workspace.path_for_issue/1)
    git_repo? = Keyword.get(opts, :git_repo?, &git_repo?/1)
    unit_repo_resolver = Keyword.get(opts, :unit_repo_resolver, &child_unit_repo/2)
    bundle_resolver = Keyword.get(opts, :bundle_resolver, &safe_load_parent_bundle/1)
    parent_repo_resolver = Keyword.get(opts, :parent_repo_resolver, &parent_repo/1)

    container = workspace_resolver.(parent)
    unit_repo = unit_repo_resolver.(parent, identifier)
    coordinator_repo = parent_repo_resolver.(parent)
    base = child_worktree_base(container, unit_repo)
    same_repo? = is_binary(coordinator_repo) and is_binary(unit_repo) and coordinator_repo == unit_repo
    integration_branch = integration_branch_for(bundle_resolver, parent, identifier, unit_repo)
    worktree_base = worktree_base_branch_for(bundle_resolver, parent, identifier, unit_repo, integration_branch)

    run_opts =
      if is_binary(base) and git_repo?.(base) do
        [
          worktree: true,
          worktree_repo: base,
          worktree_branch: "feat/" <> safe_unit_slug(identifier),
          unit_id: identifier,
          parent_identifier: parent,
          reuse_parent_setup: same_repo?
        ]
        |> maybe_put_integration_branch(worktree_base, integration_branch)
      else
        []
      end
      |> maybe_put_bundle_unit_opts(bundle_resolver, parent, identifier)

    %{
      role: :child,
      parent_identifier: parent,
      unit_id: identifier,
      repo: unit_repo || issue.repository_full_name,
      child_identifiers: [],
      run_opts: run_opts
    }
  end

  # A coordinator parent (an issue with no parent of its own, whose workpad holds a
  # `bundle`-mode execution bundle that owns at least one `child_run`) runs as
  # `:parent`: it carries the parsed bundle in `run_opts` so the coordinator prompt
  # is injected and it acts as a lightweight coordinator (creates the per-repo
  # integration branch, merges green child PRs, opens the final PR) — it must NEVER
  # be dispatched as a `:standalone` implementer that re-does the children's work.
  # credo:disable-for-lines:35
  def bundle_run_context(%Issue{identifier: identifier} = _issue, opts)
      when is_binary(identifier) and identifier != "" do
    bundle_resolver = Keyword.get(opts, :bundle_resolver, &safe_load_parent_bundle/1)

    case bundle_resolver.(identifier) do
      {:ok, %ExecutionBundle{} = bundle} ->
        if BundleCoordinator.coordinator?(bundle) do
          if lab_bundle_child_orchestration?(opts) do
            %{
              role: :parent,
              parent_identifier: nil,
              unit_id: nil,
              repo: nil,
              child_identifiers: coordinator_child_identifiers(bundle),
              run_opts: [bundle: bundle]
            }
          else
            unified_parent_run_context(identifier, bundle, opts)
          end
        else
          standalone_run_context()
        end

      _ ->
        standalone_run_context()
    end
  end

  def bundle_run_context(%Issue{}, _opts), do: standalone_run_context()

  defp unified_parent_run_context(parent_identifier, %ExecutionBundle{} = bundle, opts) do
    sub_issues = load_gated_sub_issues(parent_identifier, opts)

    case UnifiedUnitPlan.build(bundle, sub_issues, unified_plan_opts(opts)) do
      {:ok, %UnifiedUnitPlan{} = plan} ->
        %{
          role: :parent_unified,
          parent_identifier: nil,
          unit_id: nil,
          repo: nil,
          child_identifiers: coordinator_child_identifiers(bundle),
          run_opts: [
            bundle: bundle,
            unit_plan: plan,
            unified_parent: true,
            feature_branch: "feat/" <> safe_unit_slug(parent_identifier)
          ]
        }
    end
  end

  defp load_gated_sub_issues(parent_identifier, opts) do
    slug_resolver = Keyword.get(opts, :slug_resolver, &Context.find_project_slug/1)
    sub_issue_loader = Keyword.get(opts, :sub_issue_loader, &default_sub_issues/2)

    with slug when is_binary(slug) <- slug_resolver.(parent_identifier),
         issues when is_list(issues) <- sub_issue_loader.(slug, parent_identifier) do
      issues
    else
      _ -> []
    end
  end

  # credo:disable-for-lines:18
  defp default_sub_issues(slug, parent_identifier) do
    case Context.list_subtask_children(slug, parent_identifier) do
      {:ok, child_ids} ->
        child_ids
        |> Enum.map(fn identifier ->
          case Context.get_issue(slug, identifier) do
            {:ok, record} -> IssueMapper.to_issue(record)
            _ -> nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  defp unified_plan_opts(opts) do
    base = [
      require_symphony_label: Keyword.get(opts, :require_symphony_label, OrchestrationSettings.require_symphony_label?()),
      require_assignee_match: Keyword.get(opts, :require_assignee_match, OrchestrationSettings.require_assignee_match?())
    ]

    case Keyword.get(opts, :viewer_login) do
      login when is_binary(login) -> Keyword.put(base, :viewer_login, login)
      _ -> base
    end
  end

  defp standalone_run_context do
    %{role: :standalone, parent_identifier: nil, unit_id: nil, repo: nil, child_identifiers: [], run_opts: []}
  end

  defp coordinator_child_identifiers(%ExecutionBundle{} = bundle) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.map(& &1.issue)
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
  end

  @doc """
  True when a running agent's cumulative token usage has reached the configured
  budget ceiling. A non-positive `budget` disables the guard. Used as a hard
  backstop against runaway loops (e.g. a child that babysits CI in a sleep/poll
  loop and balloons cached input tokens).
  """
  @spec run_budget_exceeded?(map(), non_neg_integer()) :: boolean()
  def run_budget_exceeded?(running_entry, budget)

  def run_budget_exceeded?(running_entry, budget)
      when is_map(running_entry) and is_integer(budget) and budget > 0 do
    running_entry_total_tokens(running_entry) >= budget
  end

  def run_budget_exceeded?(_running_entry, _budget), do: false

  @doc """
  Decides what to do with a running agent whose token usage was just integrated:

    * `:within_budget` — under the ceiling, keep running
    * `{:retry, attempt}` — over budget, stop and re-dispatch (bounded child now)
    * `:park` — over budget and out of retries, stop and leave for human attention

  Bounds runaway loops: a run that keeps overrunning is parked after
  `max_retries` re-dispatches instead of being retried forever.

  Coordinator parents (`bundle_role: :parent`) are always `:within_budget`: they
  supervise child runs and must not be stopped by the implementer token ceiling.
  Child and standalone runs remain guarded.
  """
  @spec budget_overrun_action(map(), non_neg_integer(), non_neg_integer()) ::
          :within_budget | {:retry, pos_integer()} | :park
  def budget_overrun_action(running_entry, budget, max_retries)
      when is_map(running_entry) and is_integer(max_retries) and max_retries >= 0 do
    cond do
      coordinator_parent_run?(running_entry) -> :within_budget
      not run_budget_exceeded?(running_entry, budget) -> :within_budget
      running_entry_attempt(running_entry) >= max_retries -> :park
      true -> {:retry, running_entry_attempt(running_entry) + 1}
    end
  end

  @doc """
  Decides the post-run lifecycle for a run that ended without reaching a terminal
  state (incomplete / publish-blocked):

    * `:default` — not a bundle child; keep the existing behavior (no requeue)
    * `{:requeue, attempt}` — bundle child; re-dispatch so it does not strand the bundle
    * `:park` — bundle child out of retries; stop re-queuing and leave for a human

  Without this, a child whose run ends in a non-dispatch active state (e.g. `In
  Progress`) sits idle forever and the parent bundle waits on a child that will
  never be re-picked.
  """
  @spec child_requeue_action(map(), non_neg_integer()) :: :default | {:requeue, pos_integer()} | :park
  def child_requeue_action(running_entry, max_retries)
      when is_map(running_entry) and is_integer(max_retries) and max_retries >= 0 do
    cond do
      not bundle_child?(running_entry) -> :default
      running_entry_attempt(running_entry) >= max_retries -> :park
      true -> {:requeue, running_entry_attempt(running_entry) + 1}
    end
  end

  defp bundle_child?(%{parent_identifier: parent}) when is_binary(parent) and parent != "", do: true
  defp bundle_child?(_running_entry), do: false

  defp coordinator_parent_run?(%{bundle_role: :parent}), do: true
  defp coordinator_parent_run?(_running_entry), do: false

  @doc """
  True when cumulative token usage crossed a new `interval` boundary between two
  successive updates (used to emit one progress log per interval rather than per
  update). A non-positive `interval` disables progress logging.
  """
  @spec token_threshold_crossed?(non_neg_integer(), non_neg_integer(), integer()) :: boolean()
  def token_threshold_crossed?(before_tokens, after_tokens, interval)
      when is_integer(before_tokens) and is_integer(after_tokens) and is_integer(interval) and interval > 0 do
    div(after_tokens, interval) > div(before_tokens, interval)
  end

  def token_threshold_crossed?(_before_tokens, _after_tokens, _interval), do: false

  defp running_entry_total_tokens(%{agent_total_tokens: tokens}) when is_integer(tokens), do: tokens
  defp running_entry_total_tokens(_running_entry), do: 0

  @doc """
  The token budget actually enforced on a live run. When the operator guard is
  enabled its ceiling wins; otherwise the always-on hard ceiling is the backstop
  that stops a runaway non-goal run before it burns tens of millions of tokens.
  Both being `0` means the operator opted into a truly unbounded run.
  """
  @spec effective_token_budget(non_neg_integer(), non_neg_integer()) :: non_neg_integer()
  def effective_token_budget(operator_budget, hard_ceiling)
      when is_integer(operator_budget) and is_integer(hard_ceiling) do
    if operator_budget > 0, do: operator_budget, else: hard_ceiling
  end

  defp effective_token_budget do
    effective_token_budget(Config.agent_token_budget(), Config.agent_token_hard_ceiling())
  end

  defp running_entry_attempt(%{retry_attempt: attempt}) when is_integer(attempt) and attempt >= 0, do: attempt
  defp running_entry_attempt(_running_entry), do: 0

  # Hard backstop applied on every live token update: stop a runaway run before
  # it balloons (e.g. a child babysitting CI in a sleep/poll loop). Re-dispatches
  # the now-bounded run up to the configured cap, then parks it for a human.
  defp maybe_enforce_token_budget(%State{} = state, issue_id, running_entry) do
    case budget_overrun_action(running_entry, effective_token_budget(), Config.agent_budget_max_retries()) do
      :within_budget ->
        state

      {:retry, attempt} ->
        Logger.warning("[budget] run over token budget; stopping and re-dispatching #{budget_log_context(running_entry, attempt)}")

        state
        |> terminate_running_issue(issue_id, false)
        |> schedule_issue_retry(issue_id, attempt, %{
          identifier: running_entry.identifier,
          project_slug: running_entry_project_slug(running_entry),
          error: "token budget exceeded (#{running_entry_total_tokens(running_entry)} tokens)"
        })

      :park ->
        Logger.error("[budget] run repeatedly over token budget; parking for human attention #{budget_log_context(running_entry, running_entry_attempt(running_entry))}")

        terminate_running_issue(state, issue_id, false)
    end
  end

  # Codex events that mean the agent is blocked waiting on a human decision.
  @agent_attention_events [:approval_required, :turn_input_required]

  # Pushes only on the transition into a waiting event, so a stream of repeated
  # approval events while the operator is away yields a single notification.
  defp maybe_notify_agent_attention(before_entry, %{event: event})
       when event in @agent_attention_events do
    if Map.get(before_entry, :last_codex_event) in @agent_attention_events do
      :ok
    else
      PushDispatcher.agent_attention_needed(%{
        identifier: before_entry.identifier,
        project_slug: running_entry_project_slug(before_entry),
        event: event
      })
    end
  end

  defp maybe_notify_agent_attention(_before_entry, _update), do: :ok

  defp maybe_log_token_progress(before_entry, after_entry) do
    before_tokens = running_entry_total_tokens(before_entry)
    after_tokens = running_entry_total_tokens(after_entry)

    if token_threshold_crossed?(before_tokens, after_tokens, @token_progress_log_interval) do
      Logger.info("[bundle] token progress #{budget_log_context(after_entry, running_entry_attempt(after_entry))}")
    end

    :ok
  end

  defp budget_log_context(running_entry, attempt) do
    "issue_identifier=#{running_entry.identifier} role=#{inspect(Map.get(running_entry, :bundle_role))} " <>
      "parent=#{inspect(Map.get(running_entry, :parent_identifier))} unit=#{inspect(Map.get(running_entry, :unit_id))} " <>
      "tokens=#{running_entry_total_tokens(running_entry)} budget=#{effective_token_budget()} " <>
      "session_id=#{inspect(Map.get(running_entry, :session_id))} attempt=#{attempt}"
  end

  # A child unit runs in a worktree branched off its OWN repository's checkout
  # inside the parent container (e.g. `<parent-ws>/back` for `clouapp/back`), not
  # the container itself. The container holds one checkout per repository the
  # bundle touches and is not a git repository, so worktreeing off it fails.
  # Falls back to the container when the child's repo cannot be resolved.
  defp child_worktree_base(container, repo)
       when is_binary(container) and is_binary(repo) and repo != "" do
    Path.join(container, Path.basename(repo))
  end

  defp child_worktree_base(container, _repo), do: container

  # Resolves the child's repository (owner/name) from the parent's execution
  # bundle unit that targets this child issue. Returns nil when the parent has no
  # resolvable bundle or no unit for the child, so the caller falls back to the
  # parent container path.
  defp child_unit_repo(parent_identifier, child_identifier)
       when is_binary(parent_identifier) and is_binary(child_identifier) do
    with {:ok, %ExecutionBundle{} = bundle} <- load_parent_bundle(parent_identifier),
         %{repo: repo} when is_binary(repo) and repo != "" <-
           bundle_unit_for_issue(bundle, child_identifier) do
      repo
    else
      _ -> nil
    end
  end

  defp child_unit_repo(_parent_identifier, _child_identifier), do: nil

  # The parent coordinator's own repository (the project's primary repo). A child
  # whose unit targets this repo is a same-repo child: it reuses the parent's
  # checkout/setup/preview instead of re-provisioning. Resolved defensively so a
  # missing project or DB never crashes dispatch (falls back to nil => not same-repo).
  defp parent_repo(parent_identifier) when is_binary(parent_identifier) do
    with slug when is_binary(slug) and slug != "" <- Context.find_project_slug(parent_identifier),
         {:ok, project} <- Context.get_project(slug) do
      project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:repo)
    else
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp parent_repo(_parent_identifier), do: nil

  # Wires a child's branch topology into its worktree opts:
  #   * `worktree_base_branch` — the start point the child's branch forks from. A
  #     dependent child forks off its predecessor's branch (so the dependency's
  #     work is present as a reference); an independent child forks off the
  #     parent's per-repo integration branch.
  #   * `pr_base` — always the parent's per-repo integration branch (the umbrella),
  #     so every child PRs into it regardless of where it forked from.
  # Each opt is omitted when its branch cannot be derived (the child then forks
  # off / PRs against the checkout's current HEAD / repo default as before).
  defp maybe_put_integration_branch(run_opts, worktree_base, pr_base) do
    run_opts
    |> put_branch_opt(:worktree_base_branch, worktree_base)
    |> put_branch_opt(:pr_base, pr_base)
  end

  defp put_branch_opt(run_opts, _key, value) when value in [nil, ""], do: run_opts
  defp put_branch_opt(run_opts, key, value) when is_binary(value), do: Keyword.put(run_opts, key, value)

  # The branch a child's worktree forks from. A dependent child forks off its
  # predecessor's branch (`feat/<predecessor>`) so the dependency's committed work
  # is its starting point before that predecessor is merged into the integration
  # branch. Independent children (and children whose only predecessors live in a
  # different repo checkout) fall back to the integration branch.
  defp worktree_base_branch_for(bundle_resolver, parent_identifier, child_identifier, unit_repo, integration_branch) do
    predecessor_worktree_base(bundle_resolver, parent_identifier, child_identifier, unit_repo) || integration_branch
  end

  defp predecessor_worktree_base(bundle_resolver, parent_identifier, child_identifier, unit_repo)
       when is_function(bundle_resolver) do
    with {:ok, %ExecutionBundle{} = bundle} <- bundle_resolver.(parent_identifier),
         unit when is_map(unit) <- bundle_unit_for_issue(bundle, child_identifier),
         predecessor when is_map(predecessor) <- deepest_same_repo_predecessor(bundle, unit, unit_repo),
         issue when is_binary(issue) and issue != "" <- Map.get(predecessor, :issue) do
      "feat/" <> safe_unit_slug(issue)
    else
      _ -> nil
    end
  end

  defp predecessor_worktree_base(_bundle_resolver, _parent_identifier, _child_identifier, _unit_repo), do: nil

  # Among the units this child `depends_on`, picks the same-repo predecessor that
  # sits deepest in the dependency chain (most transitive deps of its own), so a
  # child forking off it inherits the whole same-repo chain. Cross-repo
  # predecessors are ignored — their branch lives in another checkout.
  defp deepest_same_repo_predecessor(%ExecutionBundle{} = bundle, unit, unit_repo) do
    units_by_id = Map.new(ExecutionBundle.dispatchable_units(bundle), &{&1.id, &1})

    unit
    |> Map.get(:depends_on, [])
    |> List.wrap()
    |> Enum.map(&Map.get(units_by_id, &1))
    |> Enum.reject(&is_nil/1)
    |> Enum.filter(&same_repo_unit?(&1, unit_repo))
    |> Enum.max_by(&length(List.wrap(Map.get(&1, :depends_on, []))), fn -> nil end)
  end

  defp same_repo_unit?(unit, unit_repo) do
    repo = Map.get(unit, :repo)
    is_binary(repo) and repo != "" and is_binary(unit_repo) and repo == unit_repo
  end

  # Resolves the integration branch a child forks from and PRs into. Honors an
  # explicit `pr_base` on the bundle unit; otherwise derives `symphony/{parent}/{repo}`.
  defp integration_branch_for(bundle_resolver, parent_identifier, child_identifier, unit_repo) do
    explicit = unit_pr_base(bundle_resolver, parent_identifier, child_identifier)

    cond do
      is_binary(explicit) and explicit != "" -> explicit
      is_binary(unit_repo) and unit_repo != "" -> parent_integration_branch(parent_identifier, unit_repo)
      true -> nil
    end
  end

  defp unit_pr_base(bundle_resolver, parent_identifier, child_identifier) when is_function(bundle_resolver) do
    case bundle_resolver.(parent_identifier) do
      {:ok, %ExecutionBundle{} = bundle} ->
        case bundle_unit_for_issue(bundle, child_identifier) do
          unit when is_map(unit) -> Map.get(unit, :pr_base)
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp unit_pr_base(_bundle_resolver, _parent_identifier, _child_identifier), do: nil

  @doc false
  @spec parent_integration_branch(String.t(), String.t()) :: String.t()
  def parent_integration_branch(parent_identifier, repo)
      when is_binary(parent_identifier) and is_binary(repo) do
    "symphony/" <> safe_branch_segment(parent_identifier) <> "/" <> safe_branch_segment(repo)
  end

  defp safe_branch_segment(value) when is_binary(value) do
    value
    |> String.replace(~r{[^A-Za-z0-9._/-]+}, "-")
    |> String.replace("/", "-")
    |> String.trim("-")
  end

  defp safe_branch_segment(_value), do: "x"

  defp bundle_unit_for_issue(%ExecutionBundle{} = bundle, child_identifier) do
    bundle
    |> ExecutionBundle.dispatchable_units()
    |> Enum.find(fn unit -> Map.get(unit, :issue) == child_identifier end)
  end

  # Scopes the child run prompt: when the parent bundle resolves and declares a
  # unit for this child, carry the unit + shared contracts in the run opts so the
  # child prompt renders its unit scope and execution constraints (no PR/CI).
  defp maybe_put_bundle_unit_opts(run_opts, bundle_resolver, parent_identifier, child_identifier)
       when is_function(bundle_resolver) do
    case bundle_resolver.(parent_identifier) do
      {:ok, %ExecutionBundle{} = bundle} ->
        case bundle_unit_for_issue(bundle, child_identifier) do
          unit when is_map(unit) ->
            run_opts
            |> Keyword.put(:bundle_unit, unit)
            |> Keyword.put(:shared_contracts, bundle.shared_contracts || [])

          _ ->
            run_opts
        end

      _ ->
        run_opts
    end
  end

  defp maybe_put_bundle_unit_opts(run_opts, _bundle_resolver, _parent_identifier, _child_identifier),
    do: run_opts

  # Defensive default loader: the dispatch path runs inside the orchestrator
  # GenServer, so any DB/parse failure must degrade to :error rather than crash
  # the run-context build.
  defp safe_load_parent_bundle(parent_identifier) do
    case load_parent_bundle(parent_identifier) do
      {:ok, %ExecutionBundle{} = bundle} -> {:ok, bundle}
      _ -> :error
    end
  rescue
    _ -> :error
  catch
    _, _ -> :error
  end

  defp git_repo?(path) when is_binary(path), do: File.dir?(Path.join(path, ".git"))
  defp git_repo?(_path), do: false

  defp safe_unit_slug(value) when is_binary(value), do: String.replace(value, ~r/[^A-Za-z0-9_.-]+/, "-")
  defp safe_unit_slug(_value), do: "child"

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
        paused: MapSet.delete(state.paused, issue_id),
        retry_attempts: Map.delete(state.retry_attempts, issue_id)
    }
  end

  defp apply_normal_completion(%State{} = state, running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:error, {:resume_conversation_failed, conversation_id, :not_found} = reason}
      when is_binary(conversation_id) ->
        park_missing_provider_conversation(state, running_entry, issue_id, reason)

      {:error, {:resume_session_not_found, conversation_id} = reason}
      when is_binary(conversation_id) ->
        park_missing_provider_conversation(state, running_entry, issue_id, reason)

      {:error, reason} ->
        Logger.warning("Agent run failed for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier} reason=#{inspect(reason)}; scheduling retry")

        record_session_run_failure(running_entry, reason)

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

  defp park_missing_provider_conversation(state, running_entry, issue_id, reason) do
    Logger.error(
      "Agent provider conversation no longer exists for issue_id=#{issue_id} " <>
        "issue_identifier=#{running_entry.identifier} reason=#{inspect(reason)}; " <>
        "parking the run until an explicit hard reset"
    )

    record_session_run_failure(running_entry, reason)
    persist_provider_resume_block(running_entry, reason)

    state
    |> complete_issue(issue_id)
    |> release_issue_claim(issue_id)
  end

  defp persist_provider_resume_block(
         %{execution_session_id: session_id, agent_kind: provider},
         {:resume_conversation_failed, conversation_id, :not_found}
       )
       when is_integer(session_id) and is_binary(provider) and is_binary(conversation_id) do
    case ExecutionSession.block_provider_resume(session_id, provider, conversation_id) do
      {:ok, _thread} ->
        :ok

      {:error, reason} ->
        Logger.error("Could not persist provider resume block session_id=#{session_id} reason=#{inspect(reason)}")
    end
  end

  defp persist_provider_resume_block(
         %{execution_session_id: session_id, agent_kind: provider},
         {:resume_session_not_found, conversation_id}
       )
       when is_integer(session_id) and is_binary(provider) and is_binary(conversation_id) do
    persist_provider_resume_block(
      %{execution_session_id: session_id, agent_kind: provider},
      {:resume_conversation_failed, conversation_id, :not_found}
    )
  end

  defp persist_provider_resume_block(_running_entry, _reason), do: :ok

  defp apply_successful_completion(%State{} = state, running_entry, issue_id) do
    case Map.get(running_entry, :agent_outcome) do
      {:incomplete, {:validate_gate, _violations}} ->
        Logger.warning("Validate gate incomplete for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier}; skipping completion transition")

        maybe_annotate_incomplete(running_entry, issue_id)
        finish_or_requeue_child(state, running_entry, issue_id, :validate_gate_incomplete)

      {:incomplete, {:publish_gate, _violations}} ->
        Logger.warning("Publish gate incomplete for issue_id=#{issue_id} issue_identifier=#{running_entry.identifier}; skipping completion transition")

        maybe_annotate_incomplete(running_entry, issue_id)
        finish_or_requeue_child(state, running_entry, issue_id, :publish_gate_incomplete)

      _other ->
        if parent_completion_held?(running_entry.issue) do
          Logger.info("Holding parent completion; child runs incomplete for #{issue_context(running_entry.issue)}")

          complete_issue(state, issue_id)
        else
          apply_gated_successful_completion(state, running_entry, issue_id)
        end
    end
  end

  @doc false
  @spec parent_completion_held_for_test(Issue.t(), keyword()) :: boolean()
  def parent_completion_held_for_test(%Issue{} = issue, opts) do
    parent_completion_held?(issue, opts)
  end

  @doc false
  @spec coordinator_parent_dispatch_held_for_test(Issue.t(), keyword()) :: boolean()
  def coordinator_parent_dispatch_held_for_test(%Issue{} = issue, opts) do
    coordinator_parent_dispatch_held?(issue, opts)
  end

  # A coordinator parent (one that owns `child_run`/`subagent_unit` units) must
  # not be dispatched as a code agent while its children are still in flight: the
  # orchestrator dispatches and gates the children directly, so re-running a
  # heavy parent agent every poll only burns tokens (the parent re-discovers the
  # same context each cycle). The parent is released for dispatch — to run its
  # final publish/integration turn — once every child unit is done. Mirrors the
  # `parent_completion_held?/2` predicate so dispatch and completion gating agree.
  defp coordinator_parent_dispatch_held?(%Issue{} = issue, opts \\ []) do
    parent_completion_held?(issue, opts)
  end

  # A coordinator parent must not transition to a terminal state until all of its
  # child_run units are done. We re-load the parent's own execution bundle and
  # check sibling terminal state; on completion the parent is cleared from the
  # running map (no transition) so the next poll re-dispatches it to re-check,
  # and it finalises once every child is done. Graceful: a parent whose bundle
  # cannot be resolved, or that owns no child runs, completes normally.
  defp parent_completion_held?(%Issue{} = issue, opts \\ []) do
    bundle_loader = Keyword.get(opts, :bundle_loader, &load_parent_bundle/1)
    done_resolver = Keyword.get(opts, :done_units, &resolve_done_units/1)

    case bundle_loader.(issue.identifier) do
      {:ok, %ExecutionBundle{} = bundle} ->
        BundleCoordinator.coordinator?(bundle) and
          lab_bundle_child_orchestration?(opts) and
          not BundleCoordinator.children_all_done?(bundle, done_resolver.(bundle))

      _ ->
        false
    end
  end

  defp lab_bundle_child_orchestration?(opts) when is_list(opts) do
    Keyword.get(opts, :lab_bundle_child_orchestration, LabSettings.bundle_child_orchestration?())
  end

  defp lab_bundle_child_orchestration?(_opts), do: LabSettings.bundle_child_orchestration?()

  defp apply_gated_successful_completion(%State{} = state, running_entry, issue_id) do
    issue = running_entry.issue
    workspace = Workspace.path_for_issue(issue)
    deps = publish_contract_deps_for(issue, state.publish_contract_deps)

    case run_publish_contract(issue, workspace, deps) do
      {:ok, prs} ->
        remove_label(running_entry, @blocked_run_label)
        record_run_pull_requests(issue, prs)
        persist_evidence(running_entry, issue, workspace)
        maybe_annotate_incomplete(running_entry, issue_id)

        PushDispatcher.agent_run_finished(%{
          identifier: issue.identifier,
          project_slug: issue.project_slug,
          title: issue.title
        })

        apply_transition_after_contract(state, running_entry, issue_id)

      {:blocked, violations, reason} ->
        Logger.warning("Run blocked for issue_id=#{issue_id} issue_identifier=#{issue.identifier} reason=#{inspect(reason)}; skipping completion transition")

        annotate_blocked(running_entry, issue_id, violations)
        finish_or_requeue_child(state, running_entry, issue_id, {:publish_blocked, reason})
    end
  end

  # Anti-stranding for bundle children: a child whose run ended without reaching a
  # terminal state (incomplete gate or publish-blocked) would otherwise sit idle
  # in a non-dispatch active state and stall the whole parent bundle. Re-queue it
  # (bounded) so the poll re-dispatches it; park it after the cap. Non-child runs
  # keep their existing terminal behavior unchanged.
  defp finish_or_requeue_child(%State{} = state, running_entry, issue_id, reason) do
    case child_requeue_action(running_entry, Config.agent_budget_max_retries()) do
      {:requeue, attempt} ->
        Logger.warning("[bundle] re-queueing incomplete child to avoid stranding the bundle reason=#{inspect(reason)} #{budget_log_context(running_entry, attempt)}")

        schedule_issue_retry(state, issue_id, attempt, %{
          identifier: running_entry.identifier,
          project_slug: running_entry_project_slug(running_entry),
          error: "bundle child incomplete; re-queued (#{inspect(reason)})"
        })

      :park ->
        Logger.error("[bundle] parking child after repeated incomplete runs reason=#{inspect(reason)} #{budget_log_context(running_entry, running_entry_attempt(running_entry))}")

        complete_issue(state, issue_id)

      :default ->
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
    pr_base = pr_base_for_issue(issue)

    Map.merge(base, %{
      repo_states: fn workspace -> RunContract.repo_states(workspace, default_branches: default_branches) end,
      pr_checker: RunContract.gh_pr_checker(issue_identifier: identifier, marker_key: marker_key),
      finalize: fn workspace, iss ->
        Finalizer.finalize(workspace, iss, default_branches: default_branches, pr_base: pr_base)
      end
    })
  end

  # A bundle child publishes into the parent's per-repo integration branch rather
  # than the repo default, so its mechanical finalizer targets `--base <pr_base>`.
  # Parents/standalone runs return nil (publish to the repo default branch).
  defp pr_base_for_issue(%Issue{parent_identifier: parent, identifier: identifier, repository_full_name: repo})
       when is_binary(parent) and parent != "" do
    unit_repo = child_unit_repo(parent, identifier) || repo
    integration_branch_for(&safe_load_parent_bundle/1, parent, identifier, unit_repo)
  end

  defp pr_base_for_issue(_issue), do: nil

  # credo:disable-for-lines:30
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

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
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
          |> Evidence.Manifest.resolve_dir()
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
        PushDispatcher.evidence_generated(issue, record)

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
      |> Enum.flat_map(fn run -> List.wrap(run["screenshots"]) end)
      |> Enum.take(4)
      |> Enum.map_join("\n", fn entry ->
        path = SymphonyElixir.Evidence.Manifest.artifact_path(entry)
        alt = SymphonyElixir.Evidence.Manifest.artifact_label(entry) || path

        "![#{markdown_image_alt(alt)}](#{evidence_artifact_url(record, issue, path, base_url)})"
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
      |> Enum.map_join("/", &URI.encode/1)

    base = "#{base_url}/api/tracker/v1/projects/#{issue.project_slug}/issues/#{issue.identifier}"
    "#{base}/evidence/#{record.run_id}/artifacts/#{encoded_rel}"
  end

  defp markdown_image_alt(label) when is_binary(label) do
    label
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
    handoff_note = IncompleteReason.handoff_note(reason)

    """
    ## Codex Workpad

    > ⚠️ Symphony auto-note: this agent run ended **incomplete** (#{IncompleteReason.reason_text(reason)}).
    >
    > #{handoff_note}
    > - Please review the workspace state and move the issue back to Rework (or re-dispatch) if the task is not actually done.
    """
  end

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
      MapSet.member?(state.paused, issue_id) ->
        Logger.info("Skipping retry for paused issue_id=#{issue_id} issue_identifier=#{issue.identifier}; awaiting explicit resume")

        {:noreply, release_issue_claim(state, issue_id)}

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
      {:noreply, dispatch_issue(state, issue, attempt)}
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

  defp unmark_issue_paused(%State{} = state, issue_id) do
    %{state | paused: MapSet.delete(state.paused, issue_id)}
  end

  defp mark_issue_paused(%State{} = state, issue_id) do
    %{state | paused: MapSet.put(state.paused, issue_id)}
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

  @spec steer(String.t(), String.t(), pid() | nil, keyword()) :: :ok | {:error, term()}
  def steer(identifier, message, reply_to \\ nil, opts \\ [])

  def steer(identifier, message, reply_to, opts) when is_binary(identifier) and is_list(opts) do
    steer(__MODULE__, identifier, message, reply_to, opts)
  end

  def steer(server, identifier, message, reply_to) when is_binary(identifier) do
    steer(server, identifier, message, reply_to, [])
  end

  @spec steer(GenServer.server(), String.t(), String.t(), pid() | nil, keyword()) ::
          :ok | {:error, term()}
  def steer(server, identifier, message, reply_to, opts)
      when is_binary(identifier) and is_list(opts) do
    if Process.whereis(server) do
      GenServer.call(server, {:steer, identifier, message, reply_to, opts})
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
          execution_session_id: Map.get(metadata, :execution_session_id),
          codex_app_server_pid: metadata.codex_app_server_pid,
          agent_input_tokens: metadata.agent_input_tokens,
          agent_output_tokens: metadata.agent_output_tokens,
          agent_total_tokens: metadata.agent_total_tokens,
          turn_count: Map.get(metadata, :turn_count, 0),
          started_at: metadata.started_at,
          last_codex_timestamp: metadata.last_codex_timestamp,
          last_codex_message: metadata.last_codex_message,
          last_codex_event: metadata.last_codex_event,
          runtime_seconds: running_seconds(metadata.started_at, now),
          bundle_role: Map.get(metadata, :bundle_role),
          parent_identifier: Map.get(metadata, :parent_identifier),
          unit_id: Map.get(metadata, :unit_id),
          repo: Map.get(metadata, :repo),
          child_identifiers: Map.get(metadata, :child_identifiers) || []
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
        Logger.info("Stopping agent run for issue_identifier=#{String.trim(identifier)} issue_id=#{issue_id} (paused by operator)")

        running_entry = Map.get(state.running, issue_id)
        record_session_abort(running_entry, "user_stop", "Stopped manually via hard reset")
        finish_execution_session(running_entry, "aborted")

        # Terminate clears the paused flag, so mark AFTER so the poll loop won't
        # silently re-dispatch this issue until an explicit resume/dispatch.
        state =
          state
          |> terminate_running_issue(issue_id, false)
          |> mark_issue_paused(issue_id)

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

  # credo:disable-for-lines:40
  def handle_call({:request_dispatch, identifier}, _from, state) do
    normalized = String.trim(identifier)

    # The scheduled poll can start this task just before an explicit mobile
    # dispatch reaches the GenServer.  That is the same execution, therefore
    # it must be acknowledged idempotently instead of reported as a failure.
    case find_running_by_identifier(state, normalized) do
      running_entry when is_map(running_entry) ->
        {:reply, {:ok, running_dispatch_result(running_entry)}, state}

      nil ->
        request_dispatch_for_idle_issue(normalized, state)
    end
  end

  defp request_dispatch_for_idle_issue(normalized, state) do
    case fetch_issue_by_identifier(normalized) do
      {:ok, %Issue{} = issue} ->
        cond do
          Map.has_key?(state.running, issue.id) ->
            running_entry = Map.fetch!(state.running, issue.id)
            {:reply, {:ok, running_dispatch_result(running_entry)}, state}

          manual_dispatch_candidate?(issue) ->
            state =
              state
              |> cancel_retry_in_state(normalized)
              |> release_issue_claim(issue.id)
              |> unmark_issue_paused(issue.id)

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

  defp running_dispatch_result(running_entry) do
    %{
      dispatched: false,
      already_running: true,
      issue_identifier: Map.get(running_entry, :identifier),
      execution_session_id: Map.get(running_entry, :execution_session_id) || Map.get(running_entry, :session_id)
    }
  end

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  def handle_call({:steer, identifier, message, reply_to, opts}, _from, state) when is_list(opts) do
    alias SymphonyElixir.Assistant.Payload

    trimmed = if is_binary(message), do: String.trim(message), else: ""
    raw_attachments = Keyword.get(opts, :attachments, [])
    project_slug = Keyword.get(opts, :project_slug, "")

    normalized =
      if is_binary(project_slug) and project_slug != "" do
        Payload.normalize_attachments(raw_attachments, project_slug)
      else
        []
      end

    enriched = Payload.enrich_message(trimmed, normalized)
    input = Payload.turn_input_items(enriched, normalized)

    cond do
      find_running_by_identifier(state, identifier) == nil ->
        {:reply, {:error, :ActiveTurnNotSteerable}, state}

      enriched == "" and normalized == [] ->
        {:reply, {:error, :empty_message}, state}

      trimmed != "" and raw_attachments != [] and normalized == [] ->
        {:reply, {:error, :attachment_processing_failed}, state}

      true ->
        %{pid: pid} = find_running_by_identifier(state, identifier)
        send(pid, {:codex_steer, input, reply_to})
        {:reply, :ok, state}
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

  # credo:disable-for-lines:15
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
      | agent_totals: AgentTotals.apply_delta(state.agent_totals, completion_delta),
        agent_totals_by_project:
          AgentTotals.apply_project_delta(
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
      !issue_blocked_by_non_terminal?(issue, terminal_set(sets)) and
      !provider_resume_blocked?(issue)
  end

  defp manual_dispatch_candidate?(%Issue{} = issue) do
    sets = project_state_sets(issue)

    candidate_issue?(issue, active_set(sets), terminal_set(sets)) and
      !issue_blocked_by_non_terminal?(issue, terminal_set(sets)) and
      !provider_resume_blocked?(issue)
  end

  defp provider_resume_blocked?(%Issue{project_slug: project_slug, identifier: identifier})
       when is_binary(project_slug) and is_binary(identifier) do
    ExecutionSession.provider_resume_blocked?(project_slug, identifier)
  end

  defp provider_resume_blocked?(_issue), do: false

  @doc false
  @spec provider_resume_blocked_for_test(Issue.t()) :: boolean()
  def provider_resume_blocked_for_test(%Issue{} = issue), do: provider_resume_blocked?(issue)

  defp fetch_issue_by_identifier(identifier) when is_binary(identifier) do
    case Tracker.fetch_issue_states_by_ids([identifier]) do
      {:ok, [%Issue{} = issue | _]} -> {:ok, issue}
      {:ok, []} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  defp dispatch_issue_for_manual_resume(%State{} = state, issue) do
    case manual_revalidate_issue(issue) do
      {:ok, refreshed_issue} -> do_dispatch_issue(state, refreshed_issue, nil)
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
      | agent_totals: AgentTotals.apply_delta(agent_totals, token_delta),
        agent_totals_by_project: AgentTotals.apply_project_delta(by_project, project_slug, token_delta)
    }
  end

  defp apply_codex_token_delta(state, _project_slug, _token_delta), do: state

  defp running_entry_project_slug(%{issue: %{project_slug: slug}}), do: slug
  defp running_entry_project_slug(%{project_slug: slug}), do: slug
  defp running_entry_project_slug(_running_entry), do: nil

  defp apply_agent_rate_limits(%State{} = state, %{rate_limits: %{} = rate_limits}),
    do: %{state | agent_rate_limits: rate_limits}

  defp apply_agent_rate_limits(state, _update), do: state

  defp running_seconds(%DateTime{} = started_at, %DateTime{} = now) do
    max(0, DateTime.diff(now, started_at, :second))
  end

  defp running_seconds(_started_at, _now), do: 0
end
