defmodule SymphonyElixir.IssueDispatch do
  @moduledoc """
  Manual resume/restart controls for coding-agent execution from the tracker UI.

  Cancels orchestrator retry backoff, optionally records guidance on the issue,
  ensures the issue is in a dispatchable state, and nudges the orchestrator to
  pick the issue up again.
  """

  alias SymphonyElixir.{AgentPreference, Orchestrator, ProjectConfig, Repo, Workspace}
  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.Codex.Session, as: CodexSession
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Tracker.{IssueAdapter, IssueDTO}
  alias SymphonyElixirWeb.TrackerPresenter

  use Gettext, backend: SymphonyElixirWeb.Gettext

  require Logger

  @type action :: :resume | :restart | :hard_reset | :stop | :continue_work
  @type opts :: %{
          optional(:agent) => String.t() | nil,
          optional(:goal) => String.t() | nil,
          optional(:instructions) => String.t() | nil,
          optional(:target_status) => String.t() | nil
        }

  @spec resume(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def resume(%Project{} = project, identifier, opts \\ %{}) when is_binary(identifier) do
    dispatch(project, identifier, :resume, opts)
  end

  @spec restart(Project.t(), String.t(), opts()) :: {:ok, map()} | {:error, term()}
  def restart(%Project{} = project, identifier, opts \\ %{}) when is_binary(identifier) do
    dispatch(project, identifier, :restart, opts)
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
       when action in [:resume, :restart, :hard_reset, :continue_work] do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         agent_kind = effective_agent_kind(project, issue, opts),
         {:ok, _comment} <- maybe_add_comment(project, identifier, action, opts),
         {:ok, _} <- maybe_update_agent(project, identifier, opts, agent_kind),
         :ok <- maybe_route_codex_goal(project, identifier, opts, agent_kind),
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

  defp maybe_add_comment(project, identifier, action, opts) do
    if comment_required?(action, Map.get(opts, :instructions)) do
      body = comment_body(action, Map.get(opts, :instructions))

      IssueAdapter.dispatch(project, :add_comment, [identifier, body, %{"author" => "tracker"}])
    else
      {:ok, nil}
    end
  end

  defp comment_required?(action, instructions) when action in [:restart, :hard_reset] do
    not is_nil(normalize_optional_string(instructions))
  end

  defp comment_required?(_action, _instructions), do: true

  defp maybe_record_dispatch_activity(project, identifier, action, opts) when action in [:restart, :hard_reset] do
    if comment_required?(action, Map.get(opts, :instructions)) do
      :ok
    else
      metadata = %{"action" => Atom.to_string(action)}

      case Context.record_activity_event(project.slug, identifier, "agent_dispatch_requested", metadata) do
        {:ok, _event} ->
          :ok

        {:error, reason} ->
          Logger.debug("Skipping dispatch activity identifier=#{identifier} reason=#{inspect(reason)}")
          :ok
      end
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

        :restart ->
          """
          ## Restart agent run (tracker)

          Start a fresh agent pass on this issue. Review the ticket, workspace, and session log before continuing.
          """

        :hard_reset ->
          """
          ## Hard reset agent run (tracker)

          The previous agent session was discarded (turns and token counters cleared) and a brand-new session is starting. The workspace is preserved — review the existing workspace and git state, then continue the ticket.
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

  # When a Codex dispatch supplies a goal, establish it on the native Codex
  # thread rather than caching it on the issue. Best-effort so a transient Codex
  # failure never blocks resume/restart.
  defp maybe_route_codex_goal(project, identifier, opts, "codex") do
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

  defp maybe_route_codex_goal(_project, _identifier, _opts, _agent_kind), do: :ok

  # Effective agent kind for this dispatch: an explicit `opts[:agent]` override
  # wins, otherwise resolve task labels over the project default.
  defp effective_agent_kind(project, %IssueDTO{labels: labels}, opts) do
    case normalize_agent(Map.get(opts, :agent)) do
      agent when is_binary(agent) ->
        agent

      _ ->
        project_kind =
          project
          |> Repo.preload(:setup)
          |> ProjectConfig.resolve()
          |> Map.get(:agent_kind)

        AgentPreference.resolve(labels || [], project_kind)
    end
  end

  defp maybe_hard_reset(%Project{} = project, identifier, %IssueDTO{} = issue, :hard_reset) do
    stop_active_run(identifier)
    clear_agent_session(project, identifier, issue)
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

  defp clear_agent_session(%Project{} = project, identifier, %IssueDTO{} = issue) do
    clear_codex_session_sidecar(project, identifier, issue)

    case Context.clear_agent_session_id(project.slug, identifier) do
      {:ok, _record} ->
        :ok

      {:error, reason} ->
        Logger.warning("Hard reset could not clear agent session id identifier=#{identifier} reason=#{inspect(reason)}")
        :ok
    end
  end

  defp clear_codex_session_sidecar(%Project{} = project, identifier, %IssueDTO{} = issue) do
    %{
      id: issue.id,
      identifier: identifier,
      project_slug: issue.project_slug || project.slug
    }
    |> Workspace.path_for_issue()
    |> CodexSession.clear()
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

  defp dispatch_message(:restart, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Restarting agent work on %{identifier}", identifier: identifier)

  defp dispatch_message(:hard_reset, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Hard reset — starting a fresh agent session for %{identifier}", identifier: identifier)

  defp dispatch_message(:continue_work, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Continuing agent work on %{identifier}", identifier: identifier)

  defp dispatch_message(:stop, %IssueDTO{identifier: identifier}),
    do: dgettext("dispatch", "Paused agent run for %{identifier} — resume when ready", identifier: identifier)

  defp normalize_agent(agent) when agent in ["codex", "claude", "cursor"], do: agent
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
