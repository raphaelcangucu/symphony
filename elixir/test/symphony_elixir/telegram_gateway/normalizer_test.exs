defmodule SymphonyElixir.TelegramGateway.NormalizerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.InboundMessage
  alias SymphonyElixir.TelegramGateway.Normalizer

  test "normalizes forum topic messages" do
    update = %{
      "message" => %{
        "message_id" => 10,
        "message_thread_id" => 42,
        "text" => "hello",
        "chat" => %{"id" => -100_123, "type" => "supergroup", "is_forum" => true},
        "from" => %{"id" => 777, "first_name" => "Raphael"}
      }
    }

    assert {:ok, %InboundMessage{} = message} = Normalizer.normalize_update(update)
    assert message.conversation_kind == "topic"
    assert message.conversation_id == "-100123:topic:42"
    assert message.parent_conversation_id == "-100123"
    assert message.thread_id == "42"
    assert message.sender_id == "777"
  end

  test "normalizes direct messages as freeform conversations" do
    update = %{
      "message" => %{
        "message_id" => 11,
        "text" => "free chat",
        "chat" => %{"id" => 777, "type" => "private"},
        "from" => %{"id" => 777, "username" => "rc"}
      }
    }

    assert {:ok, message} = Normalizer.normalize_update(update)
    assert message.conversation_kind == "direct"
    assert message.conversation_id == "dm:777"
    assert message.thread_id == nil
  end

  test "normalizes voice messages using transcription" do
    update = %{
      "message" => %{
        "message_id" => 12,
        "voice" => %{"file_id" => "voice-file-1", "mime_type" => "audio/ogg"},
        "chat" => %{"id" => 777, "type" => "private"},
        "from" => %{"id" => 777, "username" => "rc"}
      }
    }

    transcriber = fn message ->
      assert get_in(message, ["voice", "file_id"]) == "voice-file-1"
      {:ok, "áudio transcrito"}
    end

    assert {:ok, message} = Normalizer.normalize_update(update, audio_transcriber: transcriber)
    assert message.raw_text == "áudio transcrito"
    assert message.metadata["telegram_audio_kind"] == "voice"
    assert message.metadata["telegram_audio_file_id"] == "voice-file-1"
    assert message.metadata["telegram_audio_transcribed"] == true
  end

  test "turns audio transcription failures into an explanatory text message" do
    update = %{
      "message" => %{
        "message_id" => 13,
        "audio" => %{"file_id" => "audio-file-1", "mime_type" => "audio/mpeg"},
        "chat" => %{"id" => 777, "type" => "private"},
        "from" => %{"id" => 777}
      }
    }

    assert {:ok, message} =
             Normalizer.normalize_update(update, audio_transcriber: fn _message -> {:error, :openai_api_key_missing} end)

    assert message.raw_text =~ "could not transcribe"
    assert message.metadata["telegram_audio_transcribed"] == false
  end

  test "ignores messages without usable text" do
    assert {:ignore, :unsupported_update} = Normalizer.normalize_update(%{"message" => %{"photo" => []}})
  end
end
