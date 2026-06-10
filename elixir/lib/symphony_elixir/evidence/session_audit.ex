defmodule SymphonyElixir.Evidence.SessionAudit do
  @moduledoc """
  Cross-checks evidence manifest commands against the Codex session rollout
  log: every declared command must appear as an executed `exec_command` tool
  call in the session. Fails closed when the rollout cannot be read.

  Matching is substring containment: manifest commands are frequently
  re-quoted or prefixed in the session (e.g. `cd frontend && npm test`).
  """

  alias SymphonyElixir.Codex.SessionLog

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
  def rollout_path_for_workspace(workspace), do: SessionLog.resolve_rollout_path(workspace, [])

  defp executed_commands(opts) do
    path = resolve_path(opts)

    with true <- is_binary(path) and File.exists?(path),
         {:ok, raw} <- File.read(path) do
      commands =
        raw
        |> String.split("\n", trim: true)
        |> Enum.map(&SessionLog.parse_line/1)
        |> Enum.filter(&match?(%{"kind" => "tool_call", "title" => "exec_command"}, &1))
        |> Enum.flat_map(&extract_cmd/1)

      {:ok, commands}
    else
      _unreadable -> {:error, :session_log_unavailable}
    end
  end

  defp resolve_path(opts) do
    case Keyword.fetch(opts, :rollout_path) do
      {:ok, explicit} ->
        explicit

      :error ->
        case rollout_path_for_workspace(Keyword.fetch!(opts, :workspace)) do
          {:ok, resolved} -> resolved
          :error -> nil
        end
    end
  end

  defp extract_cmd(%{"body" => body}) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, %{"cmd" => cmd}} when is_binary(cmd) -> [cmd]
      _other -> [body]
    end
  end

  defp extract_cmd(_entry), do: []
end
