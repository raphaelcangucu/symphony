defmodule SymphonyElixir.Codex.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Codex.SessionLog

  test "parse_line renders structured assistant and tool entries" do
    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"**Done**"}]}})) == %{
             "kind" => "assistant",
             "title" => "Codex",
             "body" => "**Done**",
             "language" => "markdown",
             "status" => nil,
             "collapsed" => false
           }

    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}"}}))["kind"] == "tool_call"

    assert SessionLog.parse_line(~s({"type":"response_item","payload":{"type":"function_call_output","output":"ok\\nline"}}))["kind"] == "tool_result"
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
end
