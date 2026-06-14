defmodule SymphonyElixir.AgentExecution do
  @moduledoc """
  Derives a per-issue agent execution view from the orchestrator snapshot.

  The orchestrator tracks active agents in its `running` and `retry_attempts`
  maps. This module projects that runtime state into a stable, UI-facing status
  (`:live`, `:idle`, `:waiting`, `:retrying`, `:error`, `:aborted`) keyed by issue
  identifier so the tracker board can show which agent is working an issue and what
  it is doing.
  """

  alias SymphonyElixir.{Orchestrator, StatusDashboard}
  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.LocalTracker.{Context, IssueMapper}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SessionLog
  alias SymphonyElixir.Workspace

  @typedoc "Coarse, UI-facing execution status derived from orchestrator runtime."
  @type status :: :live | :idle | :waiting | :retrying | :error | :aborted

  @type t :: %{
          issue_id: String.t() | nil,
          issue_identifier: String.t(),
          status: status(),
          session_id: String.t() | nil,
          last_event: atom() | String.t() | nil,
          last_message: String.t() | nil,
          last_event_at: DateTime.t() | nil,
          turn_count: non_neg_integer(),
          runtime_seconds: non_neg_integer() | nil,
          started_at: DateTime.t() | nil,
          retry_attempt: non_neg_integer(),
          error: String.t() | nil,
          agent_kind: String.t() | nil,
          goal: map() | nil,
          long_running: boolean(),
          long_running_kind: String.t() | nil,
          long_running_label: String.t() | nil,
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
        from_snapshot(snapshot) ++ interrupted_executions(snapshot)

      _other ->
        []
    end
  end

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
    goal = execution_goal(entry)

    %{
      issue_id: issue_id(entry),
      issue_identifier: entry.identifier,
      status: running_status(entry, last_event_at, now),
      agent_kind: Map.get(entry, :agent_kind),
      session_id: Map.get(entry, :session_id),
      last_event: Map.get(entry, :last_codex_event),
      last_message: Map.get(entry, :last_codex_message),
      last_event_at: last_event_at,
      turn_count: Map.get(entry, :turn_count, 0),
      runtime_seconds: Map.get(entry, :runtime_seconds),
      started_at: Map.get(entry, :started_at),
      retry_attempt: 0,
      error: nil,
      goal: goal,
      long_running: not is_nil(goal),
      long_running_kind: long_running_kind(goal),
      long_running_label: long_running_label(goal),
      tokens: %{
        input: Map.get(entry, :agent_input_tokens, 0),
        output: Map.get(entry, :agent_output_tokens, 0),
        total: Map.get(entry, :agent_total_tokens, 0)
      }
    }
  end

  defp retry_execution(entry) do
    error = format_failure(Map.get(entry, :error))
    status = if(is_binary(error) and error != "", do: :error, else: :retrying)

    %{
      issue_id: issue_id(entry),
      issue_identifier: identifier(entry),
      status: status,
      session_id: nil,
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: Map.get(entry, :attempt, 0) || 0,
      error: error,
      agent_kind: Map.get(entry, :agent_kind),
      goal: nil,
      long_running: false,
      long_running_kind: nil,
      long_running_label: nil,
      tokens: nil
    }
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

  defp interrupted_executions(%{running: running, retrying: retrying}) do
    active_identifiers =
      (running ++ retrying)
      |> Enum.map(&Map.get(&1, :identifier))
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()

    Context.list_routable_non_terminal_issues()
    |> Enum.reject(fn record -> MapSet.member?(active_identifiers, record.identifier) end)
    |> Enum.filter(&interrupted_issue?/1)
    |> Enum.map(&interrupted_execution/1)
  end

  defp interrupted_executions(_snapshot), do: []

  defp interrupted_issue?(%{} = record) do
    issue = IssueMapper.to_issue(record)

    with true <- issue_in_active_state?(record, issue),
         true <- AgentRouting.routable?(issue.labels),
         workspace when is_binary(workspace) <- Workspace.path_for_issue(issue),
         true <- File.dir?(workspace),
         {:ok, agent_kind, path} <- SessionLog.resolve_log_source(issue.agent_kind || "codex", workspace),
         true <- session_log_interrupted?(agent_kind, path) do
      true
    else
      _ -> false
    end
  end

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

  defp session_log_interrupted?(agent_kind, path) do
    case SessionLog.tail(agent_kind, path, max_bytes: 48_000) do
      {:ok, entries, _} when entries != [] ->
        titles =
          entries
          |> Enum.take(-8)
          |> Enum.map(fn entry -> Map.get(entry, "title") || Map.get(entry, :title) end)
          |> Enum.reject(&is_nil/1)

        Enum.any?(titles, &aborted_title?/1) or
          (recent_activity?(titles) and not completed_recently?(titles))

      _ ->
        false
    end
  end

  defp aborted_title?(title) when is_binary(title),
    do: String.match?(String.downcase(title), ~r/aborted|turn aborted/)

  defp aborted_title?(_title), do: false

  defp recent_activity?(titles) when is_list(titles), do: titles != []
  defp recent_activity?(_titles), do: false

  defp completed_recently?(titles) when is_list(titles) do
    Enum.any?(titles, fn title ->
      is_binary(title) and
        String.match?(String.downcase(title), ~r/turn completed|task complete|session completed/)
    end)
  end

  defp completed_recently?(_titles), do: false

  defp interrupted_execution(record) do
    issue = IssueMapper.to_issue(record)
    workspace = Workspace.path_for_issue(issue)
    {:ok, agent_kind, _path} = SessionLog.resolve_log_source(issue.agent_kind || "codex", workspace)

    %{
      issue_id: to_string(record.id),
      issue_identifier: record.identifier,
      status: :aborted,
      session_id: record.agent_session_id,
      last_event: "turn_aborted",
      last_message: "Agent run interrupted — resume from the session log",
      last_event_at: record.updated_at,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: 0,
      error: "Agent run interrupted — use Resume in the execution panel",
      agent_kind: agent_kind,
      goal: interrupted_goal(record, agent_kind),
      long_running: is_binary(record.agent_goal) and String.trim(record.agent_goal) != "",
      long_running_kind: interrupted_goal_kind(agent_kind),
      long_running_label: interrupted_goal_label(agent_kind, record.agent_goal),
      tokens: nil
    }
  end

  defp interrupted_goal(%{agent_goal: goal}, agent_kind) when is_binary(goal) do
    objective = String.trim(goal)

    if objective == "" do
      nil
    else
      kind = interrupted_goal_kind(agent_kind)

      %{
        kind: kind,
        source: if(kind == "goal", do: "native", else: "prompt"),
        status: "interrupted",
        objective: objective,
        capabilities: if(kind == "goal", do: ["get", "edit", "pause", "resume", "clear"], else: ["view"])
      }
    end
  end

  defp interrupted_goal(_record, _agent_kind), do: nil

  defp interrupted_goal_kind("claude"), do: "workflow"
  defp interrupted_goal_kind("cursor"), do: "workflow"
  defp interrupted_goal_kind(_), do: "goal"

  defp interrupted_goal_label(_agent_kind, goal) when is_binary(goal) do
    if String.trim(goal) == "", do: nil, else: "Interrupted"
  end

  defp interrupted_goal_label(_agent_kind, _goal), do: nil

  defp normalize_status_name(value) when is_binary(value),
    do: value |> String.trim() |> String.downcase()

  defp normalize_status_name(_value), do: ""

  defp identifier(entry), do: Map.get(entry, :identifier)
  defp issue_id(entry), do: entry |> Map.get(:issue_id) |> maybe_to_string()

  defp execution_goal(entry) do
    Map.get(entry, :goal) || fallback_goal(entry)
  end

  defp fallback_goal(entry) do
    case Map.get(entry, :agent_goal) do
      goal when is_binary(goal) ->
        objective = String.trim(goal)

        if objective == "" do
          nil
        else
          kind = goal_kind(entry)

          %{
            kind: kind,
            source: goal_source(kind),
            status: "active",
            objective: objective,
            capabilities: goal_capabilities(kind)
          }
        end

      _goal ->
        nil
    end
  end

  defp goal_kind(%{agent_kind: kind}) when kind in ["claude", "cursor"], do: "workflow"
  defp goal_kind(_entry), do: "goal"

  defp goal_source("goal"), do: "native"
  defp goal_source("workflow"), do: "prompt"

  defp goal_capabilities("goal"), do: ["get", "edit", "pause", "resume", "clear"]
  defp goal_capabilities("workflow"), do: ["view"]
  defp goal_capabilities(_kind), do: []

  defp long_running_kind(%{kind: kind}) when is_binary(kind), do: kind
  defp long_running_kind(_goal), do: nil

  defp long_running_label(%{kind: "workflow"}), do: "Pursuing workflow"
  defp long_running_label(%{kind: "goal"}), do: "Pursuing goal"
  defp long_running_label(_goal), do: nil

  defp maybe_to_string(nil), do: nil
  defp maybe_to_string(value), do: to_string(value)

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

  def format_failure({:turn_failed, message}) when is_binary(message), do: message
  def format_failure({:error, reason}), do: format_failure(reason)

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
