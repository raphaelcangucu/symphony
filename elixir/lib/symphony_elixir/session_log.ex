defmodule SymphonyElixir.SessionLog do
  @moduledoc """
  Facade that delegates session log operations to the agent-specific backend
  based on `agent_kind`.

  Supported backends:
  - `"codex"` → `SymphonyElixir.Codex.SessionLog`
  - `"claude"` → `SymphonyElixir.Claude.SessionLog`
  - `"cursor"` → `SymphonyElixir.Cursor.SessionLog`
  - `"opencode"` → `SymphonyElixir.OpenCode.SessionLog`

  SUBAGENT helpers (`resolve_subagent/3`, `list_subagents/3`, `subagent_meta/2`)
  dispatch to `SymphonyElixir.SessionLogBackend` implementations. Unknown
  agent kinds use safe defaults (`:error` / `[]` / `%{}`) rather than falling
  back to Codex.
  """

  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Codex.SessionLog, as: CodexLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog
  alias SymphonyElixir.OpenCode.SessionLog, as: OpenCodeLog
  alias SymphonyElixir.SessionEvents

  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()
  @join_tail_bytes 512_000

  @doc """
  Resolves the best available session log for a workspace.

  Tries the preferred agent first, then falls back to other backends so prior
  agent history remains visible after switching agents.
  """
  @spec resolve_log_source(String.t(), Path.t(), keyword()) :: {:ok, String.t(), Path.t()} | :error
  def resolve_log_source(preferred_kind, workspace, opts \\ []) when is_binary(workspace) do
    kinds =
      [preferred_kind | @agent_kinds]
      |> Enum.uniq()
      |> Enum.reject(&is_nil/1)

    Enum.find_value(kinds, fn kind ->
      case resolve_log_path(kind, workspace, opts) do
        {:ok, path} -> {kind, path}
        :error -> nil
      end
    end)
    |> case do
      {kind, path} -> {:ok, kind, path}
      nil -> :error
    end
  end

  @doc """
  Resolves the log source for a specific session, preferring its own
  per-session transcript file over the working tree's native agent log.
  """
  @spec resolve_for_session(map()) :: {:ok, String.t(), Path.t()} | :error
  def resolve_for_session(%{id: session_id, workspace_path: workspace} = session)
      when is_binary(workspace) do
    if SessionStore.exists?(workspace, session_id) do
      {:ok, "symphony", SessionStore.transcript_path(workspace, session_id)}
    else
      resolve_log_source(Map.get(session, :agent_kind) || "codex", workspace)
    end
  end

  def resolve_for_session(_session), do: :error

  @doc false
  @spec join_tail_opts() :: keyword()
  def join_tail_opts, do: [max_bytes: @join_tail_bytes]

  @spec resolve_log_path(String.t(), Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(agent_kind, workspace, opts \\ [])

  def resolve_log_path("codex", workspace, opts), do: CodexLog.resolve_rollout_path(workspace, opts)
  def resolve_log_path("claude", workspace, opts), do: ClaudeLog.resolve_log_path(workspace, opts)
  def resolve_log_path("cursor", workspace, opts), do: CursorLog.resolve_log_path(workspace, opts)
  def resolve_log_path("opencode", workspace, opts), do: OpenCodeLog.resolve_log_path(workspace, opts)
  def resolve_log_path(_agent_kind, workspace, opts), do: CodexLog.resolve_rollout_path(workspace, opts)

  @doc """
  Resolves the workspace directory whose session log should be tailed for a run.

  Child bundle runs execute in an isolated git worktree; their agent logs live
  there rather than in the standard per-issue workspace.
  """
  @spec run_log_workspace(map() | String.t(), keyword()) :: String.t() | nil
  def run_log_workspace(issue, run_opts \\ [])

  def run_log_workspace(issue, run_opts) when is_map(issue) do
    issue
    |> SymphonyElixir.Workspace.path_for_issue()
    |> worktree_log_workspace(run_opts)
  end

  def run_log_workspace(identifier, run_opts) when is_binary(identifier) do
    identifier
    |> SymphonyElixir.Workspace.path_for_issue()
    |> worktree_log_workspace(run_opts)
  end

  @spec worktree_log_workspace(String.t(), keyword()) :: String.t()
  def worktree_log_workspace(fallback, run_opts) when is_binary(fallback) and is_list(run_opts) do
    with true <- Keyword.get(run_opts, :worktree) == true,
         repo when is_binary(repo) and repo != "" <- Keyword.get(run_opts, :worktree_repo),
         slug when is_binary(slug) and slug != "" <- worktree_log_slug(run_opts),
         path <- Path.join([repo, ".worktrees", slug]),
         true <- File.dir?(path) do
      path
    else
      _ -> fallback
    end
  end

  defp worktree_log_slug(run_opts) do
    (Keyword.get(run_opts, :unit_id) || "")
    |> to_string()
    |> String.replace(~r/[^A-Za-z0-9_.-]+/, "-")
  end

  @spec tail(String.t(), Path.t(), keyword()) :: {:ok, [map()], non_neg_integer()}
  def tail(agent_kind, path, opts \\ [])

  def tail("claude", path, opts), do: tail_with_events(ClaudeLog.tail(path, opts), opts)
  def tail("cursor", path, opts), do: tail_with_events(CursorLog.tail(path, opts), opts)
  def tail("opencode", path, opts), do: tail_with_events(OpenCodeLog.tail(path, opts), opts)
  def tail(_agent_kind, path, opts), do: tail_with_events(CodexLog.tail(path, opts), opts)

  @spec read_from(String.t(), Path.t(), non_neg_integer(), keyword()) ::
          {:ok, [map()], non_neg_integer()} | {:error, term()}
  def read_from(agent_kind, path, offset, opts \\ [])

  def read_from("claude", path, offset, opts),
    do: read_from_with_events(ClaudeLog.read_from(path, offset), offset, opts)

  def read_from("cursor", path, offset, opts),
    do: read_from_with_events(CursorLog.read_from(path, offset), offset, opts)

  def read_from("opencode", path, offset, opts),
    do: read_from_with_events(OpenCodeLog.read_from(path, offset), offset, opts)

  def read_from(_agent_kind, path, offset, opts),
    do: read_from_with_events(CodexLog.read_from(path, offset), offset, opts)

  @doc """
  Resolves a SUBAGENT transcript path for the given agent kind.

  Unlike `resolve_log_path/3`, unknown agent kinds return `:error` (no Codex
  fallback) because subagent layouts differ per agent.
  """
  @spec resolve_subagent(String.t(), String.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_subagent(agent_kind, id, opts \\ [])

  def resolve_subagent("codex", id, opts), do: CodexLog.resolve_subagent_path(id, opts)
  def resolve_subagent("claude", id, opts), do: ClaudeLog.resolve_subagent_path(id, opts)
  def resolve_subagent("cursor", id, opts), do: CursorLog.resolve_subagent_path(id, opts)
  def resolve_subagent("opencode", id, opts), do: OpenCodeLog.resolve_subagent_path(id, opts)
  def resolve_subagent(_agent_kind, _id, _opts), do: :error

  @doc """
  Lists SUBAGENT transcripts for a parent log path.

  Unknown agent kinds return `[]`.
  """
  @spec list_subagents(String.t(), Path.t(), keyword()) :: [map()]
  def list_subagents(agent_kind, parent_path, opts \\ [])

  def list_subagents("codex", parent_path, opts), do: CodexLog.list_subagents(parent_path, opts)
  def list_subagents("claude", parent_path, opts), do: ClaudeLog.list_subagents(parent_path, opts)
  def list_subagents("cursor", parent_path, opts), do: CursorLog.list_subagents(parent_path, opts)
  def list_subagents("opencode", parent_path, opts), do: OpenCodeLog.list_subagents(parent_path, opts)
  def list_subagents(_agent_kind, _parent_path, _opts), do: []

  @doc """
  Reads lightweight metadata for a SUBAGENT transcript path.

  Unknown agent kinds return `%{}`.
  """
  @spec subagent_meta(String.t(), Path.t()) :: map()
  def subagent_meta("codex", path), do: CodexLog.subagent_meta(path)
  def subagent_meta("claude", path), do: ClaudeLog.subagent_meta(path)
  def subagent_meta("cursor", path), do: CursorLog.subagent_meta(path)
  def subagent_meta("opencode", path), do: OpenCodeLog.subagent_meta(path)
  def subagent_meta(_agent_kind, _path), do: %{}

  defp tail_with_events({:ok, entries, offset}, opts) do
    {:ok, merge_workspace_events(entries, opts), offset}
  end

  defp tail_with_events(other, _opts), do: other

  # Incremental polling must NOT re-merge the Symphony session-events file. The
  # session log channel streams those separately via its own symphony offset, so
  # merging the full events file on every tick would re-push each prior
  # annotation forever (the transcript grows without bound). Only the initial
  # `tail` merges the Symphony history once.
  defp read_from_with_events({:ok, entries, offset}, _path_offset, _opts), do: {:ok, entries, offset}

  defp read_from_with_events(other, _path_offset, _opts), do: other

  defp merge_workspace_events(entries, opts) do
    case Keyword.get(opts, :workspace) do
      workspace when is_binary(workspace) ->
        case SessionEvents.tail(workspace, max_bytes: @join_tail_bytes) do
          {:ok, symphony_entries, _} ->
            SessionEvents.merge_entries(entries, symphony_entries)

          _ ->
            entries
        end

      _ ->
        entries
    end
  end
end
