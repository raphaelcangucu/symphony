defmodule SymphonyElixir.Assistant.TurnManagerTest do
  # Uses the always-on registry + manager the app boots. Serial to avoid races.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{History, TurnManager}
  alias SymphonyElixir.Daemon.Shutdown
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
    assert_receive {:assistant_turn_finished, _generation, {:ok, _}}, 1_000
    assert_receive {:turn_status, :finished, %{status: "completed"}}, 1_000
    refute TurnManager.running?(thread.id)

    {:ok, done} = History.get_thread(thread.id)
    assert History.current_turn(done)["status"] == "completed"
    assert History.current_turn(done)["session_id"] == "ct-tn"
  end

  test "slow goal mutation on one thread does not block another thread", %{thread: thread_a} do
    {:ok, thread_b} =
      History.create_project_session_thread("mgr", %{workspace_path: "/tmp/assistant/mgr-b"})

    test_pid = self()

    slow =
      Task.async(fn ->
        TurnManager.goal_mutation(thread_a.id, false, fn ->
          send(test_pid, {:slow_mutation_started, self()})
          receive do: (:release -> :ok)
        end)
      end)

    assert_receive {:slow_mutation_started, slow_worker}

    assert :fast =
             TurnManager.goal_mutation(thread_b.id, false, fn -> :fast end)

    send(slow_worker, :release)
    assert :ok = Task.await(slow)
  end

  test "goal mutations for one thread execute in submission order", %{thread: thread} do
    test_pid = self()

    first =
      Task.async(fn ->
        TurnManager.goal_mutation(thread.id, false, fn ->
          send(test_pid, {:mutation_started, :first, self()})
          receive do: (:release -> send(test_pid, {:mutation_applied, :first}))
          :first
        end)
      end)

    assert_receive {:mutation_started, :first, first_worker}

    second =
      Task.async(fn ->
        TurnManager.goal_mutation(thread.id, false, fn ->
          send(test_pid, {:mutation_applied, :second})
          :second
        end)
      end)

    refute_receive {:mutation_applied, :second}, 100
    send(first_worker, :release)
    assert_receive {:mutation_applied, :first}
    assert_receive {:mutation_applied, :second}
    assert :first = Task.await(first)
    assert :second = Task.await(second)
  end

  test "hard mutation worker crash advances the queued mutation", %{thread: thread} do
    crashing =
      Task.async(fn ->
        TurnManager.goal_mutation(thread.id, false, fn -> Process.exit(self(), :kill) end)
      end)

    queued = Task.async(fn -> TurnManager.goal_mutation(thread.id, false, fn -> :advanced end) end)

    assert {:error, {:goal_mutation_crashed, :killed}} = Task.await(crashing)
    assert :advanced = Task.await(queued)
  end

  test "goal status reads coalesce pending requests to the newest request order", %{thread: thread} do
    test_pid = self()

    first_operation = fn ->
      send(test_pid, {:status_read_started, :first, self()})
      receive do: (:release -> {:ok, :first})
    end

    stale_operation = fn ->
      send(test_pid, {:status_read_started, :stale, self()})
      {:ok, :stale}
    end

    newest_operation = fn ->
      send(test_pid, {:status_read_started, :newest, self()})
      {:ok, :newest}
    end

    assert :ok = TurnManager.resolve_goal_status(thread.id, 10, first_operation, self(), %{broadcast: false})
    assert_receive {:status_read_started, :first, first_worker}

    assert :ok = TurnManager.resolve_goal_status(thread.id, 20, stale_operation, self(), %{broadcast: true})
    assert :ok = TurnManager.resolve_goal_status(thread.id, 30, newest_operation, self(), %{changed: true})

    send(first_worker, :release)
    assert_receive {:goal_status_resolved, 10, %{broadcast: false}, {:ok, :first}}
    assert_receive {:status_read_started, :newest, _newest_worker}
    refute_receive {:status_read_started, :stale, _stale_worker}, 100

    assert_receive {:goal_status_resolved, 30, metadata, {:ok, :newest}}
    assert metadata.broadcast == true
    assert metadata.changed == true
  end

  test "goal status worker failure is reported and does not strand the resolver", %{thread: thread} do
    crashing_operation = fn -> Process.exit(self(), :kill) end

    assert :ok =
             TurnManager.resolve_goal_status(
               thread.id,
               40,
               crashing_operation,
               self(),
               %{broadcast: false}
             )

    assert_receive {:goal_status_resolution_failed, 40, %{broadcast: false}, {:goal_status_read_crashed, crash_reason}},
                   1_000

    assert crash_reason in [:killed, :noproc]

    assert {:ok, :recovered, request_order} =
             TurnManager.resolve_goal_status_sync(thread.id, fn -> :recovered end)

    assert is_integer(request_order)
  end

  test "enqueue waits behind an active goal mutation", %{thread: thread} do
    test_pid = self()

    mutation =
      Task.async(fn ->
        TurnManager.goal_mutation(thread.id, false, fn ->
          send(test_pid, {:mutation_worker, self()})
          receive do: (:release -> :ok)
        end)
      end)

    assert_receive {:mutation_worker, worker}

    TurnManager.enqueue(thread.id, "queued",
      run: fn ->
        send(test_pid, :queued_turn_started)
        {:ok, %{assistant_message: "done", tool_calls: []}}
      end
    )

    refute_receive :queued_turn_started, 100
    send(worker, :release)
    assert :ok = Task.await(mutation)
    assert_receive :queued_turn_started
  end

  test "pause reservation holds the queued turn until a later mutation drains it", %{thread: thread} do
    test_pid = self()

    pause =
      Task.async(fn ->
        TurnManager.goal_mutation(
          thread.id,
          true,
          fn ->
            send(test_pid, {:pause_reserved, self()})
            receive do: (:release -> {:ok, %{status: "paused"}, thread})
          end,
          queue_policy: :hold
        )
      end)

    assert_receive {:pause_reserved, pause_worker}

    TurnManager.enqueue(thread.id, "queued during pause",
      run: fn ->
        send(test_pid, :paused_queue_started)
        {:ok, %{assistant_message: "continued"}}
      end
    )

    send(pause_worker, :release)
    assert {:ok, %{status: "paused"}, ^thread} = Task.await(pause)
    refute_receive :paused_queue_started, 100

    assert :drained = TurnManager.goal_mutation(thread.id, false, fn -> :drained end)
    assert_receive :paused_queue_started
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
    assert_receive {:assistant_turn_finished, _generation, _result}, 1_000
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

    assert_receive {:assistant_turn_finished, _generation, {:error, {:turn_crashed, _}}}, 1_000

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
    assert_receive {:assistant_turn_finished, _generation, _result}, 1_000
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

    assert_receive {:assistant_turn_finished, _generation, {:error, :interrupted}}, 1_000
    Process.sleep(20)

    {:ok, interrupted_thread} = History.get_thread(thread.id)
    turn = History.current_turn(interrupted_thread)
    assert turn["status"] == "interrupted"
    assert turn["interrupted_reason"] == "user_stop"
    assert turn["active_tools"] == []
  end

  test "stale completion generation cannot finish the live turn", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:generation_worker, self()})
      receive do: (:finish -> {:ok, %{assistant_message: "current"}})
    end

    assert {:ok, %{pid: worker, generation: generation}} =
             TurnManager.start_turn(thread.id, "current", run: run, reply_to: self())

    assert_receive {:generation_worker, ^worker}
    assert :stale = TurnManager.finish_turn(thread.id, "stale-generation", {:ok, %{assistant_message: "stale"}})
    assert TurnManager.running?(thread.id)

    assert {:ok, running_thread} = History.get_thread(thread.id)
    assert History.current_turn(running_thread)["generation"] == generation
    assert History.current_turn(running_thread)["status"] == "running"

    send(worker, :finish)
    assert_receive {:assistant_turn_finished, ^generation, {:ok, %{assistant_message: "current"}}}
  end

  test "interrupt CAS preserves a completion that already won the race", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:cas_worker, self()})

      receive do
        {:agent_interrupt} -> send(test_pid, :unexpected_interrupt)
        :finish -> :ok
      end

      {:ok, %{assistant_message: "finished"}}
    end

    assert {:ok, %{pid: worker, generation: generation}} =
             TurnManager.start_turn(thread.id, "race", run: run, reply_to: self())

    assert_receive {:cas_worker, ^worker}
    assert {:ok, running_thread} = History.get_thread(thread.id)

    assert History.current_turn(running_thread)["generation"] == generation
    assert {:ok, _completed} = History.complete_turn_state(running_thread, %{assistant_message: "winner"})

    assert {:ok, :already_finished} = TurnManager.interrupt(thread.id, "goal_pause")
    refute_receive :unexpected_interrupt, 100

    send(worker, :finish)
    refute_receive :unexpected_interrupt, 100

    assert {:ok, completed_thread} = History.get_thread(thread.id)
    assert History.current_turn(completed_thread)["status"] == "completed"
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
    assert_receive {:assistant_turn_finished, _generation, {:ok, _}}, 1_000
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
    assert_receive {:assistant_turn_finished, _generation, _result}, 1_000
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
    assert_receive {:assistant_turn_finished, _generation, {:ok, _}}, 1_000
    wait_until(fn -> not TurnManager.running?(thread.id) end)
    refute TurnManager.running?(thread.id)
  end

  test "start_turn without a run fn errors and does not strand running", %{thread: thread} do
    assert {:error, :invalid_start_opts} = TurnManager.start_turn(thread.id, "x", reply_to: self())

    {:ok, reloaded} = History.get_thread(thread.id)
    refute History.turn_running?(reloaded)
    refute TurnManager.running?(thread.id)
  end

  test "start and enqueue reject work while daemon is draining", %{thread: thread} do
    :ok = Shutdown.begin_drain()
    on_exit(fn -> Shutdown.reset() end)

    assert {:error, :daemon_draining} =
             TurnManager.start_turn(thread.id, "new", run: fn -> {:ok, %{}} end)

    assert {:error, :daemon_draining} =
             TurnManager.enqueue(thread.id, "queued", run: fn -> {:ok, %{}} end)
  end

  test "queued work does not start after drain begins", %{thread: thread} do
    test_pid = self()

    first = fn ->
      send(test_pid, {:first_worker, self()})
      receive do: (:finish -> {:ok, %{}})
    end

    second = fn ->
      send(test_pid, :second_worker_started)
      {:ok, %{}}
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "first", run: first)
    assert_receive {:first_worker, ^worker}
    assert :ok = TurnManager.enqueue(thread.id, "second", run: second)

    :ok = Shutdown.begin_drain()
    on_exit(fn -> Shutdown.reset() end)
    send(worker, :finish)

    refute_receive :second_worker_started, 100
  end

  test "active_thread_ids and interrupt_all expose running workers", %{thread: thread} do
    test_pid = self()

    run = fn ->
      send(test_pid, {:worker, self()})
      receive do: ({:agent_interrupt} -> {:error, :interrupted})
    end

    assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "live", run: run)
    assert_receive {:worker, ^worker}
    assert thread.id in TurnManager.active_thread_ids()
    assert :ok = TurnManager.interrupt_all("daemon_shutdown_timeout")
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
