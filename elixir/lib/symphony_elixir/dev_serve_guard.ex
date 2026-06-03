defmodule SymphonyElixir.DevServeGuard do
  @moduledoc """
  Enforces a single local tracker `serve` process per machine.

  Running two `make serve` instances with different WORKFLOW files points the same issue
  identifiers at divergent workspaces (different `workspace.root` / `tracker_kind`), which makes
  authored documents "disappear" from one server's view. This guard uses a shared lock file in a
  config-independent location so a second boot fails fast with a clear message instead of silently
  creating parallel workspaces. A lock whose process is no longer alive is treated as stale and
  taken over, so crashes never wedge future boots.
  """

  require Logger

  @lock_name "symphony-tracker-serve.lock"

  @type lock_info :: %{required(String.t()) => String.t()}

  @doc """
  Acquires the serve lock. Returns `:ok` after recording the current process, or
  `{:error, {:already_running, lock_info}}` when another live serve already holds it.

  Options (all optional, used for tests):

    * `:lock_path`    — override the lock file location.
    * `:self_pid`     — current OS pid (defaults to `System.pid/0`).
    * `:workflow_path`— recorded in the lock to make the error message actionable.
    * `:alive?`       — predicate deciding whether a recorded pid is still running.
  """
  @spec acquire(keyword()) :: :ok | {:error, {:already_running, lock_info()}}
  def acquire(opts \\ []) when is_list(opts) do
    lock_path = Keyword.get(opts, :lock_path, default_lock_path())
    self_pid = opts |> Keyword.get(:self_pid, System.pid()) |> to_string()
    workflow_path = opts |> Keyword.get(:workflow_path) |> normalize_workflow_path()
    node_name = Keyword.get(opts, :node_name, "")
    alive? = Keyword.get(opts, :alive?, &os_process_alive?/1)

    case read_lock(lock_path) do
      {:ok, %{"pid" => pid} = existing} when is_binary(pid) and pid != "" ->
        cond do
          pid == self_pid -> write_lock(lock_path, self_pid, workflow_path, node_name)
          alive?.(pid) -> {:error, {:already_running, existing}}
          true -> write_lock(lock_path, self_pid, workflow_path, node_name)
        end

      _ ->
        write_lock(lock_path, self_pid, workflow_path, node_name)
    end
  end

  @spec default_lock_path() :: Path.t()
  def default_lock_path, do: Path.join(System.tmp_dir!(), @lock_name)

  @doc """
  Reads the current lock contents, if any. Used by `mix symphony.ctl` to discover
  the running daemon's node name without re-deriving it from the environment.
  """
  @spec read(Path.t()) :: {:ok, lock_info()} | :error
  def read(lock_path \\ default_lock_path()), do: read_lock(lock_path)

  defp write_lock(lock_path, self_pid, workflow_path, node_name) do
    payload = %{
      "pid" => self_pid,
      "workflow_path" => workflow_path,
      "node_name" => node_name,
      "acquired_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }

    File.mkdir_p!(Path.dirname(lock_path))
    File.write!(lock_path, Jason.encode!(payload))
    :ok
  end

  defp read_lock(lock_path) do
    with {:ok, body} <- File.read(lock_path),
         {:ok, %{} = decoded} <- Jason.decode(body) do
      {:ok, decoded}
    else
      _ -> :error
    end
  end

  defp normalize_workflow_path(nil), do: ""
  defp normalize_workflow_path(path) when is_binary(path), do: path

  defp os_process_alive?(pid) when is_binary(pid) do
    case System.cmd("kill", ["-0", pid], stderr_to_stdout: true) do
      {_output, 0} -> true
      _ -> false
    end
  rescue
    _error -> false
  end
end
