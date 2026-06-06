defmodule SymphonyElixir.Assistant.CodexSessionClaudeRelayTest do
  # Regression test for the claude-native assistant: the streamed assistant TEXT
  # produced by the Claude CLI backend must reach the persisted assistant message.
  # Before the fix, relay_codex_event only understood Codex's "item/agentMessage/delta"
  # vocabulary, so Claude turns (which emit text as "item/progress" deltas and a final
  # "item/created" text item) surfaced an empty reply and fell back to the misleading
  # "Codex completed the turn without returning assistant text." message.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{CodexSession, History}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  # Reused stream-json fixture; "happy" mode emits a partial text delta ("Hel"),
  # a final assistant text item ("Hello from fake claude"), then a tool call/result.
  @fake Path.expand("../../support/fixtures/fake_claude.sh", __DIR__)

  setup do
    Repo.delete_all(SymphonyElixir.Assistant.Thread)

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-claude-relay-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
      Repo.delete_all(SymphonyElixir.Assistant.Thread)
    end)

    %{workspace_root: tmp_dir}
  end

  test "a claude freeform turn surfaces the assistant text from the CLI stream", %{workspace_root: workspace_root} do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: Path.join(workspace_root, "thread")})

    {:ok, result} =
      CodexSession.send_message_to_thread(
        thread,
        "oi",
        %{"agent" => "claude"},
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        workspace_root: workspace_root,
        # Skip dynamic-tool gateway registration; this test only exercises text relay.
        dynamic_tools: []
      )

    assert result.assistant_message == "Hello from fake claude"
  end

  test "a claude freeform turn streams live text deltas via on_assistant_delta", %{workspace_root: workspace_root} do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: Path.join(workspace_root, "thread")})
    test_pid = self()

    {:ok, _result} =
      CodexSession.send_message_to_thread(
        thread,
        "oi",
        %{"agent" => "claude"},
        claude_command: "FAKE_CLAUDE_MODE=happy #{@fake}",
        workspace_root: workspace_root,
        dynamic_tools: [],
        on_assistant_delta: fn delta -> send(test_pid, {:delta, delta}) end
      )

    # The fake stream emits a single partial text delta ("Hel") before the final block.
    assert_received {:delta, "Hel"}
  end

  test "an empty claude turn falls back to a claude-labelled message, not codex", %{workspace_root: workspace_root} do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: Path.join(workspace_root, "thread")})

    {:ok, result} =
      CodexSession.send_message_to_thread(
        thread,
        "oi",
        %{"agent" => "claude"},
        claude_command: "FAKE_CLAUDE_MODE=silent #{@fake}",
        workspace_root: workspace_root,
        dynamic_tools: []
      )

    assert result.assistant_message == "Claude completed the turn without returning assistant text."
    refute result.assistant_message =~ "Codex"
  end

  test "a stale claude session id falls back to a fresh session instead of failing the turn", %{workspace_root: workspace_root} do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: Path.join(workspace_root, "thread")})
    # A backend id persisted by an earlier turn that claude's session store no longer knows
    # (e.g. wiped sessions or ids recorded while the backend was misconfigured).
    {:ok, thread} = History.put_agent_thread_id(thread, "claude", "sess-stale")

    {:ok, result} =
      CodexSession.send_message_to_thread(
        thread,
        "oi",
        %{"agent" => "claude"},
        claude_command: "FAKE_CLAUDE_MODE=resume-aware #{@fake}",
        workspace_root: workspace_root,
        dynamic_tools: []
      )

    assert result.assistant_message == "fresh session reply"

    # The stale id is replaced so the next turn resumes cleanly. (In production the
    # fresh turn registers `--session-id <session_uuid>` and claude echoes it back,
    # so the persisted id is that uuid; the exact value is generated per session.)
    {:ok, reloaded} = History.get_thread(thread.id)
    new_id = History.agent_thread_id(reloaded, "claude")
    assert is_binary(new_id)
    refute new_id == "sess-stale"
  end
end
