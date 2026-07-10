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
               "status" => "active",
               "objective" => "all auth tests pass",
               "pending_command" => "set"
             })

    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "active"
    assert goal["objective"] == "all auth tests pass"
    assert goal["pending_command"] == "set"
    assert is_binary(goal["updated_at"])
  end

  test "authoring and execution files are independent", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "exec",
               "pending_command" => "set"
             })

    assert :ok =
             GoalStore.put(workspace, :authoring, %{
               "status" => "active",
               "objective" => "auth",
               "pending_command" => "set"
             })

    assert {:ok, %{"objective" => "exec"}} = GoalStore.read(workspace, :execution)
    assert {:ok, %{"objective" => "auth"}} = GoalStore.read(workspace, :authoring)
  end

  test "clear_pending keeps objective and status", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "x",
               "pending_command" => "set"
             })

    assert :ok = GoalStore.clear_pending(workspace, :execution)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["pending_command"] == nil
    assert goal["objective"] == "x"
  end

  test "delete removes sidecar", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "x",
               "pending_command" => nil
             })

    assert :ok = GoalStore.delete(workspace, :execution)
    assert GoalStore.read(workspace, :execution) == :error
  end

  test "mark_cleared writes cleared state without objective", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "x",
               "pending_command" => "clear"
             })

    assert :ok = GoalStore.mark_cleared(workspace, :execution)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "cleared"
    assert goal["objective"] == nil
    assert goal["pending_command"] == nil
  end

  test "rejects empty objective on put", %{workspace: workspace} do
    assert {:error, :empty_objective} =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "  ",
               "pending_command" => "set"
             })
  end

  test "rejects objective over 4000 bytes", %{workspace: workspace} do
    assert {:error, :objective_too_long} =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => String.duplicate("a", 4001),
               "pending_command" => "set"
             })
  end
end
