defmodule SymphonyElixir.MobileRpc.NotificationSubscription do
  @moduledoc false

  use GenServer, restart: :temporary

  @topic "mobile_notifications"

  @spec topic() :: String.t()
  def topic, do: @topic

  @spec subscribe(keyword()) :: {:ok, term()} | {:error, term()}
  def subscribe(opts) do
    with {:ok, pid} <- GenServer.start(__MODULE__, opts) do
      id = Keyword.fetch!(opts, :subscription_id)

      {:ok, {:subscription, id, %{"subscription_id" => id}, fn -> safe_stop(pid) end, fn -> GenServer.cast(pid, :activate) end}}
    end
  end

  @impl true
  def init(opts) do
    connection_pid = Keyword.fetch!(opts, :connection_pid)
    :ok = Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, @topic)

    {:ok,
     %{
       connection_pid: connection_pid,
       connection_monitor: Process.monitor(connection_pid),
       subscription_id: Keyword.fetch!(opts, :subscription_id),
       host_id: Keyword.fetch!(opts, :host_id),
       active: false
     }}
  end

  @impl true
  def handle_cast(:activate, state) do
    emit(state, "notifications.ready", %{
      "type" => "ready",
      "subscriptionId" => state.subscription_id
    })

    {:noreply, %{state | active: true}}
  end

  @impl true
  def handle_info({:mobile_notification, kind, payload}, %{active: true} = state)
      when is_binary(kind) and is_map(payload) do
    event = %{
      "type" => "notification",
      "source" => "dev10x-host",
      "title" => value(payload, :title) || "Dev10x host",
      "body" => value(payload, :body) || "",
      "notificationId" => value(payload, :tag) || "#{kind}:#{System.unique_integer([:positive])}",
      "hostId" => state.host_id
    }

    emit(state, "notifications.notification", event)
    {:noreply, state}
  end

  def handle_info(
        {:DOWN, ref, :process, _pid, _reason},
        %{connection_monitor: ref} = state
      ),
      do: {:stop, :connection_closed, state}

  def handle_info(_message, state), do: {:noreply, state}

  defp emit(state, event, payload) do
    send(
      state.connection_pid,
      {:mobile_rpc_event, state.subscription_id, event, payload}
    )
  end

  defp value(payload, key), do: Map.get(payload, key) || Map.get(payload, to_string(key))

  defp safe_stop(pid) do
    if Process.alive?(pid), do: GenServer.stop(pid, :normal)
    :ok
  end
end
