defmodule SymphonyElixir.MobileRpc.AuthLimiter do
  @moduledoc "Small in-memory rate limiter for repeated mobile handshake failures."

  use GenServer

  @table __MODULE__
  @window_ms 60_000
  @max_failures 5

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @spec allowed?(term()) :: boolean()
  def allowed?(key) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, key) do
      [{^key, count, started_at}] when now - started_at < @window_ms ->
        count < @max_failures

      _other ->
        true
    end
  rescue
    ArgumentError -> true
  end

  @spec record_failure(term()) :: :ok
  def record_failure(key) do
    GenServer.call(__MODULE__, {:record_failure, key})
  catch
    :exit, _reason -> :ok
  end

  @spec reset(term()) :: :ok
  def reset(key) do
    GenServer.cast(__MODULE__, {:reset, key})
    :ok
  catch
    :exit, _reason -> :ok
  end

  @impl GenServer
  def init(:ok) do
    :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    {:ok, %{}}
  end

  @impl GenServer
  def handle_call({:record_failure, key}, _from, state) do
    now = System.monotonic_time(:millisecond)

    count =
      case :ets.lookup(@table, key) do
        [{^key, count, started_at}] when now - started_at < @window_ms -> count + 1
        _other -> 1
      end

    :ets.insert(@table, {key, count, now})
    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_cast({:reset, key}, state) do
    :ets.delete(@table, key)
    {:noreply, state}
  end
end
