defmodule SymphonyElixir.Claude.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.SessionLog

  describe "encode_workspace/1" do
    test "encodes absolute path by replacing slashes with dashes" do
      assert SessionLog.encode_workspace("/home/foo/bar") == "-home-foo-bar"
    end

    test "encodes nested workspace paths" do
      assert SessionLog.encode_workspace("/home/luiz/code/gamba-workspaces/GambaLabs/frontend/1859") ==
               "-home-luiz-code-gamba-workspaces-GambaLabs-frontend-1859"
    end

    test "handles paths without trailing slash" do
      assert SessionLog.encode_workspace("/tmp/ws") == "-tmp-ws"
    end
  end

  describe "parse_line/1" do
    test "parses assistant text block as assistant entry" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{"type" => "text", "text" => "**Done**"}
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "assistant"
      assert result["title"] == "Claude Code"
      assert result["body"] == "**Done**"
      assert result["language"] == "markdown"
      assert result["collapsed"] == false
    end

    test "parses tool_use block as tool_call entry" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{
                "type" => "tool_use",
                "id" => "toolu_123",
                "name" => "Bash",
                "input" => %{"command" => "pwd"}
              }
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "tool_call"
      assert result["title"] == "Bash"
      assert result["call_id"] == "toolu_123"
      assert result["language"] == "bash"
      assert result["status"] == "running"
    end

    test "parses tool_result block as tool_result entry with call_id" do
      line =
        Jason.encode!(%{
          "type" => "user",
          "message" => %{
            "content" => [
              %{
                "type" => "tool_result",
                "tool_use_id" => "toolu_123",
                "content" => [%{"type" => "text", "text" => "output text"}]
              }
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "tool_result"
      assert result["call_id"] == "toolu_123"
      assert result["status"] == "completed"
      assert result["body"] == "output text"
    end

    test "parses thinking block as reasoning entry (collapsed)" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{"type" => "thinking", "thinking" => "Let me reason through this."}
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "reasoning"
      assert result["collapsed"] == true
    end

    test "returns nil for blank lines" do
      assert SessionLog.parse_line("") == nil
      assert SessionLog.parse_line("   ") == nil
    end

    test "returns nil for invalid JSON" do
      assert SessionLog.parse_line("not json") == nil
    end

    test "parses queue-operation type as event entry" do
      line = Jason.encode!(%{"type" => "queue-operation"})
      result = SessionLog.parse_line(line)
      assert result["kind"] == "event"
    end

    test "TodoWrite tool use keeps the todos JSON in the entry body" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{
                "type" => "tool_use",
                "id" => "toolu_1",
                "name" => "TodoWrite",
                "input" => %{
                  "todos" => [
                    %{"content" => "Set up DB", "status" => "completed", "activeForm" => "Setting up DB"},
                    %{"content" => "Wire API", "status" => "in_progress", "activeForm" => "Wiring API"}
                  ]
                }
              }
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "tool_call"
      assert result["title"] == "TodoWrite"
      assert result["body"] =~ "\"todos\""
      assert result["body"] =~ "Wire API"
    end

    test "TaskCreate tool use keeps the subject JSON in the entry body" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{"type" => "tool_use", "id" => "toolu_2", "name" => "TaskCreate", "input" => %{"subject" => "Set up DB"}}
            ]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "tool_call"
      assert result["title"] == "TaskCreate"
      assert result["body"] =~ "Set up DB"
    end
  end

  describe "tail/2 and read_from/2" do
    test "streams entries from a temp JSONL file" do
      path = Path.join(System.tmp_dir!(), "claude-session-log-#{System.unique_integer()}.jsonl")

      lines = [
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{"content" => [%{"type" => "text", "text" => "hello"}]}
        }),
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{"type" => "tool_use", "id" => "toolu_1", "name" => "Bash", "input" => %{"command" => "ls"}}
            ]
          }
        })
      ]

      File.write!(path, Enum.join(lines, "\n") <> "\n")
      on_exit(fn -> File.rm(path) end)

      assert {:ok, tailed, offset} = SessionLog.tail(path, max_bytes: 4096)
      assert length(tailed) == 2
      assert offset > 0

      extra =
        Jason.encode!(%{
          "type" => "user",
          "message" => %{
            "content" => [
              %{"type" => "tool_result", "tool_use_id" => "toolu_1", "content" => [%{"type" => "text", "text" => "ok"}]}
            ]
          }
        })

      File.write!(path, extra <> "\n", [:append])

      assert {:ok, appended, new_offset} = SessionLog.read_from(path, offset)
      assert new_offset > offset
      assert Enum.any?(appended, &(&1["kind"] == "tool_result"))
    end
  end
end
