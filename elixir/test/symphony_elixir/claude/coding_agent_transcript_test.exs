defmodule SymphonyElixir.Claude.CodingAgentTranscriptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.CodingAgent

  test "maps tool_call item/created to :tool_call_started" do
    notification = %{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_call",
          "tool_use_id" => "tc1",
          "name" => "Shell",
          "input" => %{"command" => "ls"}
        }
      }
    }

    assert {:tool_call_started, details} = CodingAgent.bridge_event_to_message(notification)
    assert details.payload == notification
    assert is_binary(details.raw)
  end

  test "maps tool_result item/created to :tool_call_completed" do
    notification = %{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_result",
          "tool_use_id" => "tc1",
          "content" => "ok",
          "is_error" => false
        }
      }
    }

    assert {:tool_call_completed, _} = CodingAgent.bridge_event_to_message(notification)
  end

  test "maps tool_result errors to :tool_call_failed" do
    notification = %{
      "method" => "item/created",
      "params" => %{"item" => %{"type" => "tool_result", "tool_use_id" => "tc1", "is_error" => true}}
    }

    assert {:tool_call_failed, _} = CodingAgent.bridge_event_to_message(notification)
  end

  test "maps progress and text to :notification" do
    progress = %{"method" => "item/progress", "params" => %{"delta" => %{"type" => "text", "text" => "x"}}}
    assert {:notification, _} = CodingAgent.bridge_event_to_message(progress)

    text = %{
      "method" => "item/created",
      "params" => %{"item" => %{"type" => "text", "text" => "hello"}}
    }

    assert {:notification, _} = CodingAgent.bridge_event_to_message(text)
  end
end
