defmodule SymphonyElixir.Codex.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Codex.SessionLog

  test "parse_line renders turn_aborted with reason and duration" do
    payload =
      ~s({"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-1","reason":"interrupted","duration_ms":5073697}})

    assert SessionLog.parse_line(payload) == %{
             "kind" => "event",
             "title" => "Turn aborted",
             "body" => "Reason: interrupted\nTurn: turn-1\nDuration: 1h 24m 33s",
             "language" => "text",
             "status" => "failed",
             "collapsed" => false,
             "call_id" => nil
           }
  end

  test "parse_line renders structured assistant and tool entries" do
    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"**Done**"}]}})) == %{
             "kind" => "assistant",
             "title" => "Codex",
             "body" => "**Done**",
             "language" => "markdown",
             "status" => nil,
             "collapsed" => false,
             "call_id" => nil
           }

    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}"}}))["kind"] == "tool_call"

    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call_output","output":"ok\\nline"}}))["kind"] == "tool_result"
  end

  test "parse_line collapses Symphony-injected plan gates as system activity" do
    line =
      Jason.encode!(%{
        "type" => "response_item",
        "payload" => %{
          "type" => "message",
          "role" => "user",
          "content" => [
            %{
              "type" => "input_text",
              "text" => "## Plan gate failed (Symphony)\n\nThe issue is missing a valid workpad."
            }
          ]
        }
      })

    assert SessionLog.parse_line(line) == %{
             "kind" => "system",
             "title" => "Plan gate failed",
             "body" => "The issue is missing a valid workpad.",
             "language" => "text",
             "status" => nil,
             "collapsed" => true,
             "call_id" => nil
           }
  end

  test "parse_line threads call_id through tool entries for pairing" do
    call =
      SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}","call_id":"call_1"}}))

    output =
      SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call_output","output":"ok","call_id":"call_1"}}))

    assert call["call_id"] == "call_1"
    assert call["language"] == "bash"
    assert output["call_id"] == "call_1"
  end

  test "parse_line tolerates tool entries without call_id" do
    call =
      SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}"}}))

    assert call["call_id"] == nil
    assert call["kind"] == "tool_call"
  end

  test "tail and read_from stream appended entries" do
    path = Path.join(System.tmp_dir!(), "session-log-#{System.unique_integer()}.jsonl")

    lines = [
      ~s({"type":"event_msg","payload":{"type":"info","message":"first"}}),
      ~s({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}})
    ]

    File.write!(path, Enum.join(lines, "\n") <> "\n")

    on_exit(fn -> File.rm(path) end)

    assert {:ok, tailed, offset} = SessionLog.tail(path, max_bytes: 4096)
    assert length(tailed) == 2
    assert offset > 0

    extra =
      ~s({"type":"response_item","payload":{"type":"reasoning","summary":[],"content":null}})

    File.write!(path, extra <> "\n", [:append])

    assert {:ok, appended, new_offset} = SessionLog.read_from(path, offset)
    assert new_offset > offset
    assert Enum.any?(appended, &(&1["kind"] == "reasoning"))
  end

  test "update_plan tool call keeps the full plan JSON in the entry body" do
    line =
      Jason.encode!(%{
        "type" => "response_item",
        "payload" => %{
          "type" => "function_call",
          "name" => "update_plan",
          "call_id" => "call_1",
          "arguments" =>
            Jason.encode!(%{
              "explanation" => "Starting",
              "plan" => [
                %{"step" => "Write tests", "status" => "completed"},
                %{"step" => "Implement", "status" => "in_progress"}
              ]
            })
        }
      })

    entry = SessionLog.parse_line(line)

    assert entry["kind"] == "tool_call"
    assert entry["title"] == "update_plan"
    assert entry["body"] =~ "\"plan\""
    assert entry["body"] =~ "Write tests"
    assert entry["body"] =~ "in_progress"
  end
end
