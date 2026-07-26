defmodule SymphonyElixir.MobileRpc.MobileSubscription do
  @moduledoc """
  Connection-scoped snapshot subscription for copied Orca views.

  The process owns no domain state. It polls the existing Symphony service,
  emits only changed snapshots, and dies with the authenticated connection.
  """

  use GenServer, restart: :temporary

  defstruct connection_pid: nil,
            connection_monitor: nil,
            subscription_id: nil,
            event_prefix: nil,
            interval_ms: 500,
            load: nil,
            active: false,
            snapshot: nil,
            digest: nil

  @spec subscribe(keyword()) ::
          {:ok, {:subscription, String.t(), map(), (-> :ok), (-> :ok)}}
          | {:error, term()}
  def subscribe(opts) when is_list(opts) do
    with {:ok, pid} <- GenServer.start(__MODULE__, opts) do
      subscription_id = Keyword.fetch!(opts, :subscription_id)

      cleanup = fn ->
        if Process.alive?(pid), do: GenServer.stop(pid, :normal)
        :ok
      end

      activate = fn ->
        if Process.alive?(pid), do: GenServer.cast(pid, :activate)
        :ok
      end

      {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}}
    end
  end

  @impl true
  def init(opts) do
    connection_pid = Keyword.fetch!(opts, :connection_pid)
    load = Keyword.fetch!(opts, :load)

    with true <- is_pid(connection_pid),
         true <- is_function(load, 0),
         {:ok, snapshot} <- load.() do
      {:ok,
       %__MODULE__{
         connection_pid: connection_pid,
         connection_monitor: Process.monitor(connection_pid),
         subscription_id: Keyword.fetch!(opts, :subscription_id),
         event_prefix: Keyword.fetch!(opts, :event_prefix),
         interval_ms: Keyword.get(opts, :interval_ms, 500),
         load: load,
         snapshot: snapshot
       }}
    else
      false -> {:stop, :invalid_subscription}
      {:error, reason} -> {:stop, reason}
      _unexpected -> {:stop, :snapshot_failed}
    end
  end

  @impl true
  def handle_cast(:activate, %{active: false} = state) do
    emit(state, "snapshot", Map.put(state.snapshot, "type", "snapshot"))
    schedule_poll(state.interval_ms)
    {:noreply, %{state | active: true, digest: digest(state.snapshot)}}
  end

  def handle_cast(:activate, state), do: {:noreply, state}

  @impl true
  def handle_info(:poll, %{active: true} = state) do
    next =
      case state.load.() do
        {:ok, snapshot} ->
          next_digest = digest(snapshot)

          if next_digest != state.digest do
            emit(state, "updated", Map.put(snapshot, "type", "updated"))
            %{state | snapshot: snapshot, digest: next_digest}
          else
            state
          end

        _error ->
          state
      end

    schedule_poll(next.interval_ms)
    {:noreply, next}
  end

  def handle_info(
        {:DOWN, ref, :process, _pid, _reason},
        %{connection_monitor: ref} = state
      ),
      do: {:stop, :connection_closed, state}

  def handle_info(_message, state), do: {:noreply, state}

  defp emit(state, suffix, payload) do
    send(
      state.connection_pid,
      {:mobile_rpc_event, state.subscription_id, "#{state.event_prefix}.#{suffix}", payload}
    )
  end

  defp schedule_poll(interval_ms) when is_integer(interval_ms) and interval_ms > 0,
    do: Process.send_after(self(), :poll, interval_ms)

  defp digest(snapshot), do: :erlang.phash2(snapshot)
end
