defmodule SymphonyElixir.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.SessionLog

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
