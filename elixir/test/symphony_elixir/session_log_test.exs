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

  test "resolve_log_source/3 never substitutes another provider" do
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

    assert :error =
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

  test "tail and read_from reject unknown providers instead of using Codex" do
    assert {:error, :unsupported_agent_kind} = SessionLog.tail("unknown", "/tmp/log")
    assert {:error, :unsupported_agent_kind} = SessionLog.read_from("unknown", "/tmp/log", 0)
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

    test "prefers the session's own backend rollout over the workspace sidecar" do
      workspace = Path.join(System.tmp_dir!(), "rfs-own-#{System.unique_integer([:positive])}")
      sessions_dir = Path.join(System.tmp_dir!(), "rfs-rollouts-#{System.unique_integer([:positive])}")
      File.mkdir_p!(Path.join(workspace, ".symphony"))
      File.mkdir_p!(sessions_dir)

      on_exit(fn ->
        File.rm_rf!(workspace)
        File.rm_rf!(sessions_dir)
      end)

      own_path = Path.join(sessions_dir, "rollout-2026-07-18T00-00-00-own-thread.jsonl")
      other_path = Path.join(sessions_dir, "rollout-2026-07-18T00-01-00-other-thread.jsonl")
      File.write!(own_path, "")
      File.write!(other_path, "")

      # Sidecar points at ANOTHER session's thread (a sibling sharing the tree).
      File.write!(
        Path.join([workspace, ".symphony", "codex-session.json"]),
        Jason.encode!(%{"thread_id" => "other-thread"})
      )

      session = %{
        id: 9,
        workspace_path: workspace,
        agent_kind: "codex",
        provider_bindings: %{"codex" => "own-thread"}
      }

      assert {:ok, "codex", ^own_path} =
               SymphonyElixir.SessionLog.resolve_for_session(session, sessions_dir: sessions_dir)
    end

    test "does not read removed legacy identity fields" do
      workspace = Path.join(System.tmp_dir!(), "rfs-legacy-#{System.unique_integer([:positive])}")
      sessions_dir = Path.join(System.tmp_dir!(), "rfs-rollouts-#{System.unique_integer([:positive])}")
      File.mkdir_p!(workspace)
      File.mkdir_p!(sessions_dir)

      on_exit(fn ->
        File.rm_rf!(workspace)
        File.rm_rf!(sessions_dir)
      end)

      session = %{
        id: 10,
        workspace_path: workspace,
        agent_kind: "codex",
        agent_thread_ids: %{},
        codex_thread_id: "legacy-thread"
      }

      assert :error =
               SymphonyElixir.SessionLog.resolve_for_session(session, sessions_dir: sessions_dir)
    end

    test "falls back to the workspace sidecar when the session has no backend thread id" do
      workspace = Path.join(System.tmp_dir!(), "rfs-sidecar-#{System.unique_integer([:positive])}")
      sessions_dir = Path.join(System.tmp_dir!(), "rfs-rollouts-#{System.unique_integer([:positive])}")
      File.mkdir_p!(Path.join(workspace, ".symphony"))
      File.mkdir_p!(sessions_dir)

      on_exit(fn ->
        File.rm_rf!(workspace)
        File.rm_rf!(sessions_dir)
      end)

      sidecar_rollout = Path.join(sessions_dir, "rollout-2026-07-18T00-00-00-durable-thread.jsonl")
      File.write!(sidecar_rollout, "")

      File.write!(
        Path.join([workspace, ".symphony", "codex-session.json"]),
        Jason.encode!(%{"thread_id" => "durable-thread"})
      )

      session = %{id: 11, workspace_path: workspace, agent_kind: "codex", provider_bindings: %{}}

      assert {:ok, "codex", ^sidecar_rollout} =
               SymphonyElixir.SessionLog.resolve_for_session(session, sessions_dir: sessions_dir)
    end

    test "streams the most recently written rollout for the cwd, not a stale sidecar pointer" do
      workspace = Path.join(System.tmp_dir!(), "rfs-live-#{System.unique_integer([:positive])}")
      sessions_dir = Path.join(System.tmp_dir!(), "rfs-rollouts-#{System.unique_integer([:positive])}")
      File.mkdir_p!(Path.join(workspace, ".symphony"))
      File.mkdir_p!(sessions_dir)

      on_exit(fn ->
        File.rm_rf!(workspace)
        File.rm_rf!(sessions_dir)
      end)

      # Two rollouts for the same working tree: a completed one the sidecar cached,
      # and a newer one written by the current run (e.g. after an agent switch).
      stale_path = Path.join(sessions_dir, "rollout-2026-07-20T21-54-43-stale-thread.jsonl")
      live_path = Path.join(sessions_dir, "rollout-2026-07-20T21-59-57-live-thread.jsonl")
      write_session_meta!(stale_path, workspace, "stale-thread")
      write_session_meta!(live_path, workspace, "live-thread")

      # Sidecar still points at the OLD, completed thread (the lazily-cached pointer).
      File.write!(
        Path.join([workspace, ".symphony", "codex-session.json"]),
        Jason.encode!(%{"thread_id" => "stale-thread"})
      )

      # The live rollout is the most recently modified file.
      File.touch!(stale_path, 1_784_595_360)
      File.touch!(live_path, 1_784_596_380)

      session = %{id: 12, workspace_path: workspace, agent_kind: "codex", provider_bindings: %{}}

      assert {:ok, "codex", ^live_path} =
               SymphonyElixir.SessionLog.resolve_for_session(session, sessions_dir: sessions_dir)
    end
  end

  defp write_session_meta!(path, cwd, id) do
    File.write!(
      path,
      Jason.encode!(%{"type" => "session_meta", "payload" => %{"cwd" => cwd, "id" => id}}) <> "\n"
    )
  end
end
