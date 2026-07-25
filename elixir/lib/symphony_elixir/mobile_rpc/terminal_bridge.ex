defmodule SymphonyElixir.MobileRpc.TerminalBridge do
  @moduledoc false

  alias SymphonyElixir.MobileRpc.SessionBridge
  alias SymphonyElixir.Terminal.Registry, as: TerminalRegistry

  @registry SymphonyElixir.MobileRpc.SessionRegistry
  @supervisor SymphonyElixir.MobileRpc.SessionSupervisor

  @spec subscribe(pid(), pos_integer(), String.t(), String.t()) ::
          {:ok, pid()} | {:ok, pid(), term()} | {:error, term()}
  def subscribe(connection_pid, thread_id, project_slug, subscription_id) do
    key = {connection_pid, {:terminal, thread_id}}

    case Registry.lookup(@registry, key) do
      [{_pid, _value}] ->
        {:error, :already_subscribed}

      [] ->
        DynamicSupervisor.start_child(
          @supervisor,
          {SessionBridge,
           [
             connection_pid: connection_pid,
             thread_id: thread_id,
             subscription_id: subscription_id,
             channel_module: SymphonyElixirWeb.TerminalChannel,
             topic: "terminal:thread:#{thread_id}",
             join_payload: %{"project_slug" => project_slug},
             event_prefix: "terminal",
             emit_joined: true,
             name: {:via, Registry, {@registry, key}}
           ]}
        )
    end
  end

  @spec lookup(pid(), pos_integer()) :: {:ok, pid()} | {:error, :not_found}
  def lookup(connection_pid, thread_id) do
    case Registry.lookup(@registry, {connection_pid, {:terminal, thread_id}}) do
      [{pid, _value}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @spec subscribe_handle(pid(), map(), String.t()) ::
          {:ok, pid()} | {:error, term()}
  def subscribe_handle(
        connection_pid,
        %{handle: handle, kind: kind, thread: thread} = target,
        subscription_id
      )
      when is_pid(connection_pid) and is_binary(handle) and is_binary(subscription_id) and
             kind in [:thread, :tab] do
    key = {connection_pid, {:orca_terminal, handle}}

    case Registry.lookup(@registry, key) do
      [{_pid, _value}] ->
        {:error, :already_subscribed}

      [] ->
        {topic, join_payload} = terminal_topic(target)

        DynamicSupervisor.start_child(
          @supervisor,
          {SessionBridge,
           [
             connection_pid: connection_pid,
             thread_id: thread.id,
             subscription_id: subscription_id,
             channel_module: SymphonyElixirWeb.TerminalChannel,
             topic: topic,
             join_payload: join_payload,
             event_prefix: "terminal",
             emit_joined: true,
             event_mapper: &map_terminal_event/3,
             name: {:via, Registry, {@registry, key}}
           ]}
        )
    end
  end

  defp terminal_topic(%{kind: :thread, thread: thread}) do
    {"terminal:thread:#{thread.id}", %{"project_slug" => thread.project_slug}}
  end

  defp terminal_topic(%{kind: :tab, thread: thread, tab_id: tab_id}) do
    {TerminalRegistry.tab_channel_topic(thread.project_slug, tab_id), %{}}
  end

  defp map_terminal_event("joined", payload, _previous) do
    output = get_in(payload, [:session, :output]) || get_in(payload, ["session", "output"]) || ""

    {"scrollback",
     %{
       "type" => "scrollback",
       "serialized" => output,
       "lines" => String.split(output, "\n"),
       "truncated" => false,
       "cols" => 80,
       "rows" => 24,
       "displayMode" => "auto"
     }, output}
  end

  defp map_terminal_event("output", payload, previous) do
    output = Map.get(payload, :data) || Map.get(payload, "data") || ""

    chunk =
      if is_binary(previous) and String.starts_with?(output, previous),
        do: String.replace_prefix(output, previous, ""),
        else: output

    {"data", %{"type" => "data", "chunk" => chunk}, output}
  end

  defp map_terminal_event("error", payload, previous) do
    message = Map.get(payload, :message) || Map.get(payload, "message") || "Terminal error"
    {"error", %{"type" => "error", "message" => message}, previous}
  end

  defp map_terminal_event(event, payload, previous), do: {event, payload, previous}
end
