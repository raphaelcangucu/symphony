defmodule SymphonyElixir.Assistant.TurnHistoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Turns", slug: "turns"})
    {:ok, thread} = History.ensure_thread("turns", %{workspace_path: "/tmp/assistant/turns"})
    {:ok, thread: thread}
  end

  test "start_turn_state writes a running current_turn", %{thread: thread} do
    assert {:ok, updated} =
             History.start_turn_state(thread, %{
               trigger: "user",
               prompt: "do the thing",
               agent_kind: "codex",
               model: "gpt-5-codex",
               effort: "high"
             })

    turn = History.current_turn(updated)
    assert turn["status"] == "running"
    assert turn["prompt"] == "do the thing"
    assert turn["agent_kind"] == "codex"
    assert is_binary(turn["started_at"])
    assert turn["finished_at"] == nil
    assert History.turn_running?(updated)
  end

  test "note_turn_codex fills codex ids and composes session_id", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.note_turn_codex(thread, %{codex_thread_id: "ct-1", turn_id: "tn-9"})

    turn = History.current_turn(updated)
    assert turn["codex_thread_id"] == "ct-1"
    assert turn["turn_id"] == "tn-9"
    assert turn["session_id"] == "ct-1-tn-9"
  end

  test "complete_turn_state marks completed with finished_at", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.complete_turn_state(thread, %{codex_thread_id: "ct-2", turn_id: "tn-2"})

    turn = History.current_turn(updated)
    assert turn["status"] == "completed"
    assert is_binary(turn["finished_at"])
    assert turn["session_id"] == "ct-2-tn-2"
    refute History.turn_running?(updated)
  end

  test "fail_turn_state records the error", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert {:ok, updated} = History.fail_turn_state(thread, "boom")
    turn = History.current_turn(updated)
    assert turn["status"] == "failed"
    assert turn["error"] == "boom"
    assert is_binary(turn["finished_at"])
  end

  test "interrupt_turn_state marks interrupted with a reason", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert {:ok, updated} = History.interrupt_turn_state(thread, "task_crash")
    turn = History.current_turn(updated)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "task_crash"
  end

  test "upsert_active_tool records tool and last_activity_at", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

    tool = %{
      "id" => "tool-1",
      "name" => "Bash",
      "arguments_summary" => "pest --parallel --shard=3/3",
      "started_at" => "2026-07-09T12:00:00Z"
    }

    assert {:ok, updated} = History.upsert_active_tool(thread, tool)

    turn = History.current_turn(updated)
    assert turn["active_tools"] == [tool]
    assert is_binary(turn["last_activity_at"])

    payload = History.turn_payload(updated)
    assert payload.active_tools == [tool]
    assert is_binary(payload.last_activity_at)
  end

  test "upsert_active_tool replaces existing tool by id", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

    assert {:ok, thread} =
             History.upsert_active_tool(thread, %{
               id: "tool-1",
               name: "Bash",
               arguments_summary: "ls",
               started_at: "2026-07-09T12:00:00Z"
             })

    assert {:ok, updated} =
             History.upsert_active_tool(thread, %{
               id: "tool-1",
               name: "Bash",
               arguments_summary: "pwd",
               started_at: "2026-07-09T12:00:01Z"
             })

    assert History.current_turn(updated)["active_tools"] == [
             %{
               "id" => "tool-1",
               "name" => "Bash",
               "arguments_summary" => "pwd",
               "started_at" => "2026-07-09T12:00:01Z"
             }
           ]
  end

  test "remove_active_tool drops matching id", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

    {:ok, thread} =
      History.upsert_active_tool(thread, %{
        "id" => "tool-1",
        "name" => "Bash",
        "arguments_summary" => "ls",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert {:ok, updated} = History.remove_active_tool(thread, "tool-1")

    turn = History.current_turn(updated)
    assert turn["active_tools"] == []
    assert is_binary(turn["last_activity_at"])
  end

  test "touch_turn_activity bumps last_activity_at", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

    assert {:ok, updated} = History.touch_turn_activity(thread)
    assert is_binary(History.current_turn(updated)["last_activity_at"])
  end

  test "terminal turn states clear active_tools", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

    {:ok, thread} =
      History.upsert_active_tool(thread, %{
        "id" => "tool-1",
        "name" => "Bash",
        "arguments_summary" => "ls",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert {:ok, completed} = History.complete_turn_state(thread, %{})
    assert History.current_turn(completed)["active_tools"] == []

    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "go"})
    {:ok, thread} = History.upsert_active_tool(thread, %{"id" => "tool-1"})
    assert {:ok, failed} = History.fail_turn_state(thread, "boom")
    assert History.current_turn(failed)["active_tools"] == []

    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "go"})
    {:ok, thread} = History.upsert_active_tool(thread, %{"id" => "tool-1"})
    assert {:ok, interrupted} = History.interrupt_turn_state(thread, "user_stop")
    assert History.current_turn(interrupted)["active_tools"] == []
  end

  test "turn_elapsed_seconds is non-negative while running and nil otherwise", %{thread: thread} do
    {:ok, running} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    assert History.turn_elapsed_seconds(running) >= 0

    {:ok, done} = History.complete_turn_state(running, %{})
    assert History.turn_elapsed_seconds(done) == nil
  end

  test "metadata writes preserve sibling keys (goal_mode)", %{thread: thread} do
    {:ok, thread} = History.set_goal_mode(thread, true)
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert History.thread_goal_mode(thread) == true
    assert History.turn_running?(thread)
  end

  test "reconcile_orphaned_turns flips running threads to interrupted(serve_restart)", %{thread: thread} do
    {:ok, _running} = History.start_turn_state(thread, %{trigger: "user", prompt: "stuck"})

    assert {:ok, 1} = History.reconcile_orphaned_turns()

    {:ok, reloaded} = History.get_thread(thread.id)
    turn = History.current_turn(reloaded)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "serve_restart"
    assert is_binary(turn["finished_at"])
  end

  test "turn_payload exposes the channel/UI shape with can_resume", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})
    {:ok, thread} = History.note_turn_codex(thread, %{codex_thread_id: "ct", turn_id: "tn"})
    {:ok, thread} = History.interrupt_turn_state(thread, "serve_restart")

    payload = History.turn_payload(thread)
    assert payload.status == "interrupted"
    assert payload.session_id == "ct-tn"
    assert payload.can_resume == true
    assert is_binary(payload.started_at)

    assert History.turn_payload(nil) == nil
  end

  test "current_turn is nil before any turn starts", %{thread: thread} do
    assert History.current_turn(thread) == nil
    refute History.turn_running?(thread)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
