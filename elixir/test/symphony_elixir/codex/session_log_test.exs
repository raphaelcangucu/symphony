defmodule SymphonyElixir.Codex.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Codex.SessionLog

  test "format_line renders response items and event messages" do
    assert SessionLog.format_line(
             ~s({"type":"event_msg","payload":{"type":"agent_message","message":"hello"}})
           ) == "agent_message: hello"

    assert SessionLog.format_line(
             ~s({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}})
           ) == "message/assistant: done"
  end

  test "tail and read_from stream appended lines" do
    path = Path.join(System.tmp_dir!(), "session-log-#{System.unique_integer()}.jsonl")

    lines = [
      ~s({"type":"event_msg","payload":{"type":"info","message":"first"}}),
      ~s({"type":"event_msg","payload":{"type":"info","message":"second"}})
    ]

    File.write!(path, Enum.join(lines, "\n") <> "\n")

    on_exit(fn -> File.rm(path) end)

    assert {:ok, tailed, offset} = SessionLog.tail(path, max_bytes: 4096)
    assert Enum.any?(tailed, &String.contains?(&1, "first"))
    assert offset > 0

    extra = ~s({"type":"event_msg","payload":{"type":"info","message":"third"}})
    File.write!(path, extra <> "\n", [:append])

    assert {:ok, appended, new_offset} = SessionLog.read_from(path, offset)
    assert new_offset > offset
    assert Enum.any?(appended, &String.contains?(&1, "third"))
  end
end
