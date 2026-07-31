defmodule SymphonyElixir.Recents.Broadcaster do
  @moduledoc """
  Coalesces recent-item changes into debounced PubSub snapshots.
  """

  use GenServer

  alias SymphonyElixir.Recents
  alias SymphonyElixirWeb.TrackerPresenter

  @debounce_ms 200
  @pubsub SymphonyElixir.PubSub
  @topic "recents"
  @snapshot_event "snapshot"
  @snapshot_limit 100

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, :ok, name: name)
  end

  @spec notify(GenServer.server()) :: :ok
  def notify(server \\ __MODULE__) do
    case server_pid(server) do
      pid when is_pid(pid) ->
        GenServer.cast(pid, :dirty)
        :ok

      _ ->
        :ok
    end
  end

  defp server_pid(server) when is_pid(server), do: server
  defp server_pid(server) when is_atom(server), do: Process.whereis(server)
  defp server_pid(_server), do: nil

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
    data = snapshot_items() |> Enum.map(&TrackerPresenter.recent_item/1)
    Phoenix.PubSub.broadcast(@pubsub, @topic, {:recents_event, @snapshot_event, %{"data" => data}})
  end

  defp snapshot_items do
    case Application.get_env(:symphony_elixir, :recents_snapshot_items_fun) do
      snapshot_fun when is_function(snapshot_fun, 0) -> snapshot_fun.()
      _ -> Recents.list(limit: @snapshot_limit)
    end
  end
end
