defmodule SymphonyElixir.TelegramGateway.Sender do
  @moduledoc "Sends outbound Telegram messages for normalized gateway conversations."

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.Client

  @spec send_text(InboundMessage.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def send_text(%InboundMessage{} = message, text, opts \\ []) when is_binary(text) and is_list(opts) do
    payload =
      message
      |> base_payload()
      |> Map.put("text", text)

    call("sendMessage", payload, opts)
  end

  @spec send_typing(InboundMessage.t(), keyword()) :: :ok | {:error, term()}
  def send_typing(%InboundMessage{} = message, opts \\ []) when is_list(opts) do
    payload =
      message
      |> base_payload()
      |> Map.put("action", "typing")

    call("sendChatAction", payload, opts)
  end

  defp call(method, payload, opts) do
    send_fun = Keyword.get(opts, :send_fun, &Client.call/3)

    case invoke_send_fun(send_fun, method, payload, opts) do
      {:ok, _response} -> :ok
      :ok -> :ok
      {:error, reason} -> {:error, reason}
      other -> {:error, {:unexpected_send_result, other}}
    end
  end

  defp invoke_send_fun(fun, method, payload, _opts) when is_function(fun, 2), do: fun.(method, payload)
  defp invoke_send_fun(fun, method, payload, opts) when is_function(fun, 3), do: fun.(method, payload, opts)

  defp base_payload(%InboundMessage{conversation_kind: "topic", parent_conversation_id: chat_id, thread_id: thread_id}) do
    %{
      "chat_id" => chat_id,
      "message_thread_id" => parse_thread_id!(thread_id)
    }
  end

  defp base_payload(%InboundMessage{conversation_kind: "direct", conversation_id: "dm:" <> chat_id}) do
    %{"chat_id" => chat_id}
  end

  defp base_payload(%InboundMessage{conversation_id: conversation_id}) do
    %{"chat_id" => conversation_id}
  end

  defp parse_thread_id!(thread_id) when is_binary(thread_id) do
    case Integer.parse(thread_id) do
      {value, ""} -> value
      _other -> raise ArgumentError, "invalid Telegram message_thread_id: #{inspect(thread_id)}"
    end
  end
end
