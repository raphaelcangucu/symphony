defmodule SymphonyElixir.Cursor.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.SessionLog

  describe "encode_workspace/1" do
    test "strips leading slash before replacing separators" do
      assert SessionLog.encode_workspace("/home/foo/bar") == "home-foo-bar"
    end

    test "encodes nested workspace paths" do
      assert SessionLog.encode_workspace("/home/luiz/Documents/work-ai/symphony") ==
               "home-luiz-Documents-work-ai-symphony"
    end

    test "handles root-level path" do
      assert SessionLog.encode_workspace("/tmp") == "tmp"
    end
  end

  describe "parse_line/1 delegates to Claude.SessionLog" do
    test "parses assistant text entry" do
      line = Jason.encode!(%{
        "type" => "assistant",
        "message" => %{
          "content" => [%{"type" => "text", "text" => "cursor output"}]
        }
      })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "assistant"
      assert result["body"] == "cursor output"
    end

    test "returns nil for blank lines" do
      assert SessionLog.parse_line("") == nil
    end
  end
end
