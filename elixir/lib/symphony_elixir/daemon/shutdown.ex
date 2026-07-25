defmodule SymphonyElixir.Daemon.Shutdown do
  @moduledoc "Admission gate and bounded active-work drain."

  use GenServer

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, :admitting, name: name)
  end

  @spec admitting?(GenServer.server()) :: boolean()
  def admitting?(server \\ __MODULE__) do
    GenServer.call(server, :admitting?)
  catch
    :exit, _reason -> true
  end

  @spec begin_drain(GenServer.server()) :: :ok
  def begin_drain(server \\ __MODULE__) do
    GenServer.call(server, :begin_drain)
  end

  @spec reset(GenServer.server()) :: :ok
  def reset(server \\ __MODULE__) do
    GenServer.call(server, :reset)
  end

  @spec drain(non_neg_integer(), keyword()) :: {:ok, map()} | {:timeout, map()}
  def drain(timeout_ms, opts \\ []) do
    begin_fun = Keyword.get(opts, :begin_drain, &begin_drain/0)
    snapshot_fun = Keyword.get(opts, :work_snapshot, &work_snapshot/0)
    interrupt_fun = Keyword.get(opts, :interrupt_assistants, &interrupt_assistants/2)
    sleep_fun = Keyword.get(opts, :sleep, &Process.sleep/1)

    monotonic =
      Keyword.get(opts, :monotonic_ms, fn -> System.monotonic_time(:millisecond) end)

    :ok = begin_fun.()
    deadline = monotonic.() + timeout_ms
    await(snapshot_fun, interrupt_fun, sleep_fun, monotonic, deadline)
  end

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call(:admitting?, _from, state), do: {:reply, state == :admitting, state}

  def handle_call(:begin_drain, _from, _state), do: {:reply, :ok, :draining}

  def handle_call(:reset, _from, _state), do: {:reply, :ok, :admitting}

  defp await(snapshot, interrupt, sleep, monotonic, deadline) do
    work = snapshot.()

    cond do
      work.assistant == [] and work.issues == [] ->
        {:ok, work}

      monotonic.() >= deadline ->
        :ok = interrupt.(work.assistant, "daemon_shutdown_timeout")
        {:timeout, work}

      true ->
        sleep.(250)
        await(snapshot, interrupt, sleep, monotonic, deadline)
    end
  end

  defp work_snapshot do
    issue_ids =
      case SymphonyElixir.Orchestrator.snapshot() do
        %{running: running} -> Enum.map(running, & &1.identifier)
        _other -> []
      end

    %{
      assistant: SymphonyElixir.Assistant.TurnManager.active_thread_ids(),
      issues: issue_ids
    }
  end

  defp interrupt_assistants(ids, reason) do
    SymphonyElixir.Assistant.TurnManager.interrupt_all(ids, reason)
  end
end
