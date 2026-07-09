defmodule SymphonyElixir.Assistant.TurnManagerTest do
  # Uses the always-on registry + manager the app boots. Serial to avoid races.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, TurnManager}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Mgr", slug: "mgr"})
    {:ok, thread} = History.ensure_thread("mgr", %{workspace_path: "/tmp/assistant/mgr"})
    {:ok, thread: thread}
  end

  test "start_turn writes running, registers a pid, and broadcasts running", %{thread: thread} do
    TurnManager.subscribe(thread.id)
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{assistant_message: "done", codex_thread_id: "ct", turn_id: "tn"}}
    end

    assert {:ok, %{pid: worker}} =
             TurnManager.start_turn(thread.id, "hello", run: run, reply_to: self(), trigger: "user")

    assert_receive {:worker, ^worker}, 1_000
    assert TurnManager.running?(thread.id)
    assert_receive {:turn_status, :running, %{status: "running"}}, 1_000

    {:ok, reloaded} = History.get_thread(thread.id)
    assert History.turn_running?(reloaded)

    send(worker, :go)
    assert_receive {:assistant_turn_finished, {:ok, _}}, 1_000
    assert_receive {:turn_status, :finished, %{status: "completed"}}, 1_000
    refute TurnManager.running?(thread.id)

    {:ok, done} = History.get_thread(thread.id)
    assert History.current_turn(done)["status"] == "completed"
    assert History.current_turn(done)["session_id"] == "ct-tn"
  end

  test "a second start_turn while running returns :turn_in_progress", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "first", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000

    assert {:error, :turn_in_progress} =
             TurnManager.start_turn(thread.id, "second", run: fn -> {:ok, %{}} end, reply_to: self())

    send(worker, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
  end

  test "abnormal worker exit interrupts the current turn (task_crash)", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:boom -> exit(:boom))
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "explode", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    send(worker, :boom)

    assert_receive {:assistant_turn_finished, {:error, {:turn_crashed, _}}}, 1_000

    wait_until(fn ->
      {:ok, t} = History.get_thread(thread.id)
      History.current_turn(t)["status"] == "interrupted"
    end)

    {:ok, t} = History.get_thread(thread.id)
    assert History.current_turn(t)["interrupted_reason"] == "task_crash"
    refute TurnManager.running?(thread.id)
  end

  test "note_codex_turn fills the codex ids on the running turn", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "x", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    TurnManager.note_codex_turn(thread.id, "ct-7", "tn-7")

    wait_until(fn ->
      {:ok, t} = History.get_thread(thread.id)
      History.current_turn(t)["session_id"] == "ct-7-tn-7"
    end)

    send(worker, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
  end

  test "interrupt sends agent_interrupt, clears active tools, and keeps interrupted state", %{thread: thread} do
    TurnManager.subscribe(thread.id)
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})

      receive do
        {:agent_interrupt} ->
          send(test_pid, {:worker_interrupted, self()})

          receive do
            {:codex_interrupt} -> send(test_pid, {:unexpected_codex_interrupt, self()})
          after
            50 -> :ok
          end
      after
        2_000 ->
          send(test_pid, {:worker_timeout, self()})
      end

      {:error, :interrupted}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "stop me", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    assert_receive {:turn_status, :running, %{status: "running"}}, 1_000

    {:ok, running_thread} = History.get_thread(thread.id)

    {:ok, _with_tool} =
      History.upsert_active_tool(running_thread, %{
        "id" => "tool-stop",
        "name" => "Bash",
        "arguments_summary" => "sleep 30",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert :ok = TurnManager.interrupt(thread.id, "user_stop")
    assert_receive {:worker_interrupted, ^worker}, 1_000
    refute_receive {:unexpected_codex_interrupt, ^worker}, 100

    assert_receive {:turn_status, :interrupted, %{status: "interrupted", can_resume: true, active_tools: []}},
                   1_000

    assert_receive {:assistant_turn_finished, {:error, :interrupted}}, 1_000
    Process.sleep(20)

    {:ok, interrupted_thread} = History.get_thread(thread.id)
    turn = History.current_turn(interrupted_thread)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "user_stop"
    assert turn["active_tools"] == []
  end

  test "kill_tool signals the worker, removes the active tool, and broadcasts canceled", %{thread: thread} do
    TurnManager.subscribe(thread.id)
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})

      receive do
        {:kill_tool, "tool-kill"} ->
          send(test_pid, {:tool_killed, self()})
      after
        2_000 ->
          send(test_pid, {:worker_timeout, self()})
      end

      receive do
        :finish -> :ok
      after
        2_000 -> :ok
      end

      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "kill one", run: run, reply_to: self())
    assert_receive {:worker, ^worker}, 1_000
    assert_receive {:turn_status, :running, %{status: "running"}}, 1_000

    {:ok, running_thread} = History.get_thread(thread.id)

    {:ok, _with_tools} =
      History.upsert_active_tool(running_thread, %{
        "id" => "tool-kill",
        "name" => "Bash",
        "arguments_summary" => "sleep 30",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert :ok = TurnManager.kill_tool(thread.id, "tool-kill")
    assert_receive {:tool_killed, ^worker}, 1_000

    assert_receive {:turn_stream, "tool_call_completed", %{tool_call: %{id: "tool-kill", name: "Bash", status: "canceled"}}},
                   1_000

    {:ok, updated_thread} = History.get_thread(thread.id)
    assert History.current_turn(updated_thread)["active_tools"] == []

    send(worker, :finish)
    assert_receive {:assistant_turn_finished, {:ok, _}}, 1_000
  end

  test "kill_tool returns tool_not_running when the id is absent", %{thread: thread} do
    assert {:ok, running_thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "kill missing", agent_kind: "codex"})

    {:ok, _with_tool} =
      History.upsert_active_tool(running_thread, %{
        "id" => "tool-present",
        "name" => "Bash",
        "arguments_summary" => "mix test",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert {:error, :tool_not_running} = TurnManager.kill_tool(thread.id, "missing")
  end

  test "kill_tool returns no_worker when the tool is active without a worker", %{thread: thread} do
    assert {:ok, running_thread} =
             History.start_turn_state(thread, %{trigger: "user", prompt: "orphan tool", agent_kind: "codex"})

    {:ok, _with_tool} =
      History.upsert_active_tool(running_thread, %{
        "id" => "tool-orphan",
        "name" => "Bash",
        "arguments_summary" => "sleep 30",
        "started_at" => "2026-07-09T12:00:00Z"
      })

    assert {:error, :no_worker} = TurnManager.kill_tool(thread.id, "tool-orphan")

    {:ok, unchanged_thread} = History.get_thread(thread.id)
    assert [%{"id" => "tool-orphan"}] = History.current_turn(unchanged_thread)["active_tools"]
  end

  test "enqueue drains the next turn when the current one finishes", %{thread: thread} do
    test_pid = self()

    first = fn ->
      send(test_pid, {:first, self()})
      receive do: (:go -> :ok)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker1}} = TurnManager.start_turn(thread.id, "first", run: first, reply_to: self())
    assert_receive {:first, ^worker1}, 1_000

    second_builder = fn prompt ->
      fn ->
        send(test_pid, {:second, prompt})
        {:ok, %{}}
      end
    end

    TurnManager.enqueue(thread.id, "second", run_builder: second_builder, reply_to: self())

    send(worker1, :go)
    assert_receive {:assistant_turn_finished, _}, 1_000
    assert_receive {:second, "second"}, 1_000
  end

  test "enqueue with no running turn starts immediately", %{thread: thread} do
    test_pid = self()

    builder = fn prompt ->
      fn ->
        send(test_pid, {:ran, prompt})
        {:ok, %{}}
      end
    end

    TurnManager.enqueue(thread.id, "solo", run_builder: builder, reply_to: self())

    assert_receive {:ran, "solo"}, 1_000
    assert_receive {:assistant_turn_finished, {:ok, _}}, 1_000
    wait_until(fn -> not TurnManager.running?(thread.id) end)
    refute TurnManager.running?(thread.id)
  end

  test "start_turn without a run fn errors and does not strand running", %{thread: thread} do
    assert {:error, :invalid_start_opts} = TurnManager.start_turn(thread.id, "x", reply_to: self())

    {:ok, reloaded} = History.get_thread(thread.id)
    refute History.turn_running?(reloaded)
    refute TurnManager.running?(thread.id)
  end

  defp wait_until(fun, attempts \\ 100) do
    cond do
      attempts <= 0 ->
        flunk("condition not met in time")

      fun.() ->
        :ok

      true ->
        Process.sleep(10)
        wait_until(fun, attempts - 1)
    end
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
