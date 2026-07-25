defmodule SymphonyElixir.MobileRpc.SessionBridge do
  @moduledoc """
  Connection-scoped owner for the existing AssistantChannel state machine.

  It lets encrypted mobile RPC reuse the same history, turn, approval and
  question behavior as Phoenix clients without exposing the tracker bearer
  token to the device.
  """

  use GenServer, restart: :temporary

  alias Phoenix.Socket
  alias SymphonyElixir.MobileRpc.SessionSerializer

  @registry SymphonyElixir.MobileRpc.SessionRegistry
  @supervisor SymphonyElixir.MobileRpc.SessionSupervisor

  defstruct connection_pid: nil,
            connection_monitor: nil,
            subscription_id: nil,
            event_prefix: "sessions",
            channel_module: nil,
            socket: nil,
            active: false,
            pending: []

  @type option ::
          {:connection_pid, pid()}
          | {:thread_id, pos_integer()}
          | {:subscription_id, String.t()}
          | {:channel_module, module()}
          | {:name, GenServer.name()}

  @spec start_link([option()]) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  end

  @spec subscribe(pid(), pos_integer(), String.t()) :: {:ok, pid()} | {:error, term()}
  def subscribe(connection_pid, thread_id, subscription_id)
      when is_pid(connection_pid) and is_integer(thread_id) and thread_id > 0 and
             is_binary(subscription_id) do
    key = {connection_pid, thread_id}

    case Registry.lookup(@registry, key) do
      [{_pid, _value}] ->
        {:error, :already_subscribed}

      [] ->
        opts = [
          connection_pid: connection_pid,
          thread_id: thread_id,
          subscription_id: subscription_id,
          name: {:via, Registry, {@registry, key}}
        ]

        DynamicSupervisor.start_child(@supervisor, {__MODULE__, opts})
    end
  end

  @spec lookup(pid(), pos_integer()) :: {:ok, pid()} | {:error, :not_found}
  def lookup(connection_pid, thread_id) do
    case Registry.lookup(@registry, {connection_pid, thread_id}) do
      [{pid, _value}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @spec activate(pid()) :: :ok
  def activate(pid), do: GenServer.cast(pid, :activate)

  @spec command(pid(), String.t(), map()) :: :ok | {:ok, term()} | {:error, term()}
  def command(pid, event, payload)
      when is_pid(pid) and is_binary(event) and is_map(payload) do
    GenServer.call(pid, {:command, event, payload}, 30_000)
  end

  @impl true
  def init(opts) do
    connection_pid = Keyword.fetch!(opts, :connection_pid)
    thread_id = Keyword.fetch!(opts, :thread_id)
    subscription_id = Keyword.fetch!(opts, :subscription_id)
    channel_module = Keyword.get(opts, :channel_module, SymphonyElixirWeb.AssistantChannel)
    topic = Keyword.get(opts, :topic, "assistant:thread:#{thread_id}")
    join_payload = Keyword.get(opts, :join_payload, %{})
    event_prefix = Keyword.get(opts, :event_prefix, "sessions")
    socket = channel_socket(channel_module, topic)

    case channel_module.join(topic, join_payload, socket) do
      {:ok, joined_payload, joined_socket} ->
        pending =
          if Keyword.get(opts, :emit_joined, false),
            do: [{"joined", joined_payload}],
            else: []

        {:ok,
         %__MODULE__{
           connection_pid: connection_pid,
           connection_monitor: Process.monitor(connection_pid),
           subscription_id: subscription_id,
           event_prefix: event_prefix,
           channel_module: channel_module,
           socket: joined_socket,
           pending: pending
         }}

      {:error, reason} ->
        {:stop, {:join_failed, reason}}
    end
  end

  @impl true
  def handle_cast(:activate, state) do
    Enum.each(Enum.reverse(state.pending), fn {event, payload} ->
      emit(state, event, payload)
    end)

    {:noreply, %{state | active: true, pending: []}}
  end

  @impl true
  def handle_call({:command, event, payload}, _from, state) do
    socket = %{state.socket | ref: Integer.to_string(System.unique_integer([:positive]))}

    case state.channel_module.handle_in(event, payload, socket) do
      {:reply, :ok, next_socket} ->
        {:reply, :ok, %{state | socket: next_socket}}

      {:reply, {:ok, result}, next_socket} ->
        {:reply, {:ok, result}, %{state | socket: next_socket}}

      {:reply, {:error, reason}, next_socket} ->
        {:reply, {:error, reason}, %{state | socket: next_socket}}

      {:noreply, next_socket} ->
        {:reply, :ok, %{state | socket: next_socket}}

      {:stop, reason, next_socket} ->
        {:stop, reason, {:error, reason}, %{state | socket: next_socket}}
    end
  rescue
    _error -> {:reply, {:error, :command_failed}, state}
  end

  @impl true
  def handle_info({:mobile_assistant_push, event, payload}, state) do
    if state.active do
      emit(state, event, payload)
      {:noreply, state}
    else
      {:noreply, %{state | pending: [{event, payload} | state.pending]}}
    end
  end

  def handle_info({:mobile_assistant_reply, _ref, _status, _payload}, state),
    do: {:noreply, state}

  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{connection_monitor: ref} = state),
    do: {:stop, :connection_closed, state}

  def handle_info(message, state) do
    case state.channel_module.handle_info(message, state.socket) do
      {:noreply, next_socket} ->
        {:noreply, %{state | socket: next_socket}}

      {:stop, reason, next_socket} ->
        {:stop, reason, %{state | socket: next_socket}}
    end
  rescue
    _error -> {:noreply, state}
  end

  @impl true
  def terminate(reason, state) do
    if function_exported?(state.channel_module, :terminate, 2) do
      state.channel_module.terminate(reason, state.socket)
    end

    :ok
  end

  defp channel_socket(channel_module, topic) do
    %Socket{
      assigns: %{tracker_token_valid: true},
      channel: channel_module,
      channel_pid: self(),
      endpoint: SymphonyElixirWeb.Endpoint,
      handler: SymphonyElixirWeb.UserSocket,
      joined: true,
      join_ref: "mobile-rpc",
      pubsub_server: SymphonyElixir.PubSub,
      ref: "mobile-rpc",
      serializer: SessionSerializer,
      topic: topic,
      transport: :mobile_rpc,
      transport_pid: self()
    }
  end

  defp emit(state, event, payload) do
    send(
      state.connection_pid,
      {:mobile_rpc_event, state.subscription_id, "#{state.event_prefix}.#{event}", payload}
    )
  end
end
