defmodule SymphonyElixir.AgentExecution do
  @moduledoc """
  Derives a per-issue agent execution view from the orchestrator snapshot.

  The orchestrator tracks active agents in its `running` and `retry_attempts`
  maps. This module projects that runtime state into a stable, UI-facing status
  (`:live`, `:idle`, `:waiting`, `:retrying`) keyed by issue identifier so the
  tracker board can show which agent is working an issue and what it is doing.
  """

  alias SymphonyElixir.{Orchestrator, StatusDashboard}

  @typedoc "Coarse, UI-facing execution status derived from orchestrator runtime."
  @type status :: :live | :idle | :waiting | :retrying

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
      %{running: _running, retrying: _retrying} = snapshot -> from_snapshot(snapshot)
      _other -> []
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

    %{
      issue_id: issue_id(entry),
      issue_identifier: entry.identifier,
      status: running_status(entry, last_event_at, now),
      session_id: Map.get(entry, :session_id),
      last_event: Map.get(entry, :last_codex_event),
      last_message: Map.get(entry, :last_codex_message),
      last_event_at: last_event_at,
      turn_count: Map.get(entry, :turn_count, 0),
      runtime_seconds: Map.get(entry, :runtime_seconds),
      started_at: Map.get(entry, :started_at),
      retry_attempt: 0,
      error: nil,
      tokens: %{
        input: Map.get(entry, :agent_input_tokens, 0),
        output: Map.get(entry, :agent_output_tokens, 0),
        total: Map.get(entry, :agent_total_tokens, 0)
      }
    }
  end

  defp retry_execution(entry) do
    %{
      issue_id: issue_id(entry),
      issue_identifier: identifier(entry),
      status: :retrying,
      session_id: nil,
      last_event: nil,
      last_message: nil,
      last_event_at: nil,
      turn_count: 0,
      runtime_seconds: nil,
      started_at: nil,
      retry_attempt: Map.get(entry, :attempt, 0) || 0,
      error: Map.get(entry, :error),
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

  defp identifier(entry), do: Map.get(entry, :identifier)
  defp issue_id(entry), do: entry |> Map.get(:issue_id) |> maybe_to_string()

  defp maybe_to_string(nil), do: nil
  defp maybe_to_string(value), do: to_string(value)

  @doc "Humanizes a raw Codex message for display, mirroring the dashboard."
  @spec humanize_message(term()) :: String.t() | nil
  def humanize_message(nil), do: nil
  def humanize_message(message), do: StatusDashboard.humanize_codex_message(message)
end
