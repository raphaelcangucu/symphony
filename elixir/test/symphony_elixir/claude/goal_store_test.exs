defmodule SymphonyElixir.Claude.GoalStoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.GoalStore

  setup do
    dir = Path.join(System.tmp_dir!(), "claude-goal-store-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{workspace: dir}
  end

  test "write/read execution goal with pending set", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "all auth tests pass",
               "pending_command" => "set"
             })

    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "running"
    assert goal["objective"] == "all auth tests pass"
    assert goal["pending_command"] == "set"
    assert is_binary(goal["updated_at"])
  end

  test "execution storage remains workspace-scoped when an assistant thread id is supplied", %{
    workspace: workspace
  } do
    assert :ok =
             GoalStore.put(
               workspace,
               :execution,
               %{"objective" => "execute", "pending_command" => "set"},
               8003
             )

    assert {:ok, %{"objective" => "execute"}} = GoalStore.read(workspace, :execution, 8004)
    assert GoalStore.path(workspace, :execution, 8003) == GoalStore.path(workspace, :execution)
  end

  test "thread-scoped authoring and execution files are independent", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "exec",
               "pending_command" => "set"
             })

    assert :ok =
             GoalStore.put(
               workspace,
               :authoring,
               %{
                 "status" => "running",
                 "objective" => "auth",
                 "pending_command" => "set"
               },
               8003
             )

    assert {:ok, %{"objective" => "exec"}} = GoalStore.read(workspace, :execution)
    assert {:ok, %{"objective" => "auth"}} = GoalStore.read(workspace, :authoring, 8003)
  end

  test "unscoped authoring storage is impossible", %{workspace: workspace} do
    assert {:error, :assistant_thread_id_required} =
             GoalStore.put(workspace, :authoring, %{
               "objective" => "must not leak",
               "pending_command" => "set"
             })

    assert_raise ArgumentError, ~r/assistant_thread_id/, fn ->
      GoalStore.path(workspace, :authoring)
    end

    refute File.exists?(Path.join(workspace, ".symphony/claude-goal-authoring.json"))
  end

  test "authoring goals are isolated by assistant thread in a shared workspace", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :authoring, %{"objective" => "first", "pending_command" => "set"}, 8003)

    assert :ok =
             GoalStore.put(workspace, :authoring, %{"objective" => "second", "pending_command" => "set"}, 8004)

    assert {:ok, %{"objective" => "first"}} = GoalStore.read(workspace, :authoring, 8003)
    assert {:ok, %{"objective" => "second"}} = GoalStore.read(workspace, :authoring, 8004)
    assert GoalStore.path(workspace, :authoring, 8003) != GoalStore.path(workspace, :authoring, 8004)
  end

  test "thread-isolated authoring sidecars round-trip every canonical lifecycle status", %{
    workspace: workspace
  } do
    statuses = ~w(starting running paused blocked failed completed budgetLimited usageLimited)

    Enum.each(Enum.with_index(statuses, 1), fn {status, index} ->
      thread_id = 8_100 + index
      objective = "Objective #{status}"

      assert :ok =
               GoalStore.put(
                 workspace,
                 :authoring,
                 %{"status" => status, "objective" => objective, "pending_command" => nil},
                 thread_id
               )

      assert {:ok, %{"status" => ^status, "objective" => ^objective}} =
               GoalStore.read(workspace, :authoring, thread_id)
    end)
  end

  test "clear_pending keeps objective and status", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "x",
               "pending_command" => "set"
             })

    {:ok, %{"revision" => revision}} = GoalStore.read(workspace, :execution)
    assert :ok = GoalStore.acknowledge_pending(workspace, :execution, :set, revision, nil)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["pending_command"] == nil
    assert goal["objective"] == "x"
  end

  test "delete removes sidecar", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "x",
               "pending_command" => nil
             })

    assert :ok = GoalStore.delete(workspace, :execution)
    assert GoalStore.read(workspace, :execution) == :error
  end

  test "acknowledging clear writes canonical completed state without objective", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "x",
               "pending_command" => "clear"
             })

    {:ok, %{"revision" => revision}} = GoalStore.read(workspace, :execution)
    assert :ok = GoalStore.acknowledge_pending(workspace, :execution, :clear, revision, nil)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "completed"
    assert goal["objective"] == nil
    assert goal["pending_command"] == nil
  end

  test "rejects empty objective on put", %{workspace: workspace} do
    assert {:error, :empty_objective} =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "  ",
               "pending_command" => "set"
             })
  end

  test "rejects objective over 4000 bytes", %{workspace: workspace} do
    assert {:error, :objective_too_long} =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => String.duplicate("a", 4001),
               "pending_command" => "set"
             })
  end

  test "concurrent readers never observe partial sidecar JSON", %{workspace: workspace} do
    writer =
      Task.async(fn ->
        for index <- 1..100 do
          assert :ok =
                   GoalStore.put(
                     workspace,
                     :authoring,
                     %{
                       "objective" => "objective-#{index}",
                       "pending_command" => "set"
                     },
                     9001
                   )
        end
      end)

    readers =
      for _ <- 1..8 do
        Task.async(fn ->
          for _ <- 1..200 do
            result = GoalStore.read(workspace, :authoring, 9001)
            assert result == :error or match?({:ok, %{"objective" => objective}} when is_binary(objective), result)
          end
        end)
      end

    Task.await(writer)
    Enum.each(readers, &Task.await/1)
  end

  test "queue_clear cannot overwrite a concurrent newer set with an old objective", %{workspace: workspace} do
    for _ <- 1..50 do
      assert :ok =
               GoalStore.put(
                 workspace,
                 :authoring,
                 %{
                   "objective" => "old",
                   "pending_command" => "set"
                 },
                 9002
               )

      clear = Task.async(fn -> GoalStore.queue_clear(workspace, :authoring, 9002) end)

      set =
        Task.async(fn ->
          GoalStore.put(
            workspace,
            :authoring,
            %{
              "objective" => "new",
              "pending_command" => "set"
            },
            9002
          )
        end)

      assert :ok = Task.await(clear)
      assert :ok = Task.await(set)
      assert {:ok, %{"objective" => "new"}} = GoalStore.read(workspace, :authoring, 9002)
    end
  end

  test "read canonicalizes legacy cleared and achieved records", %{workspace: workspace} do
    for {thread_id, status} <- [{9101, "cleared"}, {9102, "achieved"}] do
      path = GoalStore.path(workspace, :authoring, thread_id)
      File.mkdir_p!(Path.dirname(path))

      File.write!(
        path,
        Jason.encode!(%{
          "goal" => %{
            "status" => status,
            "objective" => nil,
            "pending_command" => nil,
            "revision" => "legacy-#{thread_id}"
          }
        })
      )

      assert {:ok, %{"status" => "completed", "pending_command" => nil}} =
               GoalStore.read(workspace, :authoring, thread_id)
    end
  end

  test "rejects malformed canonical stores", %{workspace: workspace} do
    malformed_goals = [
      %{"status" => "unknown", "objective" => "Audit", "pending_command" => nil, "revision" => "1"},
      %{"status" => "running", "objective" => "Audit", "pending_command" => "bogus", "revision" => "2"},
      %{"status" => "running", "objective" => "Audit", "pending_command" => nil, "revision" => nil},
      %{"status" => "running", "objective" => nil, "pending_command" => nil, "revision" => "4"},
      %{"status" => "completed", "objective" => nil, "pending_command" => "clear", "revision" => "5"}
    ]

    Enum.each(Enum.with_index(malformed_goals, 1), fn {goal, index} ->
      thread_id = 9200 + index
      path = GoalStore.path(workspace, :authoring, thread_id)
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, Jason.encode!(%{"goal" => goal}))

      assert {:error, :invalid_goal_store} = GoalStore.read(workspace, :authoring, thread_id)
    end)
  end

  test "stale acknowledgements and finalizations preserve the newer revision", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "First",
               "pending_command" => "set"
             })

    assert {:ok, %{"revision" => stale_revision}} = GoalStore.read(workspace, :execution)

    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "Second",
               "pending_command" => "set"
             })

    assert {:ok, %{"revision" => current_revision}} = GoalStore.read(workspace, :execution)
    refute current_revision == stale_revision

    assert :stale = GoalStore.acknowledge_pending(workspace, :execution, :set, stale_revision, nil)
    assert :stale = GoalStore.transition_native_run(workspace, :execution, :completed, nil, stale_revision)

    assert {:ok,
            %{
              "objective" => "Second",
              "pending_command" => "set",
              "revision" => ^current_revision,
              "status" => "running"
            }} = GoalStore.read(workspace, :execution)
  end

  test "clear mirror errors are returned without finalizing the sidecar", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "Audit",
               "pending_command" => "clear"
             })

    assert {:ok, %{"revision" => revision}} = GoalStore.read(workspace, :execution)

    assert {:error, :mirror_unavailable} =
             GoalStore.acknowledge_clear_with_mirror(
               workspace,
               :execution,
               revision,
               nil,
               fn -> {:error, :mirror_unavailable} end,
               fn _goal -> :ok end
             )

    assert {:ok, %{"pending_command" => "clear", "revision" => ^revision}} =
             GoalStore.read(workspace, :execution)
  end

  test "newer clear revision reports mirror restoration failure", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "running",
               "objective" => "Old objective",
               "pending_command" => "clear"
             })

    assert {:ok, %{"revision" => revision}} = GoalStore.read(workspace, :execution)
    path = GoalStore.path(workspace, :execution)

    clear_mirror = fn ->
      File.write!(
        path,
        Jason.encode!(%{
          "goal" => %{
            "status" => "running",
            "objective" => "New objective",
            "pending_command" => "set",
            "revision" => "newer-revision"
          }
        })
      )

      :ok
    end

    assert {:error, {:goal_mirror_restore_failed, :tracker_unavailable}} =
             GoalStore.acknowledge_clear_with_mirror(
               workspace,
               :execution,
               revision,
               nil,
               clear_mirror,
               fn %{"objective" => "New objective"} -> {:error, :tracker_unavailable} end
             )

    assert {:ok, %{"objective" => "New objective", "revision" => "newer-revision"}} =
             GoalStore.read(workspace, :execution)
  end
end
