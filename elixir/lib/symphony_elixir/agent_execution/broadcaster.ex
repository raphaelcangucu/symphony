defmodule SymphonyElixir.AgentExecution.Broadcaster do
  @moduledoc """
  Coalesces agent execution changes into debounced PubSub snapshots.
  """

  use GenServer

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixirWeb.TrackerPresenter

  @debounce_ms 200
  @pubsub SymphonyElixir.PubSub
  @topic "agent_executions"
  @snapshot_event "snapshot"

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, :ok, name: name)
  end

  @spec notify() :: :ok
  def notify do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) ->
        GenServer.cast(pid, :dirty)
        :ok

      _ ->
        :ok
    end
  end

  @impl true
  def init(:ok), do: {:ok, %{flush_timer_ref: nil}}

  @impl true
  def handle_cast(:dirty, %{flush_timer_ref: nil} = state) do
    flush_timer_ref = Process.send_after(self(), :flush, @debounce_ms)
    {:noreply, %{state | flush_timer_ref: flush_timer_ref}}
  end

  def handle_cast(:dirty, state), do: {:noreply, state}

  @impl true
  def handle_info(:flush, state) do
    broadcast_snapshot()
    {:noreply, %{state | flush_timer_ref: nil}}
  end

  defp broadcast_snapshot do
    data = AgentExecution.list() |> Enum.map(&TrackerPresenter.agent_execution/1)
    Phoenix.PubSub.broadcast(@pubsub, @topic, {:agent_execution_event, @snapshot_event, %{"data" => data}})
  end
end
