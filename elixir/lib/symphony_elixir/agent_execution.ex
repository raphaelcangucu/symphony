defmodule SymphonyElixir.AgentExecution do
  @moduledoc """
  Derives a per-issue agent execution view from the orchestrator snapshot.

  The orchestrator tracks active agents in its `running` and `retry_attempts`
  maps. This module projects that runtime state into a stable, UI-facing status
  (`:live`, `:idle`, `:waiting`, `:retrying`, `:error`, `:aborted`, `:paused`)
  keyed by issue identifier so the tracker board can show which agent is working
  an issue and what it is doing.

  A `:paused` run is one the operator stopped on purpose (a `user_stop` session
  event). It is resumable and benign, so it is kept distinct from `:aborted`,
  which signals an unexpected interruption/failure that needs attention.
  """

  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Claude.GoalStore, as: ClaudeGoalStore
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.{Context, IssueMapper}
  alias SymphonyElixir.{Orchestrator, StatusDashboard}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SessionLog
  alias SymphonyElixir.SubagentRegistry
  alias SymphonyElixir.Workspace

  @typedoc """
  Coarse, UI-facing execution status derived from orchestrator runtime.

  `:saved` means there is no live or interrupted run, but the issue still owns a
  durable Codex goal thread (persisted `agent_session_id` + objective). The UI
  surfaces it as a dormant "goal not loaded" state that can be resumed.
  """
  @type status :: :live | :idle | :waiting | :retrying | :error | :aborted | :paused | :saved

  # UI-facing session-event / display copy for a deliberate operator pause.
  @paused_last_event "turn_paused"
  @paused_message "Paused — resume when ready"
  @paused_label "Paused"
  @type t :: %{
          issue_id: String.t() | nil,
          issue_identifier: String.t(),
          status: status(),
          session_id: String.t() | nil,
          execution_session_id: integer() | nil,
          last_event: atom() | String.t() | nil,
          last_message: String.t() | nil,
          last_event_at: DateTime.t() | nil,
          turn_count: non_neg_integer(),
          runtime_seconds: non_neg_integer() | nil,
          started_at: DateTime.t() | nil,
          retry_attempt: non_neg_integer(),
          error: String.t() | nil,
          agent_kind: String.t() | nil,
          model: String.t() | nil,
          goal: map() | nil,
          long_running: boolean(),
          long_running_kind: String.t() | nil,
          long_running_label: String.t() | nil,
          parent_identifier: String.t() | nil,
          bundle_role: :parent | :child | :subagent | :standalone,
          unit_id: String.t() | nil,
          repo: String.t() | nil,
          child_identifiers: [String.t()],
          tokens: %{input: non_neg_integer(), output: non_neg_integer(), total: non_neg_integer()} | nil
        }

  @default_snapshot_timeout_ms 5_000

  # An agent is considered "live" when Codex emitted an event within this window;
  # otherwise the session is alive but quiet, which we report as "idle".
  @live_window_ms 90_000

  # Codex events that mean the agent is blocked waiting on a human decision.
  @waiting_events [:turn_input_required, :approval_required]

  @doc "Lists current agent executions using the default orchestrator and timeout."
  @spec list() :: [t()]
  def list, do: list(Orchestrator, @default_snapshot_timeout_ms)

  @doc """
  Lists current agent executions from the given orchestrator snapshot.

  Returns an empty list when the orchestrator is unavailable or times out so the
  tracker UI degrades gracefully instead of erroring.
  """
  @spec list(GenServer.server(), timeout()) :: [t()]
  def list(orchestrator, snapshot_timeout_ms) do
    case Orchestrator.snapshot(orchestrator, snapshot_timeout_ms) do
      %{running: _running, retrying: _retrying} = snapshot ->
        snapshot
        |> executions_from_snapshot()
        |> dedupe_executions()

      _other ->
        []
    end
  end

  defp executions_from_snapshot(snapshot) do
    live = from_snapshot(snapshot)
    live_covered = MapSet.new(live, & &1.issue_identifier)
    persisted = persisted_execution_sessions(live_covered)

    covered =
      MapSet.union(live_covered, MapSet.new(persisted, & &1.issue_identifier))

    waiting = subagent_executions(snapshot, [])

    live ++ persisted ++ saved_goal_executions(snapshot, covered) ++ waiting
  end

  # Interrupted/aborted executions now come from REAL persisted execution
  # sessions (orchestrator-created), never from scanning a shared working tree's
  # session log. That eliminates the phantom "aborted" row that appeared when an
  # interactive session merely shared the issue's canonical working tree.
  defp persisted_execution_sessions(covered) do
    ExecutionSession.recent_non_live()
    |> Enum.reject(fn session -> MapSet.member?(covered, session.issue_identifier) end)
    |> Enum.map(&execution_from_session/1)
  end

  defp execution_from_session(session) do
    %{
      issue_id: nil,
      issue_identifier: session.issue_identifier,
      status: session_execution_status(session.status),
      session_id: to_string(session.id),
      execution_session_id: session.id,
      last_event: nil,
      last_message: nil,
      last_event_at: session.updated_at,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: session.inserted_at,
      retry_attempt: 0,
      error: nil,
      agent_kind: session.agent_kind,
      model: nil,
      goal: nil,
      long_running: false,
      long_running_kind: nil,
      long_running_label: nil,
      parent_identifier: nil,
      bundle_role: :standalone,
      unit_id: session_unit_id(session),
      repo: nil,
      child_identifiers: [],
      tokens: nil
    }
  end

  defp session_execution_status("error"), do: :aborted
  defp session_execution_status("closed"), do: :saved
  defp session_execution_status(_status), do: :aborted

  defp session_unit_id(%{metadata: %{"unit_id" => unit_id}}) when is_binary(unit_id), do: unit_id
  defp session_unit_id(_session), do: nil

  @doc """
  Projects the dependency-gated subagent units of in-flight coordinator parents
  as `:waiting` executions, so the board shows the per-issue waiting badge that
  mirrors the waiting rows in the observability sessions table. These hold no
  agent and burn no tokens. Tracker reads are injectable for tests via `opts`
  (forwarded to `SubagentRegistry.waiting_subagents/2`).
  """
  @spec subagent_executions(map(), keyword()) :: [t()]
  def subagent_executions(snapshot, opts) when is_list(opts) do
    snapshot
    |> SubagentRegistry.waiting_subagents(opts)
    |> Enum.map(&subagent_execution/1)
  end

  defp subagent_execution(record) do
    %{
      issue_id: record.issue_id,
      issue_identifier: record.issue_identifier,
      status: :waiting,
      session_id: nil,
      execution_session_id: nil,
      last_event: nil,
      last_message: record.last_message,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: 0,
      error: nil,
      agent_kind: nil,
      model: nil,
      goal: nil,
      long_running: false,
      long_running_kind: nil,
      long_running_label: nil,
      parent_identifier: record.parent_identifier,
      bundle_role: :subagent,
      unit_id: record.unit_id,
      repo: record.repo,
      child_identifiers: [],
      tokens: nil
    }
  end

  defp dedupe_executions(executions) when is_list(executions) do
    executions
    |> Enum.group_by(& &1.issue_identifier)
    |> Enum.map(fn {_identifier, group} -> Enum.min_by(group, &status_priority(&1.status)) end)
  end

  defp status_priority(:aborted), do: 0
  defp status_priority(:error), do: 1
  defp status_priority(:retrying), do: 2
  defp status_priority(:waiting), do: 3
  defp status_priority(:live), do: 4
  defp status_priority(:idle), do: 5
  defp status_priority(:paused), do: 6
  defp status_priority(:saved), do: 7
  defp status_priority(_status), do: 8

  @doc "Projects a raw orchestrator snapshot into agent execution views."
  @spec from_snapshot(map()) :: [t()]
  def from_snapshot(%{running: running, retrying: retrying}) do
    now = DateTime.utc_now()
    running_executions = Enum.map(running, &running_execution(&1, now))
    running_identifiers = MapSet.new(running_executions, & &1.issue_identifier)

    retry_executions =
      retrying
      |> Enum.reject(fn entry -> identifier(entry) in running_identifiers end)
      |> Enum.map(&retry_execution/1)

    running_executions ++ retry_executions
  end

  def from_snapshot(_snapshot), do: []

  defp running_execution(entry, now) do
    last_event_at = Map.get(entry, :last_codex_timestamp)
    status = running_status(entry, last_event_at, now)
    interruption = if(status == :idle, do: running_entry_interruption(entry), else: nil)

    goal =
      entry
      |> execution_goal()
      |> with_runtime_stop_capability(status, interruption, Map.get(entry, :agent_kind))

    aborted? = interruption == :aborted

    %{
      issue_id: issue_id(entry),
      issue_identifier: entry.identifier,
      status: interruption || status,
      agent_kind: Map.get(entry, :agent_kind),
      model: resolve_execution_model(entry),
      session_id: Map.get(entry, :session_id),
      execution_session_id: normalize_execution_session_id(Map.get(entry, :execution_session_id)),
      last_event: running_last_event(entry, interruption),
      last_message: running_last_message(entry, interruption),
      last_event_at: last_event_at,
      turn_count: Map.get(entry, :turn_count, 0),
      runtime_seconds: Map.get(entry, :runtime_seconds),
      started_at: Map.get(entry, :started_at),
      retry_attempt: 0,
      # A deliberate pause is not an error; only a genuine abort carries one.
      error: if(aborted?, do: interrupted_error_message(entry), else: nil),
      goal: goal,
      # Paused runs stay resumable, so the parked goal is preserved; aborted runs drop it.
      long_running: not is_nil(goal) and not aborted?,
      long_running_kind: if(aborted?, do: nil, else: long_running_kind(goal)),
      long_running_label: running_long_running_label(interruption, goal),
      parent_identifier: bundle_parent_identifier(entry),
      bundle_role: bundle_role(entry),
      unit_id: bundle_unit_id(entry),
      repo: bundle_repo(entry),
      child_identifiers: bundle_child_identifiers(entry),
      tokens: %{
        input: Map.get(entry, :agent_input_tokens, 0),
        output: Map.get(entry, :agent_output_tokens, 0),
        total: Map.get(entry, :agent_total_tokens, 0)
      }
    }
  end

  defp running_last_event(_entry, :paused), do: @paused_last_event
  defp running_last_event(_entry, :aborted), do: "turn_aborted"
  defp running_last_event(entry, _interruption), do: Map.get(entry, :last_codex_event)

  defp running_last_message(_entry, :paused), do: @paused_message
  defp running_last_message(entry, :aborted), do: interrupted_session_message(entry)
  defp running_last_message(entry, _interruption), do: Map.get(entry, :last_codex_message)

  defp running_long_running_label(:aborted, _goal), do: nil
  defp running_long_running_label(:paused, goal), do: if(is_nil(goal), do: nil, else: @paused_label)
  defp running_long_running_label(_interruption, goal), do: long_running_label(goal)

  # Classifies an idle running entry whose session log shows an interruption:
  # a deliberate operator pause (`user_stop`) is resumable and benign (`:paused`);
  # anything else is an unexpected `:aborted` interruption. `nil` when not interrupted.
  defp running_entry_interruption(entry) do
    if running_entry_interrupted?(entry) do
      interruption_kind(session_log_abort_info(entry))
    end
  end

  defp interruption_kind(%{kind: :user_stop}), do: :paused
  defp interruption_kind(_abort_info), do: :aborted

  defp interrupted_error_message(entry) do
    case session_log_abort_info(entry) do
      %{kind: :run_failed, summary: summary} when is_binary(summary) and summary != "" ->
        "#{summary}. Use Resume in the execution panel."

      %{summary: summary} when is_binary(summary) and summary != "" ->
        "Turn aborted — #{summary}. Use Resume in the execution panel."

      _ ->
        "Agent run interrupted — use Resume in the execution panel"
    end
  end

  defp interrupted_session_message(entry) do
    case session_log_abort_info(entry) do
      %{kind: :run_failed, summary: summary} when is_binary(summary) and summary != "" ->
        summary

      %{summary: summary} when is_binary(summary) and summary != "" ->
        "Turn aborted — #{summary}"

      _ ->
        "Agent run interrupted — resume from the session log"
    end
  end

  defp running_entry_interrupted?(entry) do
    subject = Map.get(entry, :issue) || identifier(entry)
    agent_kind = Map.get(entry, :agent_kind) || issue_agent_kind(subject)

    with false <- is_nil(subject),
         workspace when is_binary(workspace) <- Workspace.path_for_issue(subject),
         true <- File.dir?(workspace),
         {:ok, kind, path} <- SessionLog.resolve_log_source(agent_kind || "codex", workspace) do
      session_log_interrupted?(kind, path, workspace)
    else
      _ -> false
    end
  end

  defp issue_agent_kind(%{agent_kind: kind}) when is_binary(kind) and kind != "", do: kind
  defp issue_agent_kind(%{labels: labels}) when is_list(labels), do: AgentRouting.label_agent_kind(labels)
  defp issue_agent_kind(_issue), do: "codex"

  defp retry_execution(entry) do
    error = format_failure(Map.get(entry, :error))
    status = if(is_binary(error) and error != "", do: :error, else: :retrying)

    %{
      issue_id: issue_id(entry),
      issue_identifier: identifier(entry),
      status: status,
      session_id: nil,
      execution_session_id: nil,
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: Map.get(entry, :attempt, 0) || 0,
      error: error,
      agent_kind: Map.get(entry, :agent_kind),
      model: resolve_execution_model(entry),
      goal: nil,
      long_running: false,
      long_running_kind: nil,
      long_running_label: nil,
      parent_identifier: bundle_parent_identifier(entry),
      bundle_role: bundle_role(entry),
      unit_id: bundle_unit_id(entry),
      repo: bundle_repo(entry),
      child_identifiers: bundle_child_identifiers(entry),
      tokens: nil
    }
  end

  defp resolve_execution_model(entry) when is_map(entry) do
    case Map.get(entry, :model) do
      model when is_binary(model) and model != "" ->
        model

      _ ->
        case Map.get(entry, :issue) do
          issue when is_map(issue) -> Keyword.get(AgentRunner.agent_settings_opts(issue), :model)
          _ -> nil
        end
    end
  end

  defp running_status(entry, last_event_at, now) do
    cond do
      Map.get(entry, :last_codex_event) in @waiting_events -> :waiting
      live?(last_event_at, now) -> :live
      true -> :idle
    end
  end

  defp live?(%DateTime{} = last_event_at, now) do
    DateTime.diff(now, last_event_at, :millisecond) <= @live_window_ms
  end

  defp live?(_last_event_at, _now), do: false

  # Issues that own a durable Codex goal thread (persisted `agent_session_id`)
  # whose goal can be projected from native Codex data (the workspace goal mirror
  # for Codex, or `agent_goal` workflow guidance for Claude/Cursor) but have no
  # live or interrupted run. These are projected as a dormant `:saved` ("goal not
  # loaded") state so the UI can show a goal is parked on the issue even when no
  # worker is attached.
  defp saved_goal_executions(%{running: running, retrying: retrying}, covered) do
    active_identifiers =
      (running ++ retrying)
      |> Enum.map(&Map.get(&1, :identifier))
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()

    Context.list_routable_non_terminal_issues()
    |> Enum.reject(fn record ->
      MapSet.member?(active_identifiers, record.identifier) or
        MapSet.member?(covered, record.identifier)
    end)
    |> Enum.flat_map(&saved_goal_candidate/1)
  end

  defp saved_goal_executions(_snapshot, _covered), do: []

  defp saved_goal_candidate(%{} = record) do
    issue = IssueMapper.to_issue(record)
    agent_kind = issue.agent_kind || "codex"

    with true <- present?(record.agent_session_id),
         true <- AgentRouting.routable?(issue.labels),
         true <- issue_in_active_state?(record, issue),
         %{} = goal <-
           build_goal(agent_kind, "not_loaded", record.agent_goal, Workspace.path_for_issue(issue)) do
      [saved_goal_execution(record, agent_kind, goal)]
    else
      _ -> []
    end
  end

  defp saved_goal_execution(record, agent_kind, goal) do
    %{
      issue_id: to_string(record.id),
      issue_identifier: record.identifier,
      status: :saved,
      session_id: record.agent_session_id,
      execution_session_id: nil,
      last_event: nil,
      last_message: nil,
      last_event_at: record.updated_at,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: 0,
      error: nil,
      agent_kind: agent_kind,
      model: resolve_record_model(record),
      goal: goal,
      long_running: true,
      long_running_kind: long_running_kind(goal),
      long_running_label: long_running_label(goal),
      parent_identifier: nil,
      bundle_role: :standalone,
      unit_id: nil,
      repo: nil,
      child_identifiers: [],
      tokens: nil
    }
  end

  defp resolve_record_model(record) when is_map(record) do
    record
    |> IssueMapper.to_issue()
    |> AgentRunner.agent_settings_opts()
    |> Keyword.get(:model)
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false

  defp issue_in_active_state?(record, issue) do
    case record.project do
      %{} = project ->
        project = Repo.preload(project, :setup)
        config = ProjectConfig.resolve(project)
        active = active_state_set(config)
        state = issue.state |> normalize_status_name()
        state != "" and MapSet.member?(active, state)

      _ ->
        false
    end
  end

  defp active_state_set(config) do
    (config.active_states || [])
    |> Enum.map(&normalize_status_name/1)
    |> MapSet.new()
  end

  defp session_log_interrupted?(agent_kind, path, workspace) do
    case session_log_entries(agent_kind, path, workspace) do
      {:ok, entries} when entries != [] ->
        entries
        |> Enum.take(-8)
        |> Enum.reverse()
        |> Enum.reduce_while(false, fn entry, _state ->
          title = Map.get(entry, "title") || Map.get(entry, :title)

          cond do
            resumed_title?(title) -> {:halt, false}
            aborted_title?(title) -> {:halt, true}
            true -> {:cont, false}
          end
        end)

      _ ->
        false
    end
  end

  defp session_log_entries(agent_kind, path, workspace) do
    opts = [max_bytes: 48_000, workspace: workspace]

    case SessionLog.tail(agent_kind, path, opts) do
      {:ok, entries, _} -> {:ok, entries}
      _ -> :error
    end
  end

  defp session_log_abort_info(entry) do
    subject = Map.get(entry, :issue) || identifier(entry)
    agent_kind = Map.get(entry, :agent_kind) || issue_agent_kind(subject)

    with workspace when is_binary(workspace) <- workspace_for(subject),
         true <- File.dir?(workspace),
         {:ok, kind, path} <- SessionLog.resolve_log_source(agent_kind || "codex", workspace),
         {:ok, entries} <- session_log_entries(kind, path, workspace) do
      entries
      |> Enum.reverse()
      |> Enum.find_value(&abort_entry_info/1)
    else
      _ -> nil
    end
  end

  defp abort_entry_info(%{"title" => title} = entry) when is_binary(title) do
    if aborted_title?(title), do: build_abort_entry_info(title, entry)
  end

  defp abort_entry_info(%{title: title} = entry) when is_binary(title) do
    if aborted_title?(title), do: build_abort_entry_info(title, entry)
  end

  defp abort_entry_info(_entry), do: nil

  defp build_abort_entry_info(title, entry) do
    case abort_entry_reason(entry) do
      "user_stop" ->
        %{kind: :user_stop, summary: @paused_message}

      _ ->
        case abort_entry_body(entry) do
          summary when is_binary(summary) and summary != "" ->
            %{kind: abort_entry_kind(title), summary: summary}

          _ ->
            nil
        end
    end
  end

  defp abort_entry_reason(entry) do
    case Map.get(entry, "abort_reason") || Map.get(entry, :abort_reason) do
      reason when is_binary(reason) -> String.trim(reason)
      _ -> nil
    end
  end

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp abort_entry_body(entry) do
    body = Map.get(entry, "body") || Map.get(entry, :body)
    reason = Map.get(entry, "abort_reason") || Map.get(entry, :abort_reason)
    title = Map.get(entry, "title") || Map.get(entry, :title)

    cond do
      title == "Agent run failed" and is_binary(body) and body != "" ->
        format_failure(body)

      title == "Worker crashed" and is_binary(body) and body != "" ->
        body |> String.split("\n", parts: 2) |> List.first() |> String.trim()

      is_binary(body) and String.trim(body) != "" ->
        body |> String.split("\n") |> List.first() |> String.trim()

      is_binary(reason) and String.trim(reason) != "" ->
        reason

      true ->
        nil
    end
  end

  defp workspace_for(nil), do: nil
  defp workspace_for(subject), do: Workspace.path_for_issue(subject)

  defp aborted_title?(title) when is_binary(title) do
    down = String.downcase(title)

    String.match?(down, ~r/aborted|turn aborted|worker crashed|agent run failed/)
  end

  defp aborted_title?(_title), do: false

  defp resumed_title?(title) when is_binary(title) do
    String.downcase(title) in ["run resumed", "task resumed", "turn resumed"]
  end

  defp resumed_title?(_title), do: false

  defp abort_entry_kind("Agent run failed"), do: :run_failed
  defp abort_entry_kind("Worker crashed"), do: :worker_crashed
  defp abort_entry_kind(_title), do: :turn_aborted

  defp normalize_status_name(value) when is_binary(value),
    do: value |> String.trim() |> String.downcase()

  defp normalize_status_name(_value), do: ""

  defp identifier(entry), do: Map.get(entry, :identifier)
  defp issue_id(entry), do: entry |> Map.get(:issue_id) |> maybe_to_string()

  # Bundle context is threaded onto the orchestrator run entry by the coordinator
  # (parent run carries `child_identifiers`; child runs carry `parent_identifier`
  # + `unit_id` + `repo`). Non-bundle runs default to `:standalone`.
  defp bundle_role(entry) do
    case Map.get(entry, :bundle_role) do
      role when role in [:parent, :child, :standalone] -> role
      _ -> :standalone
    end
  end

  defp bundle_parent_identifier(entry), do: entry |> Map.get(:parent_identifier) |> maybe_to_string()
  defp bundle_unit_id(entry), do: entry |> Map.get(:unit_id) |> maybe_to_string()
  defp bundle_repo(entry), do: entry |> Map.get(:repo) |> maybe_to_string()

  defp bundle_child_identifiers(entry) do
    case Map.get(entry, :child_identifiers) do
      ids when is_list(ids) -> Enum.map(ids, &to_string/1)
      _ -> []
    end
  end

  defp execution_goal(entry) do
    Map.get(entry, :goal) || fallback_goal(entry)
  end

  defp with_runtime_stop_capability(nil, _status, _interruption, _agent_kind), do: nil

  defp with_runtime_stop_capability(goal, status, interruption, agent_kind) when is_map(goal) do
    capabilities =
      goal
      |> goal_value(:capabilities, [])
      |> List.wrap()
      |> Enum.reject(&(&1 == "stop"))

    stoppable? =
      is_nil(interruption) and
        status in [:live, :waiting, :idle] and
        goal_value(goal, :kind) == "goal" and
        native_goal_provider?(goal_value(goal, :source), agent_kind)

    Map.put(goal, :capabilities, if(stoppable?, do: capabilities ++ ["stop"], else: capabilities))
  end

  defp native_goal_provider?("native", agent_kind) when agent_kind in [nil, "codex"], do: true
  defp native_goal_provider?("claude", agent_kind) when agent_kind in [nil, "claude"], do: true
  defp native_goal_provider?(_source, _agent_kind), do: false

  defp goal_value(goal, key, default \\ nil) when is_map(goal) and is_atom(key) do
    Map.get(goal, key, Map.get(goal, Atom.to_string(key), default))
  end

  # When the orchestrator has no live native goal for a running entry, project
  # from native Codex data: the workspace goal mirror for Codex, or `agent_goal`
  # workflow guidance for Claude/Cursor.
  defp fallback_goal(entry) do
    agent_kind = Map.get(entry, :agent_kind) || "codex"
    subject = Map.get(entry, :issue) || identifier(entry)
    build_goal(agent_kind, "active", Map.get(entry, :agent_goal), workspace_for(subject))
  end

  # Build a UI-facing goal projection. Codex goals are sourced only from the
  # native goal mirror (`.symphony/codex-session.json`). Claude goals come from
  # `.symphony/claude-goal.json` across their canonical lifecycle; otherwise
  # Claude/Cursor fall back to `agent_goal` prompt guidance as workflow.
  defp build_goal(agent_kind, status, workflow_objective, workspace) do
    case project_goal(agent_kind, status, workflow_objective, workspace) do
      nil -> nil
      goal -> goal
    end
  end

  defp project_goal("claude", status, workflow_objective, workspace) do
    case claude_mirror_goal(workspace) do
      %{objective: objective} = mirror ->
        %{
          kind: "goal",
          source: "claude",
          status: Map.get(mirror, :status) || status,
          objective: objective,
          capabilities: ["get", "edit", "clear"]
        }

      nil ->
        case normalize_objective(workflow_objective) do
          nil ->
            nil

          value ->
            %{
              kind: "workflow",
              source: "prompt",
              status: status,
              objective: value,
              capabilities: ["view"]
            }
        end
    end
  end

  defp project_goal(agent_kind, status, workflow_objective, _workspace)
       when agent_kind in ["cursor", "opencode"] do
    case normalize_objective(workflow_objective) do
      nil ->
        nil

      value ->
        %{
          kind: "workflow",
          source: "prompt",
          status: status,
          objective: value,
          capabilities: ["view"]
        }
    end
  end

  defp project_goal(_agent_kind, status, _workflow_objective, workspace) do
    case native_mirror_objective(workspace) do
      nil ->
        nil

      value ->
        %{
          kind: "goal",
          source: "native",
          status: status,
          objective: value,
          capabilities: ["get", "edit", "clear"]
        }
    end
  end

  defp claude_mirror_goal(workspace) when is_binary(workspace) do
    case ClaudeGoalStore.read(workspace, :execution) do
      {:ok, %{"status" => status, "objective" => objective}} ->
        if ClaudeGoalStore.native_goal_exists?(status),
          do: %{objective: normalize_objective(objective), status: status},
          else: nil

      _ ->
        nil
    end
  end

  defp claude_mirror_goal(_workspace), do: nil

  defp native_mirror_objective(workspace) when is_binary(workspace) do
    case CodexStore.read_goal(workspace) do
      {:ok, %{"objective" => objective}} -> normalize_objective(objective)
      _ -> nil
    end
  end

  defp native_mirror_objective(_workspace), do: nil

  defp normalize_objective(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_objective(_value), do: nil

  defp long_running_kind(%{kind: kind}) when is_binary(kind), do: kind
  defp long_running_kind(_goal), do: nil

  defp long_running_label(%{kind: "workflow"}), do: "Pursuing workflow"
  defp long_running_label(%{kind: "goal"}), do: "Pursuing goal"
  defp long_running_label(_goal), do: nil

  defp maybe_to_string(nil), do: nil
  defp maybe_to_string(value), do: to_string(value)

  defp normalize_execution_session_id(id) when is_integer(id) and id > 0, do: id

  defp normalize_execution_session_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} when n > 0 -> n
      _ -> nil
    end
  end

  defp normalize_execution_session_id(_), do: nil

  @doc "Humanizes a raw Codex message for display, mirroring the dashboard."
  @spec humanize_message(term()) :: String.t() | nil
  def humanize_message(nil), do: nil
  def humanize_message(message), do: StatusDashboard.humanize_codex_message(message)

  @doc """
  Formats agent failure reasons for UI and retry metadata.

  Strips RuntimeError stack traces and normalizes common CLI exit messages.
  """
  @spec format_failure(term()) :: String.t() | nil
  def format_failure(nil), do: nil

  def format_failure(%RuntimeError{message: message}) when is_binary(message) do
    format_failure(message)
  end

  def format_failure({:turn_failed, message}), do: format_failure(message)
  def format_failure({:error, reason}), do: format_failure(reason)

  def format_failure(%{} = reason) do
    case failure_message_from_map(reason) do
      message when is_binary(message) and message != "" -> truncate_failure(message)
      _ -> truncate_failure(inspect(reason, limit: 8))
    end
  end

  def format_failure("agent exited: " <> rest) do
    format_failure(rest)
  end

  def format_failure(message) when is_binary(message) do
    cond do
      match = Regex.run(~r/claude exited with code \d+/, message) ->
        hd(match)

      String.contains?(message, "Authentication required") ->
        "Cursor Agent authentication required — run `cursor agent login` or set CURSOR_API_KEY"

      String.starts_with?(message, "Agent run failed for ") ->
        case Regex.run(~r/Agent run failed for [^:]+: (.+)/, message) do
          [_, reason] -> format_failure(parse_inspected_reason(reason))
          _ -> truncate_failure(message)
        end

      String.starts_with?(message, "{:turn_failed") ->
        format_failure(parse_inspected_reason(message))

      String.starts_with?(message, "{%RuntimeError") ->
        format_failure(parse_inspected_reason(message))

      true ->
        truncate_failure(message)
    end
  end

  def format_failure(reason), do: truncate_failure(inspect(reason, limit: 8))

  defp parse_inspected_reason(reason) when is_binary(reason) do
    cond do
      match = Regex.run(~r/\{:turn_failed,\s*"([^"]+)"\}/, reason) ->
        Enum.at(match, 1)

      match = Regex.run(~r/\{:turn_failed,\s*\\"([^\\"]+)\\"\}/, reason) ->
        Enum.at(match, 1)

      match = Regex.run(~r/claude exited with code \d+/, reason) ->
        hd(match)

      true ->
        reason
    end
  end

  defp failure_message_from_map(reason) when is_map(reason) do
    [
      ["error", "message"],
      [:error, :message],
      ["params", "error", "message"],
      [:params, :error, :message],
      ["message"],
      [:message]
    ]
    |> Enum.find_value(fn path ->
      case get_in_path(reason, path) do
        value when is_binary(value) and value != "" -> value
        _ -> nil
      end
    end)
  end

  defp get_in_path(value, []), do: value

  defp get_in_path(%{} = map, [key | rest]) do
    map
    |> Map.get(key)
    |> get_in_path(rest)
  end

  defp get_in_path(_value, _path), do: nil

  defp truncate_failure(message) when is_binary(message) do
    message
    |> String.replace("\n", " ")
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> truncate(240)
  end

  defp truncate(text, max) when byte_size(text) <= max, do: text

  defp truncate(text, max) do
    text
    |> String.slice(0, max)
    |> Kernel.<>("…")
  end
end
