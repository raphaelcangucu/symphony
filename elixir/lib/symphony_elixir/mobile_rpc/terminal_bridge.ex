defmodule SymphonyElixir.MobileRpc.TerminalBridge do
  @moduledoc false

  alias SymphonyElixir.MobileRpc.SessionBridge

  @registry SymphonyElixir.MobileRpc.SessionRegistry
  @supervisor SymphonyElixir.MobileRpc.SessionSupervisor

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

  def lookup(connection_pid, thread_id) do
    case Registry.lookup(@registry, {connection_pid, {:terminal, thread_id}}) do
      [{pid, _value}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end
end
