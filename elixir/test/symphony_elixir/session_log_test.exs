defmodule SymphonyElixir.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog
  alias SymphonyElixir.SessionLog

  test "resolve_log_source/3 prefers the requested agent over another agent's existing log" do
    workspace = Path.join(System.tmp_dir!(), "session-log-preferred-#{System.unique_integer()}")

    claude_root = Path.join(System.tmp_dir!(), "claude-projects-#{System.unique_integer()}")
    cursor_root = Path.join(System.tmp_dir!(), "cursor-projects-#{System.unique_integer()}")

    claude_dir = Path.join(claude_root, ClaudeLog.encode_workspace(workspace))

    cursor_dir =
      Path.join([cursor_root, CursorLog.encode_workspace(workspace), "agent-transcripts", "session"])

    File.mkdir_p!(claude_dir)
    File.mkdir_p!(cursor_dir)

    claude_path = Path.join(claude_dir, "session.jsonl")
    cursor_path = Path.join(cursor_dir, "session.jsonl")

    write_assistant_line!(claude_path, "claude history")
    write_assistant_line!(cursor_path, "cursor history")

    on_exit(fn ->
      File.rm_rf(workspace)
      File.rm_rf(claude_root)
      File.rm_rf(cursor_root)
    end)

    # When the operator is viewing the cursor agent, the cursor log wins even
    # though a (possibly stale) claude log also exists for the same workspace.
    assert {:ok, "cursor", ^cursor_path} =
             SessionLog.resolve_log_source("cursor", workspace, projects_dir: cursor_root)

    assert {:ok, "claude", ^claude_path} =
             SessionLog.resolve_log_source("claude", workspace, projects_dir: claude_root)
  end

  defp write_assistant_line!(path, text) do
    File.write!(
      path,
      Jason.encode!(%{
        "type" => "assistant",
        "message" => %{"content" => [%{"type" => "text", "text" => text}]}
      }) <> "\n"
    )
  end

  test "resolve_log_source/3 falls back to another agent when preferred has no log" do
    workspace = Path.join(System.tmp_dir!(), "session-log-fallback-#{System.unique_integer()}")

    claude_dir =
      Path.join([
        System.tmp_dir!(),
        "claude-projects-#{System.unique_integer()}",
        ClaudeLog.encode_workspace(workspace)
      ])

    File.mkdir_p!(claude_dir)

    path = Path.join(claude_dir, "session.jsonl")

    File.write!(
      path,
      Jason.encode!(%{
        "type" => "assistant",
        "message" => %{"content" => [%{"type" => "text", "text" => "prior work"}]}
      }) <> "\n"
    )

    on_exit(fn ->
      File.rm_rf(workspace)
      File.rm_rf(Path.dirname(claude_dir))
    end)

    assert {:ok, "claude", ^path} =
             SessionLog.resolve_log_source("cursor", workspace, projects_dir: Path.dirname(claude_dir))
  end
end
