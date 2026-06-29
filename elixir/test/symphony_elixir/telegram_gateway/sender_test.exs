defmodule SymphonyElixir.TelegramGateway.SenderTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.Sender

  test "sends topic replies with message_thread_id" do
    message = %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "topic",
      conversation_id: "-100123:topic:42",
      parent_conversation_id: "-100123",
      thread_id: "42",
      sender_id: "777",
      raw_text: "hello"
    }

    send_fun = fn method, payload ->
      assert method == "sendMessage"
      assert payload["chat_id"] == "-100123"
      assert payload["message_thread_id"] == 42
      assert payload["text"] == "reply"
      {:ok, %{"ok" => true}}
    end

    assert :ok = Sender.send_text(message, "reply", send_fun: send_fun)
  end

  test "sends direct replies without message_thread_id" do
    message = %InboundMessage{
      provider: "telegram",
      account_id: "default",
      conversation_kind: "direct",
      conversation_id: "dm:777",
      sender_id: "777",
      raw_text: "hello"
    }

    send_fun = fn _method, payload ->
      refute Map.has_key?(payload, "message_thread_id")
      assert payload["chat_id"] == "777"
      {:ok, %{"ok" => true}}
    end

    assert :ok = Sender.send_text(message, "reply", send_fun: send_fun)
  end
end
