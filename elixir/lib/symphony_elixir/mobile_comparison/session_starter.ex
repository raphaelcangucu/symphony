defmodule SymphonyElixir.MobileComparison.SessionStarter do
  @moduledoc """
  Starts one assistant issue-session turn through the existing channel state
  machine without creating a second long-lived mobile subscription.
  """

  alias SymphonyElixir.MobileRpc.SessionBridge

  @spec start(map(), String.t(), map()) :: :ok | {:error, term()}
  def start(thread, prompt, context)
      when is_map(thread) and is_binary(prompt) and is_map(context) do
    with thread_id when is_integer(thread_id) and thread_id > 0 <- value(thread, :id),
         connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
         bridge_module <- Map.get(context, :comparison_session_bridge, SessionBridge),
         {:ok, bridge} <-
           bridge_module.start_link(
             connection_pid: connection_pid,
             thread_id: thread_id,
             subscription_id: subscription_id(thread_id)
           ) do
      try do
        payload = %{
          "message" => prompt,
          "client_message_id" => client_message_id(context, thread_id),
          "context" => turn_context(thread)
        }

        case bridge_module.command(bridge, "send_message", payload) do
          :ok -> :ok
          {:ok, _payload} -> :ok
          {:error, reason} -> {:error, reason}
        end
      after
        if Process.alive?(bridge), do: GenServer.stop(bridge, :normal)
      end
    else
      _reason -> {:error, :comparison_session_start_failed}
    end
  end

  def start(_thread, _prompt, _context),
    do: {:error, :comparison_session_start_failed}

  defp subscription_id(thread_id) do
    "comparison:start:#{thread_id}:" <>
      Integer.to_string(System.unique_integer([:positive, :monotonic]))
  end

  defp client_message_id(context, thread_id),
    do: "#{Map.fetch!(context, :comparison_request_key)}:#{thread_id}:initial"

  defp turn_context(thread) do
    %{}
    |> maybe_put("agent", value(thread, :agent_kind))
    |> maybe_put("model", value(thread, :requested_model))
    |> maybe_put("effort", value(thread, :requested_effort))
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end
