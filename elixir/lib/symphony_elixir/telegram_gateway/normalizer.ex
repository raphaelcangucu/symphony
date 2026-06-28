defmodule SymphonyElixir.TelegramGateway.Normalizer do
  @moduledoc "Normalizes Telegram Bot API updates into provider-neutral gateway messages."

  alias SymphonyElixir.Gateways.InboundMessage

  @default_account_id "default"

  @spec normalize_update(map()) :: {:ok, InboundMessage.t()} | {:ignore, atom()} | {:error, atom()}
  def normalize_update(%{"message" => message}), do: normalize_message(message)
  def normalize_update(%{"edited_message" => message}), do: normalize_message(message)
  def normalize_update(_update), do: {:ignore, :unsupported_update}

  defp normalize_message(%{} = message) do
    with {:ok, raw_text} <- message_text(message),
         %{} = chat <- Map.get(message, "chat"),
         {:ok, chat_id} <- required_id(chat, "id"),
         {:ok, sender_id} <- sender_id(message) do
      chat_type = to_string(Map.get(chat, "type", ""))
      thread_id = optional_string(message["message_thread_id"])
      conversation_kind = conversation_kind(chat_type, thread_id)

      {:ok,
       %InboundMessage{
         provider: "telegram",
         account_id: @default_account_id,
         conversation_kind: conversation_kind,
         conversation_id: conversation_id(conversation_kind, chat_id, thread_id),
         parent_conversation_id: parent_conversation_id(conversation_kind, chat_id),
         thread_id: if(conversation_kind == "topic", do: thread_id),
         sender_id: sender_id,
         sender_name: sender_name(message["from"]),
         message_id: optional_string(message["message_id"]),
         reply_to_message_id: optional_string(get_in(message, ["reply_to_message", "message_id"])),
         raw_text: raw_text,
         metadata: metadata(chat, message)
       }}
    else
      {:error, :missing_text} -> {:ignore, :unsupported_update}
      {:error, reason} -> {:error, reason}
      _other -> {:ignore, :unsupported_update}
    end
  end

  defp normalize_message(_message), do: {:ignore, :unsupported_update}

  defp message_text(message) do
    text = Map.get(message, "text") || Map.get(message, "caption")

    case text do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_text}
          trimmed -> {:ok, trimmed}
        end

      _other ->
        {:error, :missing_text}
    end
  end

  defp required_id(map, key) do
    case Map.get(map, key) do
      nil -> {:error, :missing_id}
      value -> {:ok, to_string(value)}
    end
  end

  defp sender_id(%{"from" => %{"id" => id}}), do: {:ok, to_string(id)}
  defp sender_id(_message), do: {:error, :missing_sender}

  defp conversation_kind("private", _thread_id), do: "direct"
  defp conversation_kind(_chat_type, thread_id) when is_binary(thread_id), do: "topic"
  defp conversation_kind(_chat_type, _thread_id), do: "group"

  defp conversation_id("direct", chat_id, _thread_id), do: "dm:" <> chat_id
  defp conversation_id("topic", chat_id, thread_id), do: chat_id <> ":topic:" <> thread_id
  defp conversation_id("group", chat_id, _thread_id), do: chat_id

  defp parent_conversation_id("topic", chat_id), do: chat_id
  defp parent_conversation_id(_kind, _chat_id), do: nil

  defp sender_name(%{} = from) do
    first = from |> Map.get("first_name") |> optional_string()
    last = from |> Map.get("last_name") |> optional_string()
    username = from |> Map.get("username") |> optional_string()

    [first, last]
    |> Enum.reject(&is_nil/1)
    |> Enum.join(" ")
    |> case do
      "" -> username
      name -> name
    end
  end

  defp sender_name(_from), do: nil

  defp metadata(chat, message) do
    %{
      "telegram_chat_type" => Map.get(chat, "type"),
      "telegram_raw_chat_id" => optional_string(Map.get(chat, "id")),
      "telegram_message_thread_id" => optional_string(Map.get(message, "message_thread_id"))
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp optional_string(nil), do: nil
  defp optional_string(value), do: to_string(value)
end
