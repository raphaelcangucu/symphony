defmodule SymphonyElixir.SessionLogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog
  alias SymphonyElixir.SessionEvents
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

  test "read_from/4 never re-merges Symphony events, while tail/3 merges them once" do
    workspace = Path.join(System.tmp_dir!(), "session-log-events-#{System.unique_integer()}")
    claude_root = Path.join(System.tmp_dir!(), "claude-projects-#{System.unique_integer()}")
    claude_dir = Path.join(claude_root, ClaudeLog.encode_workspace(workspace))

    File.mkdir_p!(claude_dir)
    File.mkdir_p!(workspace)

    path = Path.join(claude_dir, "session.jsonl")
    write_assistant_line!(path, "native work")

    :ok = SessionEvents.append_abort(workspace, "user_stop", detail: "Stopped manually via hard reset")

    on_exit(fn ->
      File.rm_rf(workspace)
      File.rm_rf(claude_root)
    end)

    opts = [workspace: workspace]

    # Initial load folds the Symphony abort annotation into the transcript once.
    assert {:ok, tail_entries, _tail_offset} = SessionLog.tail("claude", path, opts)
    assert Enum.any?(tail_entries, &symphony_abort?/1)

    # Incremental polling must return only new native entries. Re-merging the
    # full Symphony events file on every tick is what made the transcript grow
    # without bound after a user_stop pause.
    assert {:ok, read_entries, _read_offset} = SessionLog.read_from("claude", path, 0, opts)
    refute Enum.any?(read_entries, &symphony_abort?/1)
  end

  defp symphony_abort?(entry) when is_map(entry) do
    Map.get(entry, "title") == "Turn aborted" or Map.get(entry, :title) == "Turn aborted"
  end

  describe "resolve_for_session/1" do
    alias SymphonyElixir.Agent.SessionStore

    test "prefers the per-session transcript when present" do
      workspace = Path.join(System.tmp_dir!(), "rfs-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      :ok = SessionStore.append(workspace, 7, %{"type" => "assistant", "text" => "hi"})

      session = %{id: 7, workspace_path: workspace, agent_kind: "codex"}
      assert {:ok, "symphony", path} = SymphonyElixir.SessionLog.resolve_for_session(session)
      assert path == SessionStore.transcript_path(workspace, 7)
    end

    test "falls back to resolve_log_source when no per-session transcript exists" do
      workspace = Path.join(System.tmp_dir!(), "rfs-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      on_exit(fn -> File.rm_rf!(workspace) end)

      session = %{id: 8, workspace_path: workspace, agent_kind: "codex"}
      # No transcript and no native rollout in a temp dir → :error (documents fallback path).
      assert SymphonyElixir.SessionLog.resolve_for_session(session) == :error
    end
  end
end
