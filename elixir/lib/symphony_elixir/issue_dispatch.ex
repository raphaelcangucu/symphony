defmodule SymphonyElixir.IssueDispatch do
  @moduledoc """
  Manual resume/restart controls for coding-agent execution from the tracker UI.

  Cancels orchestrator retry backoff, optionally records guidance on the issue,
  ensures the issue is in a dispatchable state, and nudges the orchestrator to
  pick the issue up again.
  """

  alias SymphonyElixir.{
    AgentPreference,
    ExecutionMode,
    IssueDispatchPrep,
    Orchestrator,
    ProjectConfig,
    Repo,
    SessionEvents,
    Workspace
  }

  alias SymphonyElixir.Agent.ExecutionSession

  alias SymphonyElixir.Claude.GoalControl, as: ClaudeGoal
  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Tracker.{IssueAdapter, IssueDTO}
  alias SymphonyElixirWeb.TrackerPresenter

  use Gettext, backend: SymphonyElixirWeb.Gettext

  require Logger

  # Compile-time copy of the canonical list so it can be used in guards.
  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()

  @type action :: :resume | :hard_reset | :stop | :continue_work
  @type opts :: %{
          optional(:agent) => String.t() | nil,
          optional(:goal) => String.t() | nil,
          optional(:instructions) => String.t() | nil,
          optional(:target_status) => String.t() | nil,
          optional(:model) => String.t() | nil,
          optional(:effort) => String.t() | nil,
          optional(:mode) => String.t() | nil
        }

  @spec resume(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def resume(%Project{} = project, identifier, opts \\ %{}) when is_binary(identifier) do
    dispatch(project, identifier, :resume, opts)
  end

  @spec restart(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def restart(%Project{}, identifier, _opts \\ %{}) when is_binary(identifier) do
    {:error, :invalid_action}
  end

  @doc """
  Return an issue from a human-review wait state to active work: move to the
  rework target status (usually the in-progress column), then resume the agent
  with optional instructions.
  """
  @spec continue_work(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def continue_work(%Project{} = project, identifier, opts \\ %{}) when is_binary(identifier) do
    dispatch(project, identifier, :continue_work, opts)
  end

  @doc """
  Hard reset: stop any active run, clear the agent session (sidecar + stored
  session id) and the in-memory turn/token counters, then dispatch a fresh run.
  The on-disk workspace and its git state are left intact.
  """
  @spec hard_reset(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def hard_reset(%Project{} = project, identifier, opts \\ %{}) when is_binary(identifier) do
    dispatch(project, identifier, :hard_reset, opts)
  end

  @doc """
  Pause an active run: stop the running agent and cancel any pending retry,
  leaving the agent session (sidecar + stored session id) and the workspace
  intact so the issue can be resumed later. Does not move the issue or
  re-dispatch.
  """
  @spec stop(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def stop(%Project{} = project, identifier, _opts \\ %{}) when is_binary(identifier) do
    with {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         :ok <- stop_active_run(identifier),
         :ok <- cancel_retry(identifier) do
      {:ok, reloaded} = IssueAdapter.dispatch(project, :get_issue, [identifier])

      {:ok,
       %{
         action: "stop",
         message: dispatch_message(:stop, reloaded),
         issue: TrackerPresenter.issue(reloaded)
       }}
    end
  end

  defp dispatch(%Project{} = project, identifier, action, opts)
       when action in [:resume, :hard_reset, :continue_work] do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         agent_kind = effective_agent_kind(project, issue, opts),
         opts = inject_context_refs(project, identifier, opts),
         :ok <- IssueDispatchPrep.prepare_for_dispatch(project, identifier, agent_kind),
         {:ok, _comment} <- maybe_add_comment(project, identifier, action, opts),
         {:ok, _} <- maybe_update_agent(project, identifier, opts, agent_kind),
         :ok <- maybe_persist_agent_settings(project, identifier, opts, agent_kind),
         :ok <- maybe_route_agent_goal(project, identifier, opts, agent_kind),
         :ok <- maybe_hard_reset(project, identifier, issue, action),
         {:ok, _} <- maybe_move_for_action(project, issue, action, opts),
         :ok <- cancel_retry(identifier),
         :ok <- nudge_manual_dispatch(identifier),
         :ok <- maybe_record_dispatch_activity(project, identifier, action, opts) do
      {:ok, reloaded} = IssueAdapter.dispatch(project, :get_issue, [identifier])

      {:ok,
       %{
         action: Atom.to_string(action),
         message: dispatch_message(action, reloaded),
         issue: TrackerPresenter.issue(reloaded)
       }}
    end
  end

  defp inject_context_refs(%Project{} = project, identifier, opts) do
    context_refs = Map.get(opts, :context_refs) || Map.get(opts, "context_refs") || []

    if context_refs == [] do
      opts
    else
      scope = SymphonyElixir.AttachedContexts.execution_scope(project.slug, identifier)
      instructions = Map.get(opts, :instructions) || Map.get(opts, "instructions") || ""
      injected = SymphonyElixir.AttachedContexts.append_to_instructions(scope, instructions, context_refs: context_refs)

      opts
      |> Map.delete("instructions")
      |> Map.put(:instructions, injected)
    end
  end

  defp maybe_add_comment(project, identifier, action, opts) do
    if comment_required?(action, Map.get(opts, :instructions)) do
      body = comment_body(action, Map.get(opts, :instructions))

      IssueAdapter.dispatch(project, :add_comment, [identifier, body, %{"author" => "tracker"}])
    else
      {:ok, nil}
    end
  end

  defp comment_required?(:hard_reset, _instructions), do: true

  defp comment_required?(_action, _instructions), do: true

  defp maybe_record_dispatch_activity(project, identifier, :hard_reset = action, _opts) do
    metadata = %{"action" => Atom.to_string(action)}

    case Context.record_activity_event(project.slug, identifier, "agent_dispatch_requested", metadata) do
      {:ok, _event} ->
        :ok

      {:error, reason} ->
        Logger.debug("Skipping dispatch activity identifier=#{identifier} reason=#{inspect(reason)}")
        :ok
    end
  end

  defp maybe_record_dispatch_activity(_project, _identifier, _action, _opts), do: :ok

  defp comment_body(action, instructions) do
    base =
      case action do
        :resume ->
          """
          ## Resume agent run (tracker)

          A previous agent run was interrupted or stalled. Resume from the current workspace and session log — do not restart from scratch unless the workspace is empty.

          **Priority on resume:**
          1. Read the workpad `### Plan` checklist and continue the next incomplete `[ ]` or `[~]` item first.
          2. Do **not** front-load full test/evidence runs unless implementation is already complete and only validation was blocked.
          3. Run VALIDATE/evidence (`evidence` skill) when handoff is ready — after deliverables exist and before moving to review.

          Stale `targeted tests:` lines in the workpad describe a previous attempt; retry them only after the current plan item is implemented. Evidence before all plan items are `[x]` is slice evidence, not final handoff evidence.
          """

        :hard_reset ->
          """
          ## New agent thread (tracker)

          The previous agent session was discarded (turns and token counters cleared) and a brand-new Codex thread is starting in the existing workspace. The workspace is preserved — review the existing workspace and git state, then continue the ticket.

          Do not long-poll external CI or deployment checks inside this agent turn. Check external status once; if checks are still pending, report that state and stop so Symphony can resume later without burning the thread context.
          """

        :continue_work ->
          """
          ## Continue agent work (tracker)

          This issue was sent back from human review. Move to active implementation and follow the instructions below.

          **Priority:**
          1. Follow the human/tracker instructions first.
          2. Read the workpad `### Plan` checklist and continue the next incomplete `[ ]` or `[~]` item.
          3. Run final VALIDATE/evidence (`evidence` skill) only when every plan item is `[x]`.
          """
      end

    trimmed = instructions |> normalize_optional_string()

    case trimmed do
      nil -> String.trim(base)
      extra -> String.trim(base) <> "\n\n" <> extra
    end
  end

  # Codex goals are the Codex thread's responsibility (routed via
  # `maybe_route_codex_goal/4`), so only persist `agent_goal` as workflow
  # guidance for non-Codex agents.
  defp maybe_update_agent(project, identifier, opts, agent_kind) do
    agent = normalize_agent(Map.get(opts, :agent))
    goal = normalize_optional_string(Map.get(opts, :goal))
    goal_attr = if agent_kind == "codex", do: nil, else: goal

    attrs =
      %{}
      |> maybe_put("agent", agent)
      |> maybe_put("agent_goal", goal_attr)

    if attrs == %{} do
      {:ok, nil}
    else
      IssueAdapter.dispatch(project, :update_issue, [identifier, attrs])
    end
  end

  # Persist the operator's per-issue model/effort/mode selection so the
  # orchestrator (AgentRunner) can apply it on the autonomous run. Best-effort:
  # a persistence failure logs and continues, never blocking the dispatch.
  defp maybe_persist_agent_settings(%Project{} = project, identifier, opts, agent_kind) do
    attrs =
      %{agent_kind: agent_kind}
      |> maybe_put(:model, normalize_optional_string(Map.get(opts, :model)))
      |> maybe_put(:effort, normalize_optional_string(Map.get(opts, :effort)))
      |> maybe_put(:mode, normalize_dispatch_mode(Map.get(opts, :mode)))

    case Context.put_agent_settings(project.slug, identifier, attrs) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.debug("Skipping agent-settings persist identifier=#{identifier} reason=#{inspect(reason)}")
        :ok
    end
  end

  # nil/blank mode is left unset (AgentRunner falls back to the default at
  # runtime); a provided-but-invalid mode is coerced to the default.
  defp normalize_dispatch_mode(value) do
    case normalize_optional_string(value) do
      nil -> nil
      mode -> ExecutionMode.normalize(mode)
    end
  end

  # When a dispatch supplies a goal, establish it on the agent-native surface
  # (Codex thread/goal or Claude /goal mirror). Best-effort so a transient failure
  # never blocks resume/restart.
  defp maybe_route_agent_goal(project, identifier, opts, "codex") do
    case normalize_optional_string(Map.get(opts, :goal)) do
      nil ->
        :ok

      objective ->
        case GoalControl.set_objective(project, identifier, objective) do
          {:ok, _goal} ->
            :ok

          {:error, reason} ->
            Logger.debug("Skipping Codex goal routing on dispatch identifier=#{identifier} reason=#{inspect(reason)}")
            :ok
        end
    end
  end

  defp maybe_route_agent_goal(project, identifier, opts, "claude") do
    case normalize_optional_string(Map.get(opts, :goal)) do
      nil ->
        :ok

      objective ->
        case ClaudeGoal.set_objective(project, identifier, :execution, objective) do
          {:ok, _goal} ->
            :ok

          {:error, reason} ->
            Logger.debug("Skipping Claude goal routing on dispatch identifier=#{identifier} reason=#{inspect(reason)}")
            {:error, reason}
        end
    end
  end

  defp maybe_route_agent_goal(_project, _identifier, _opts, _agent_kind), do: :ok

  # Effective agent kind for this dispatch: an explicit `opts[:agent]` override
  # wins, otherwise the reusable execution thread's agent_kind, otherwise
  # resolve task labels over the project default.
  defp effective_agent_kind(%Project{slug: project_slug} = project, %IssueDTO{} = issue, opts)
       when is_binary(project_slug) do
    case normalize_agent(Map.get(opts, :agent)) do
      agent when is_binary(agent) ->
        agent

      _ ->
        case execution_thread_agent_kind(project_slug, issue.identifier) do
          kind when is_binary(kind) ->
            kind

          nil ->
            project_kind =
              project
              |> Repo.preload(:setup)
              |> ProjectConfig.resolve()
              |> Map.get(:agent_kind)

            AgentPreference.resolve(issue.labels || [], project_kind)
        end
    end
  end

  defp execution_thread_agent_kind(project_slug, identifier)
       when is_binary(project_slug) and is_binary(identifier) do
    project_slug
    |> ExecutionSession.latest_agent_kind(identifier)
    |> AgentPreference.normalize()
  end

  defp execution_thread_agent_kind(_project_slug, _identifier), do: nil

  defp maybe_hard_reset(%Project{} = project, identifier, %IssueDTO{} = issue, :hard_reset) do
    stop_active_run(identifier)
    clear_agent_session(project, identifier, issue)
    archive_execution_session(project, identifier)
    :ok
  end

  defp maybe_hard_reset(_project, _identifier, _issue, _action), do: :ok

  defp stop_active_run(identifier) do
    case Orchestrator.stop_issue(identifier) do
      :ok -> :ok
      :not_found -> :ok
      :unavailable -> :ok
    end
  end

  # Hard reset starts a brand-new orchestrator execution session. Archive the
  # latest reusable issue_execution so ensure/3 does not reopen it on resume.
  defp archive_execution_session(%Project{slug: slug}, identifier)
       when is_binary(slug) and is_binary(identifier) do
    case ExecutionSession.archive_latest(slug, identifier) do
      {:ok, _} ->
        :ok

      {:error, reason} ->
        Logger.warning("Hard reset could not archive execution session identifier=#{identifier} reason=#{inspect(reason)}")

        :ok
    end
  end

  defp archive_execution_session(_project, _identifier), do: :ok

  defp clear_agent_session(%Project{} = project, identifier, %IssueDTO{} = issue) do
    workspace = run_workspace(project, identifier, issue)
    CodexStore.clear(workspace)
    SessionEvents.clear(workspace)

    case Context.clear_agent_session_id(project.slug, identifier) do
      {:ok, _record} ->
        :ok

      {:error, reason} ->
        Logger.warning("Hard reset could not clear agent session id identifier=#{identifier} reason=#{inspect(reason)}")
        :ok
    end
  end

  defp run_workspace(%Project{} = project, identifier, %IssueDTO{} = issue) do
    %{
      id: issue.id,
      identifier: identifier,
      project_slug: issue.project_slug || project.slug
    }
    |> Workspace.path_for_issue()
  end

  defp maybe_move_for_action(%Project{} = project, %IssueDTO{} = issue, :continue_work, opts) do
    config = project |> Repo.preload(:setup) |> ProjectConfig.resolve()
    target = resolve_rework_target(config, opts)

    if status_matches?(issue, target) do
      {:ok, nil}
    else
      with {:ok, moved} <- IssueAdapter.dispatch(project, :move_issue, [issue.identifier, %{"status" => target}]) do
        {:ok, moved}
      end
    end
  end

  defp maybe_move_for_action(%Project{} = project, %IssueDTO{} = issue, _action, _opts) do
    maybe_move_for_dispatch(project, issue)
  end

  defp maybe_move_for_dispatch(%Project{} = project, %IssueDTO{} = issue) do
    config = project |> Repo.preload(:setup) |> ProjectConfig.resolve()

    if issue_in_active_states?(issue, config) do
      {:ok, nil}
    else
      with {:ok, status} <- resolve_dispatch_status(project, config),
           {:ok, moved} <- IssueAdapter.dispatch(project, :move_issue, [issue.identifier, %{"status" => status}]) do
        {:ok, moved}
      end
    end
  end

  defp resolve_rework_target(config, opts) do
    case normalize_optional_string(Map.get(opts, :target_status)) do
      status when is_binary(status) -> status
      _ -> infer_rework_target(config)
    end
  end

  defp infer_rework_target(config) do
    active = config.active_states || []
    dispatch = MapSet.new(config.dispatch_states || [])

    case Enum.find(active, &(not MapSet.member?(dispatch, &1))) do
      status when is_binary(status) ->
        status

      _ ->
        Enum.find(["Em andamento", "In Progress", "Rework"], &(&1 in active)) ||
          List.first(active) ||
          List.first(config.dispatch_states || []) ||
          "In Progress"
    end
  end

  defp status_matches?(%IssueDTO{} = issue, target) when is_binary(target) do
    case status_name(issue.status) do
      name when is_binary(name) -> normalize_status_name(name) == normalize_status_name(target)
      _ -> false
    end
  end

  defp status_matches?(_issue, _target), do: false

  defp issue_in_active_states?(%IssueDTO{status: status}, config) do
    name = status_name(status)

    if is_binary(name) do
      name
      |> normalize_status_name()
      |> then(&MapSet.member?(active_state_set(config), &1))
    else
      false
    end
  end

  defp issue_in_active_states?(_issue, _config), do: false

  defp status_name(%{name: name}) when is_binary(name), do: name
  defp status_name(%{"name" => name}) when is_binary(name), do: name
  defp status_name(name) when is_binary(name), do: name
  defp status_name(_status), do: nil

  defp active_state_set(config) do
    (config.active_states || [])
    |> Enum.map(&normalize_status_name/1)
    |> MapSet.new()
  end

  defp resolve_dispatch_status(%Project{} = project, config) do
    candidates =
      (config.dispatch_states || []) ++
        (config.active_states || []) ++
        ["In Progress", "Em andamento", "Selected for Development"]

    with {:ok, statuses} <- IssueAdapter.dispatch(project, :list_statuses, []) do
      names =
        statuses
        |> Enum.map(fn status -> Map.get(status, :name) || Map.get(status, "name") end)
        |> Enum.reject(&is_nil/1)

      case Enum.find(candidates, &(&1 in names)) do
        nil -> {:error, :status_not_found}
        status -> {:ok, status}
      end
    end
  end

  defp cancel_retry(identifier) do
    case Orchestrator.cancel_retry(identifier) do
      :ok -> :ok
      :not_found -> :ok
      :unavailable -> {:error, :orchestrator_unavailable}
    end
  end

  defp nudge_manual_dispatch(identifier) do
    case Orchestrator.request_dispatch(identifier) do
      {:ok, _result} -> :ok
      :unavailable -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp dispatch_message(:resume, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Resuming agent work on %{identifier}", identifier: identifier)

  defp dispatch_message(:hard_reset, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Starting a new agent thread for %{identifier}", identifier: identifier)

  defp dispatch_message(:continue_work, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Continuing agent work on %{identifier}", identifier: identifier)

  defp dispatch_message(:stop, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Paused agent run for %{identifier} — resume when ready", identifier: identifier)

  defp normalize_agent(agent) when agent in @agent_kinds, do: agent
  defp normalize_agent(_agent), do: nil

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil

  defp maybe_put(attrs, _key, nil), do: attrs
  defp maybe_put(attrs, key, value), do: Map.put(attrs, key, value)

  defp normalize_status_name(value) when is_binary(value),
    do: value |> String.trim() |> String.downcase()

  defp normalize_status_name(_value), do: ""
end
