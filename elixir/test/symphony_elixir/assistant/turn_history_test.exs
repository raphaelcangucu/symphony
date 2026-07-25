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
               provider: "codex",
               model: "gpt-5-codex",
               effort: "high"
             })

    turn = History.current_turn(updated)
    assert turn["status"] == "running"
    assert turn["prompt"] == "do the thing"
    assert turn["provider"] == "codex"
    refute Map.has_key?(turn, "agent_kind")
    refute Map.has_key?(turn, "model")
    refute Map.has_key?(turn, "effort")
    assert is_binary(turn["started_at"])
    assert turn["finished_at"] == nil
    assert History.turn_running?(updated)
  end

  test "note_run_identity writes only canonical identity fields", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.note_run_identity(thread, %{
               provider: "codex",
               conversation_id: "ct-1",
               run_id: "tn-9"
             })

    turn = History.current_turn(updated)
    assert turn["provider"] == "codex"
    assert turn["conversation_id"] == "ct-1"
    assert turn["run_id"] == "tn-9"
    refute Map.has_key?(turn, "codex_thread_id")
    refute Map.has_key?(turn, "turn_id")
    refute Map.has_key?(turn, "session_id")
  end

  test "note_run_identity rejects an incomplete conversation identity", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:error, :conversation_id_required} =
             History.note_run_identity(thread, %{provider: "codex", run_id: "tn-9"})

    assert {:ok, reloaded} = History.get_thread(thread.id)
    assert History.current_turn(reloaded)["run_id"] == nil
    assert reloaded.provider_bindings == %{}
  end

  test "complete_turn_state marks completed with finished_at", %{thread: thread} do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, updated} =
             History.complete_turn_state(thread, %{
               provider: "codex",
               conversation_id: "ct-2",
               run_id: "tn-2"
             })

    turn = History.current_turn(updated)
    assert turn["status"] == "completed"
    assert is_binary(turn["finished_at"])
    assert turn["conversation_id"] == "ct-2"
    assert turn["run_id"] == "tn-2"
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

  test "fail_turn_state persists a stable structured error alongside legacy text", %{
    thread: thread
  } do
    {:ok, thread} = History.start_turn_state(thread, %{trigger: "user", prompt: "x"})

    assert {:ok, failed} =
             History.fail_turn_state(
               thread,
               {:workspace_symlink_escape, "/private/path", "/allowed/root"}
             )

    turn = History.current_turn(failed)
    assert turn["error_code"] == "workspace_not_executable"
    assert turn["error_detail"]["category"] == "workspace"
    assert turn["error_detail"]["retryable"] == false
    refute turn["error_detail"]["message"] =~ "/private/path"

    payload = History.turn_payload(failed)
    assert payload.error.code == "workspace_not_executable"
    assert payload.error.category == "workspace"
    assert payload.error.retryable == false
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
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", provider: "claude"})

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
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", provider: "claude"})

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
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", provider: "claude"})

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
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", provider: "claude"})

    assert {:ok, updated} = History.touch_turn_activity(thread)
    assert is_binary(History.current_turn(updated)["last_activity_at"])
  end

  test "terminal turn states clear active_tools", %{thread: thread} do
    assert {:ok, thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "go", provider: "claude"})

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

  test "stale current-turn and queue writers preserve each other's metadata", %{
    thread: original
  } do
    {:ok, running} =
      History.start_turn_state(original, %{
        trigger: "user",
        prompt: "running",
        provider: "codex"
      })

    {:ok, queued, first} =
      History.enqueue_pending_turn(original, %{
        prompt: "queued first",
        trigger: "user",
        provider: "claude"
      })

    assert History.current_turn(queued)["prompt"] == "running"

    {:ok, queued_again, second} =
      History.enqueue_pending_turn(original, %{
        prompt: "queued second",
        trigger: "user",
        provider: "cursor"
      })

    assert Enum.map(History.pending_turns(queued_again), & &1["id"]) == [
             first["id"],
             second["id"]
           ]

    {:ok, identified} =
      History.note_run_identity(running, %{
        provider: "codex",
        conversation_id: "codex-conversation",
        run_id: "codex-run"
      })

    assert Enum.map(History.pending_turns(identified), & &1["id"]) == [
             first["id"],
             second["id"]
           ]

    assert History.current_turn(identified)["conversation_id"] == "codex-conversation"
  end

  test "stale preference and goal writers preserve current and queued turns", %{
    thread: original
  } do
    {:ok, running} =
      History.start_turn_state(original, %{
        trigger: "user",
        prompt: "running",
        provider: "codex"
      })

    {:ok, queued, entry} =
      History.enqueue_pending_turn(running, %{
        prompt: "queued",
        trigger: "user",
        provider: "claude"
      })

    assert {:ok, preferences} =
             History.set_turn_preferences(original, %{
               execution_mode: "build",
               skill_profile: "default"
             })

    assert History.current_turn(preferences)["prompt"] == "running"
    assert Enum.map(History.pending_turns(preferences), & &1["id"]) == [entry["id"]]

    assert {:ok, goal} = History.set_goal_mode(original, true, "Finish safely")
    assert History.current_turn(goal)["prompt"] == "running"
    assert Enum.map(History.pending_turns(goal), & &1["id"]) == [entry["id"]]
    assert History.thread_goal_objective(goal) == "Finish safely"

    assert {:ok, bumped} = History.bump_goal_revision(original)
    assert History.current_turn(bumped)["prompt"] == "running"
    assert Enum.map(History.pending_turns(bumped), & &1["id"]) == [entry["id"]]
    assert History.thread_goal_objective(bumped) == "Finish safely"
    assert History.thread_goal_revision(bumped) != History.thread_goal_revision(queued)
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

    {:ok, thread} =
      History.note_run_identity(thread, %{
        provider: "codex",
        conversation_id: "ct",
        run_id: "tn"
      })

    {:ok, thread} = History.interrupt_turn_state(thread, "serve_restart")

    payload = History.turn_payload(thread)
    assert payload.status == "interrupted"
    assert payload.provider == "codex"
    assert payload.conversation_id == "ct"
    assert payload.run_id == "tn"
    refute Map.has_key?(payload, :session_id)
    assert payload.can_resume == true
    assert is_binary(payload.started_at)

    assert History.turn_payload(nil) == nil
  end

  test "pending turns survive reload and preserve FIFO order", %{thread: thread} do
    assert {:ok, thread, first} =
             History.enqueue_pending_turn(thread, %{
               prompt: "first",
               trigger: "gateway",
               provider: "codex"
             })

    assert {:ok, _thread, second} =
             History.enqueue_pending_turn(thread, %{
               prompt: "second",
               trigger: "user",
               provider: "claude",
               model: "sonnet"
             })

    assert {:ok, reloaded} = History.get_thread(thread.id)
    assert Enum.map(History.pending_turns(reloaded), & &1["prompt"]) == ["first", "second"]
    assert first["id"] != second["id"]
    assert History.turn_payload(reloaded).queued_count == 2

    assert {:ok, updated, ^first} = History.take_pending_turn(reloaded)
    assert Enum.map(History.pending_turns(updated), & &1["prompt"]) == ["second"]

    assert {:ok, emptied, ^second} = History.take_pending_turn(updated)
    assert History.pending_turns(emptied) == []
    assert {:ok, ^emptied, nil} = History.take_pending_turn(emptied)
  end

  test "pending turns require the canonical provider field", %{thread: thread} do
    assert {:error, :provider_required} =
             History.enqueue_pending_turn(thread, %{prompt: "legacy", agent_kind: "codex"})

    assert {:ok, reloaded} = History.get_thread(thread.id)
    assert History.pending_turns(reloaded) == []
  end

  test "starting a durable queued turn removes it in the same metadata transition", %{
    thread: thread
  } do
    assert {:ok, queued, entry} =
             History.enqueue_pending_turn(thread, %{
               prompt: "durable",
               trigger: "user",
               provider: "claude"
             })

    assert {:ok, running} =
             History.start_turn_state(queued, %{
               prompt: entry["prompt"],
               trigger: entry["trigger"],
               provider: entry["provider"],
               queue_id: entry["id"]
             })

    assert History.pending_turns(running) == []
    assert History.current_turn(running)["status"] == "running"
    assert History.current_turn(running)["provider"] == "claude"
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
