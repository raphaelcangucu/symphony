defmodule SymphonyElixir.SessionLog do
  @moduledoc """
  Facade that delegates session log operations to the agent-specific backend
  based on `agent_kind`.

  Supported backends:
  - `"codex"` → `SymphonyElixir.Codex.SessionLog`
  - `"claude"` → `SymphonyElixir.Claude.SessionLog`
  - `"cursor"` → `SymphonyElixir.Cursor.SessionLog`
  """

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Codex.SessionLog, as: CodexLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog

  @spec resolve_log_path(String.t(), Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(agent_kind, workspace, opts \\ [])

  def resolve_log_path("codex", workspace, opts), do: CodexLog.resolve_rollout_path(workspace, opts)
  def resolve_log_path("claude", workspace, opts), do: ClaudeLog.resolve_log_path(workspace, opts)
  def resolve_log_path("cursor", workspace, opts), do: CursorLog.resolve_log_path(workspace, opts)
  def resolve_log_path(_agent_kind, workspace, opts), do: CodexLog.resolve_rollout_path(workspace, opts)

  @spec tail(String.t(), Path.t(), keyword()) :: {:ok, [map()], non_neg_integer()}
  def tail(agent_kind, path, opts \\ [])

  def tail("claude", path, opts), do: ClaudeLog.tail(path, opts)
  def tail("cursor", path, opts), do: CursorLog.tail(path, opts)
  def tail(_agent_kind, path, opts), do: CodexLog.tail(path, opts)

  @spec read_from(String.t(), Path.t(), non_neg_integer()) :: {:ok, [map()], non_neg_integer()} | {:error, term()}
  def read_from(agent_kind, path, offset)

  def read_from("claude", path, offset), do: ClaudeLog.read_from(path, offset)
  def read_from("cursor", path, offset), do: CursorLog.read_from(path, offset)
  def read_from(_agent_kind, path, offset), do: CodexLog.read_from(path, offset)
end
