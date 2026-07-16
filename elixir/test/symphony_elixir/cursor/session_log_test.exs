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

  describe "parse_line/1 and parse_entries/1" do
    test "parses cursor role-based assistant text entry" do
      line =
        Jason.encode!(%{
          "role" => "assistant",
          "message" => %{
            "content" => [%{"type" => "text", "text" => "cursor output"}]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "assistant"
      assert result["title"] == "Cursor Agent"
      assert result["body"] == "cursor output"
    end

    test "parses cursor role-based tool_use blocks without ids" do
      line =
        Jason.encode!(%{
          "role" => "assistant",
          "message" => %{
            "content" => [
              %{"type" => "text", "text" => "planning"},
              %{"type" => "tool_use", "name" => "Read", "input" => %{"path" => "AGENTS.md"}}
            ]
          }
        })

      entries = SessionLog.parse_entries(line)
      assert length(entries) == 2
      assert Enum.at(entries, 0)["kind"] == "assistant"
      assert Enum.at(entries, 1)["kind"] == "tool_call"
      assert Enum.at(entries, 1)["title"] == "Read"
      assert is_binary(Enum.at(entries, 1)["call_id"])
    end

    test "parses claude-style type entries as fallback" do
      line =
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [%{"type" => "text", "text" => "legacy output"}]
          }
        })

      result = SessionLog.parse_line(line)
      assert result["kind"] == "assistant"
      assert result["body"] == "legacy output"
    end

    test "returns nil for blank lines" do
      assert SessionLog.parse_line("") == nil
      assert SessionLog.parse_entries("") == []
    end
  end

  describe "resolve_log_path/2 prefers Symphony transcript" do
    test "returns .symphony/cursor-session.jsonl when present" do
      workspace = Path.join(System.tmp_dir!(), "cursor-sl-#{System.unique_integer([:positive])}")
      File.mkdir_p!(Path.join(workspace, ".symphony"))
      symphony = Path.join(workspace, ".symphony/cursor-session.jsonl")

      File.write!(
        symphony,
        ~s({"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}\n)
      )

      on_exit(fn -> File.rm_rf(workspace) end)

      assert {:ok, ^symphony} = SessionLog.resolve_log_path(workspace)
    end

    test "falls back to projects_dir when Symphony file missing" do
      workspace = Path.join(System.tmp_dir!(), "cursor-sl-fb-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      projects = Path.join(System.tmp_dir!(), "cursor-projects-#{System.unique_integer([:positive])}")
      encoded = SessionLog.encode_workspace(workspace)
      external_dir = Path.join([projects, encoded, "agent-transcripts"])
      File.mkdir_p!(external_dir)
      external = Path.join(external_dir, "chat.jsonl")
      File.write!(external, "{}\n")

      on_exit(fn ->
        File.rm_rf(workspace)
        File.rm_rf(projects)
      end)

      assert {:ok, ^external} = SessionLog.resolve_log_path(workspace, projects_dir: projects)
    end
  end
end
