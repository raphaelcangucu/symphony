defmodule SymphonyElixir.Orchestrator.WorkerTerminator do
  @moduledoc """
  Stops an orchestrator worker without abandoning its agent CLI process tree.

  Agent workers block inside a runner receive loop that understands
  `:agent_interrupt` and kills the complete OS process group. Give that path a
  short grace period before falling back to force-stopping the supervised Task.
  """

  @default_grace_ms 1_000
  @force_wait_ms 1_000

  @spec stop(pid(), keyword()) :: :ok
  def stop(pid, opts \\ [])

  def stop(pid, opts) when is_pid(pid) do
    grace_ms = Keyword.get(opts, :grace_ms, @default_grace_ms)

    force_stop =
      Keyword.get_lazy(opts, :force_stop, fn ->
        supervisor =
          Keyword.get(
            opts,
            :supervisor,
            SymphonyElixir.Orchestrator.TaskSupervisor
          )

        &force_stop(supervisor, &1)
      end)

    monitor = Process.monitor(pid)

    try do
      send(pid, :agent_interrupt)

      case await_down(monitor, pid, grace_ms) do
        :down ->
          :ok

        :timeout ->
          _ = force_stop.(pid)
          _ = await_down(monitor, pid, @force_wait_ms)
          :ok
      end
    after
      Process.demonitor(monitor, [:flush])
    end
  end

  def stop(_pid, _opts), do: :ok

  defp await_down(monitor, pid, timeout_ms) do
    receive do
      {:DOWN, ^monitor, :process, ^pid, _reason} -> :down
    after
      max(timeout_ms, 0) -> :timeout
    end
  end

  defp force_stop(supervisor, pid) do
    case Task.Supervisor.terminate_child(supervisor, pid) do
      :ok ->
        :ok

      {:error, :not_found} ->
        Process.exit(pid, :kill)
        :ok
    end
  catch
    :exit, _reason ->
      Process.exit(pid, :kill)
      :ok
  end
end
