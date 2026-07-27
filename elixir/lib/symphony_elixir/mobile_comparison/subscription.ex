defmodule SymphonyElixir.MobileComparison.Subscription do
  @moduledoc """
  Connection-owned live snapshot bridge for one Dev10x comparison.

  The bridge listens to the existing tracker, assistant, orchestrator, preview,
  and evidence notification topics. Bursts are coalesced before the durable
  comparison aggregate is read again.
  """

  use GenServer, restart: :temporary

  alias SymphonyElixir.Assistant.GoalRun
  alias SymphonyElixir.DevServer.Broadcaster, as: DevServerBroadcaster
  alias SymphonyElixir.LocalTracker.Broadcaster, as: TrackerBroadcaster
  alias SymphonyElixir.MobileComparison.EventBus
  alias SymphonyElixir.MobileRpc.{ComparisonService, NotificationSubscription}

  defstruct connection_pid: nil,
            connection_monitor: nil,
            subscription_id: nil,
            params: %{},
            context: %{},
            service: nil,
            event_bus: nil,
            coalesce_ms: 100,
            refresh_timer: nil,
            active: false,
            snapshot: nil,
            digest: nil,
            topics: MapSet.new()

  @spec subscribe(pid(), map(), map()) :: GenServer.on_start()
  def subscribe(connection_pid, params, context)
      when is_pid(connection_pid) and is_map(params) and is_map(context) do
    GenServer.start(__MODULE__, {connection_pid, params, context})
  end

  @spec activate(pid()) :: :ok
  def activate(pid) when is_pid(pid) do
    GenServer.cast(pid, :activate)
    :ok
  end

  @spec stop(pid()) :: :ok
  def stop(pid) when is_pid(pid) do
    if Process.alive?(pid), do: GenServer.stop(pid, :normal)
    :ok
  end

  @impl true
  def init({connection_pid, params, context}) do
    service = Map.get(context, :mobile_comparison_service, ComparisonService)
    event_bus = Map.get(context, :comparison_event_bus, EventBus)

    with subscription_id when is_binary(subscription_id) <-
           Map.get(context, :comparison_subscription_id),
         {:ok, snapshot} <- service.call("comparisons.get", params, context) do
      state = %__MODULE__{
        connection_pid: connection_pid,
        connection_monitor: Process.monitor(connection_pid),
        subscription_id: subscription_id,
        params: params,
        context: context,
        service: service,
        event_bus: event_bus,
        coalesce_ms: Map.get(context, :comparison_coalesce_ms, 100),
        snapshot: snapshot,
        digest: digest(snapshot)
      }

      case subscribe_topics(state, snapshot) do
        {:ok, subscribed} -> {:ok, subscribed}
        {:error, reason} -> {:stop, reason}
      end
    else
      {:error, reason} -> {:stop, reason}
      _invalid -> {:stop, :invalid_subscription}
    end
  end

  @impl true
  def handle_cast(:activate, %{active: false} = state) do
    emit(state, state.snapshot)
    {:noreply, %{state | active: true}}
  end

  def handle_cast(:activate, state), do: {:noreply, state}

  @impl true
  def handle_info(
        {:DOWN, ref, :process, _pid, _reason},
        %{connection_monitor: ref} = state
      ),
      do: {:stop, :connection_closed, state}

  def handle_info(:refresh, state) do
    next = %{state | refresh_timer: nil}

    case next.service.call("comparisons.get", next.params, next.context) do
      {:ok, snapshot} ->
        with {:ok, subscribed} <- subscribe_topics(next, snapshot) do
          next_digest = digest(snapshot)

          if subscribed.active and next_digest != subscribed.digest do
            emit(subscribed, snapshot)
          end

          {:noreply,
           %{subscribed | snapshot: snapshot, digest: next_digest}}
        else
          {:error, _reason} -> {:noreply, next}
        end

      {:error, _reason} ->
        {:noreply, next}
    end
  end

  def handle_info(message, state) do
    if relevant_event?(message) do
      {:noreply, schedule_refresh(state)}
    else
      {:noreply, state}
    end
  end

  defp subscribe_topics(state, snapshot) do
    snapshot
    |> topics(state.params)
    |> Enum.reduce_while({:ok, state}, fn topic, {:ok, current} ->
      if MapSet.member?(current.topics, topic) do
        {:cont, {:ok, current}}
      else
        case current.event_bus.subscribe(topic, current.context) do
          :ok ->
            {:cont, {:ok, %{current | topics: MapSet.put(current.topics, topic)}}}

          {:error, reason} ->
            {:halt, {:error, reason}}
        end
      end
    end)
  end

  defp topics(snapshot, params) do
    project_slug = params["project_slug"]

    base = [
      TrackerBroadcaster.topic(project_slug),
      "agent_executions",
      NotificationSubscription.topic()
    ]

    dynamic =
      snapshot
      |> Map.get("cells", [])
      |> Enum.flat_map(fn cell ->
        thread_topics(cell) ++ preview_topics(project_slug, cell)
      end)

    Enum.uniq(base ++ dynamic)
  end

  defp thread_topics(%{"thread_id" => thread_id}) when is_integer(thread_id),
    do: [GoalRun.topic(thread_id)]

  defp thread_topics(_cell), do: []

  defp preview_topics(project_slug, %{"issue_identifier" => identifier})
       when is_binary(identifier) and identifier != "",
       do: [DevServerBroadcaster.topic(project_slug, identifier)]

  defp preview_topics(_project_slug, _cell), do: []

  defp relevant_event?({:tracker_event, _event, _payload}), do: true
  defp relevant_event?({:agent_execution_event, _event, _payload}), do: true
  defp relevant_event?({:goal_run_started}), do: true
  defp relevant_event?({:goal_run_finished, _message}), do: true
  defp relevant_event?({:turn_stream, _event, _payload}), do: true
  defp relevant_event?({:authoring_goal_changed, _status}), do: true
  defp relevant_event?({:dev_server_update, _payload}), do: true
  defp relevant_event?({:mobile_notification, "evidence", _payload}), do: true
  defp relevant_event?(_message), do: false

  defp schedule_refresh(%{refresh_timer: nil} = state) do
    timer = Process.send_after(self(), :refresh, state.coalesce_ms)
    %{state | refresh_timer: timer}
  end

  defp schedule_refresh(state), do: state

  defp emit(state, snapshot) do
    send(
      state.connection_pid,
      {:mobile_rpc_event, state.subscription_id, "comparisons.snapshot", snapshot}
    )
  end

  defp digest(snapshot), do: :erlang.phash2(snapshot)
end
