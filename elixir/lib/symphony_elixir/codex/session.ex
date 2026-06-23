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
  never blocks the agent run on failure. Merges into the existing sidecar so a
  mirrored goal (see `put_goal/2`) is preserved across writes.
  """
  @spec write(Path.t(), String.t()) :: :ok
  def write(workspace, thread_id)
      when is_binary(workspace) and is_binary(thread_id) and thread_id != "" do
    update_sidecar(workspace, fn data -> Map.put(data, "thread_id", thread_id) end)
  end

  def write(_workspace, _thread_id), do: :ok

  @doc """
  Mirror the native Codex goal for a workspace into the session sidecar.

  The Codex thread remains the source of truth; this is a read-through cache so
  dormant issues (no live worker) can surface the goal objective/status without
  opening an app-server connection. Pass `nil` to remove the mirrored goal.
  Best-effort: never raises.
  """
  @spec put_goal(Path.t(), map() | nil) :: :ok
  def put_goal(workspace, nil) when is_binary(workspace) do
    update_sidecar(workspace, fn data -> Map.delete(data, "goal") end)
  end

  def put_goal(workspace, %{} = goal) when is_binary(workspace) do
    case normalize_goal(goal) do
      nil -> update_sidecar(workspace, fn data -> Map.delete(data, "goal") end)
      normalized -> update_sidecar(workspace, fn data -> Map.put(data, "goal", normalized) end)
    end
  end

  def put_goal(_workspace, _goal), do: :ok

  @doc """
  Read the mirrored native Codex goal for a workspace, if present.

  Returns a string-keyed map with at least `"objective"` and `"status"`.
  """
  @spec read_goal(Path.t()) :: {:ok, map()} | :error
  def read_goal(workspace) when is_binary(workspace) do
    with {:ok, contents} <- File.read(sidecar_path(workspace)),
         {:ok, %{"goal" => %{"objective" => objective} = goal}} <- Jason.decode(contents),
         true <- is_binary(objective) and String.trim(objective) != "" do
      {:ok, goal}
    else
      _absent -> :error
    end
  end

  def read_goal(_workspace), do: :error

  # Keep only the native goal fields we surface in the UI, coercing both atom and
  # string keyed inputs (native results are string-keyed) into a stable shape.
  defp normalize_goal(%{} = goal) do
    objective = goal_field(goal, "objective")

    case objective do
      value when is_binary(value) ->
        trimmed = String.trim(value)

        if trimmed == "" do
          nil
        else
          %{"objective" => trimmed}
          |> maybe_put_goal_field("status", goal_field(goal, "status"))
          |> maybe_put_goal_field("tokenBudget", goal_field(goal, "tokenBudget"))
          |> maybe_put_goal_field("tokensUsed", goal_field(goal, "tokensUsed"))
          |> maybe_put_goal_field("timeUsedSeconds", goal_field(goal, "timeUsedSeconds"))
        end

      _ ->
        nil
    end
  end

  defp goal_field(goal, key) when is_map(goal) do
    Map.get(goal, key) || Map.get(goal, String.to_atom(key))
  end

  defp maybe_put_goal_field(map, _key, nil), do: map
  defp maybe_put_goal_field(map, key, value), do: Map.put(map, key, value)

  defp update_sidecar(workspace, fun) when is_function(fun, 1) do
    path = sidecar_path(workspace)

    data =
      case File.read(path) do
        {:ok, contents} ->
          case Jason.decode(contents) do
            {:ok, %{} = map} -> map
            _ -> %{}
          end

        _ ->
          %{}
      end

    payload =
      data
      |> fun.()
      |> Map.put("updated_at", DateTime.utc_now() |> DateTime.to_iso8601())

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, Jason.encode!(payload)) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("codex session sidecar write failed workspace=#{workspace} reason=#{inspect(reason)}")
        :ok
    end
  end

  @doc """
  Remove the Codex session sidecar for a workspace.

  Best-effort: used by the hard-reset control so the next run does not resolve
  and resume the previous thread. Returns `:ok` even when no sidecar exists.
  """
  @spec clear(Path.t()) :: :ok
  def clear(workspace) when is_binary(workspace) do
    workspace
    |> sidecar_path()
    |> File.rm()
    |> case do
      :ok ->
        :ok

      {:error, :enoent} ->
        :ok

      {:error, reason} ->
        Logger.warning("codex session sidecar clear failed workspace=#{workspace} reason=#{inspect(reason)}")
        :ok
    end
  end

  def clear(_workspace), do: :ok

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
