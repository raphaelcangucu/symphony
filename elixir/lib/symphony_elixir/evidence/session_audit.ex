defmodule SymphonyElixir.Evidence.SessionAudit do
  @moduledoc """
  Cross-checks evidence manifest commands against the session logs of every
  supported coding agent (Codex, Claude, Cursor, OpenCode): every declared
  command must appear as an executed shell tool call in at least one session
  log resolved for the issue workspace. Fails closed when no session log can
  be read at all.

  Evidence is legitimately produced by whichever agent ran the issue — and a
  workspace may accumulate logs from several agents after retries or agent
  switches — so the audit accepts a command found in ANY resolved log rather
  than only the Codex rollout.

  Matching is substring containment: manifest commands are frequently
  re-quoted or prefixed in the session (e.g. `cd frontend && npm test`).
  """

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Codex.Session, as: CodexSession
  alias SymphonyElixir.Codex.SessionLog, as: CodexLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog
  alias SymphonyElixir.OpenCode.SessionLog, as: OpenCodeLog
  alias SymphonyElixir.SessionLog

  @audited_agent_kinds ~w(codex claude cursor opencode)

  @spec verify_commands([String.t()], keyword()) ::
          :ok | {:error, :session_log_unavailable | {:commands_not_executed, [String.t()]}}
  def verify_commands(commands, opts) do
    with {:ok, executed} <- executed_commands(opts) do
      missing =
        Enum.reject(commands, fn declared ->
          needle = String.trim(declared)
          needle != "" and Enum.any?(executed, &String.contains?(&1, needle))
        end)

      case missing do
        [] -> :ok
        missing -> {:error, {:commands_not_executed, missing}}
      end
    end
  end

  @spec rollout_path_for_workspace(Path.t()) :: {:ok, Path.t()} | :error
  def rollout_path_for_workspace(workspace), do: CodexLog.resolve_rollout_path(workspace, [])

  defp executed_commands(opts) do
    case log_sources(opts) do
      [] ->
        {:error, :session_log_unavailable}

      sources ->
        {:ok, Enum.flat_map(sources, fn {kind, path} -> extract_commands(kind, path) end)}
    end
  end

  # Resolution order:
  #
  #   1. `:sources` — explicit `{agent_kind, path}` pairs (tests / callers that
  #      already resolved a specific session).
  #   2. `:rollout_path` — legacy explicit Codex rollout path.
  #   3. `:workspace` — resolve the newest available log of EVERY supported
  #      agent kind for the issue workspace.
  defp log_sources(opts) do
    cond do
      is_list(Keyword.get(opts, :sources)) ->
        opts |> Keyword.fetch!(:sources) |> Enum.filter(fn {_kind, path} -> readable?(path) end)

      Keyword.has_key?(opts, :rollout_path) ->
        path = Keyword.fetch!(opts, :rollout_path)
        if readable?(path), do: [{"codex", path}], else: []

      true ->
        workspace = Keyword.fetch!(opts, :workspace)

        @audited_agent_kinds
        |> Enum.flat_map(fn kind ->
          case SessionLog.resolve_log_path(kind, workspace, []) do
            {:ok, path} -> [{kind, path}]
            :error -> []
          end
        end)
        |> Kernel.++(all_codex_rollouts(workspace))
        |> Enum.uniq_by(fn {_kind, path} -> path end)
        |> Enum.filter(fn {_kind, path} -> readable?(path) end)
    end
  end

  # An issue often spans several Codex sessions (retries, re-dispatches), and
  # evidence commands may have run in ANY of them — the sidecar-resolved
  # rollout alone misses earlier sessions of the same workspace.
  defp all_codex_rollouts(workspace) do
    workspace
    |> CodexSession.rollout_paths_for_workspace()
    |> Enum.map(&{"codex", &1})
  rescue
    _error -> []
  end

  defp readable?(path), do: is_binary(path) and File.exists?(path)

  defp extract_commands(kind, path) do
    case File.read(path) do
      {:ok, raw} ->
        raw
        |> String.split("\n", trim: true)
        |> Enum.flat_map(&parse_entries(kind, &1))
        |> Enum.filter(&tool_call?/1)
        |> Enum.flat_map(&extract_cmd/1)

      {:error, _reason} ->
        []
    end
  end

  defp parse_entries("codex", line), do: List.wrap(CodexLog.parse_line(line))
  defp parse_entries("claude", line), do: List.wrap(ClaudeLog.parse_line(line))
  defp parse_entries("cursor", line), do: CursorLog.parse_entries(line)
  defp parse_entries("opencode", line), do: OpenCodeLog.parse_entries(line)
  defp parse_entries(_kind, _line), do: []

  defp tool_call?(%{"kind" => "tool_call"}), do: true
  defp tool_call?(_entry), do: false

  defp extract_cmd(%{"body" => body}) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, %{"cmd" => cmd}} when is_binary(cmd) -> [cmd]
      {:ok, %{"command" => cmd}} when is_binary(cmd) -> [cmd, body]
      _other -> [body]
    end
  end

  defp extract_cmd(_entry), do: []
end
