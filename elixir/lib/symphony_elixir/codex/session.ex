defmodule SymphonyElixir.Codex.Session do
  @moduledoc """
  Persists and resolves the Codex conversation (thread) id tied to an issue
  workspace so the issue terminal can resume the agent's Codex session.

  Resolution order:

    1. The workspace sidecar file written when an agent run starts.
    2. A scan of the Codex rollout store (`~/.codex/sessions`) for the most
       recent session whose recorded `cwd` matches the workspace.
  """

  require Logger

  @sidecar_relative_path ".symphony/codex-session.json"
  @default_sessions_dir "~/.codex/sessions"
  @scan_limit 500

  @doc """
  Persist the Codex `thread_id` for a workspace. Best-effort: never raises and
  never blocks the agent run on failure.
  """
  @spec write(Path.t(), String.t()) :: :ok
  def write(workspace, thread_id)
      when is_binary(workspace) and is_binary(thread_id) and thread_id != "" do
    path = sidecar_path(workspace)

    payload = %{
      "thread_id" => thread_id,
      "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, Jason.encode!(payload)) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("codex session sidecar write failed workspace=#{workspace} reason=#{inspect(reason)}")
        :ok
    end
  end

  def write(_workspace, _thread_id), do: :ok

  @doc """
  Resolve the Codex thread id for a workspace, checking the sidecar first and
  falling back to scanning the rollout store by `cwd`.
  """
  @spec resolve(Path.t(), keyword()) :: {:ok, String.t()} | :error
  def resolve(workspace, opts \\ []) when is_binary(workspace) do
    case read_sidecar(workspace) do
      {:ok, thread_id} ->
        {:ok, thread_id}

      :error ->
        case scan_rollouts(workspace, opts) do
          {:ok, thread_id} ->
            write(workspace, thread_id)
            {:ok, thread_id}

          :error ->
            :error
        end
    end
  end

  defp sidecar_path(workspace), do: Path.join(Path.expand(workspace), @sidecar_relative_path)

  defp read_sidecar(workspace) do
    path = sidecar_path(workspace)

    with {:ok, contents} <- File.read(path),
         {:ok, %{"thread_id" => thread_id}} when is_binary(thread_id) and thread_id != "" <-
           Jason.decode(contents) do
      {:ok, thread_id}
    else
      _absent -> :error
    end
  end

  defp scan_rollouts(workspace, opts) do
    target = Path.expand(workspace)

    sessions_dir(opts)
    |> Path.join("**/*.jsonl")
    |> Path.wildcard()
    |> Enum.sort(:desc)
    |> Enum.take(@scan_limit)
    |> Enum.find_value(:error, fn file ->
      case rollout_thread_id(file, target) do
        {:ok, thread_id} -> {:ok, thread_id}
        :error -> nil
      end
    end)
  end

  defp rollout_thread_id(file, target) do
    with {:ok, line} when is_binary(line) <- first_line(file),
         {:ok, %{"type" => "session_meta", "payload" => %{"cwd" => cwd, "id" => id}}}
         when is_binary(cwd) and is_binary(id) and id != "" <- Jason.decode(line),
         true <- Path.expand(cwd) == target do
      {:ok, id}
    else
      _no_match -> :error
    end
  end

  defp first_line(file) do
    case File.open(file, [:read, :utf8], fn io -> IO.read(io, :line) end) do
      {:ok, line} when is_binary(line) -> {:ok, line}
      _error -> :error
    end
  rescue
    _error -> :error
  end

  defp sessions_dir(opts) do
    Keyword.get(opts, :sessions_dir) ||
      Application.get_env(:symphony_elixir, :codex_sessions_dir) ||
      Path.expand(@default_sessions_dir)
  end
end
