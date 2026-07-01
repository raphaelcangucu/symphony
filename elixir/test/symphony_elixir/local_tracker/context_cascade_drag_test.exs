defmodule SymphonyElixir.LocalTracker.ContextCascadeDragTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, WorkflowStatus}

  describe "cascade_drag_subtask?/3" do
    setup do
      target = %WorkflowStatus{id: 3, name: "In Progress", position: 3, is_terminal: false}
      wait_states = ["Human Review"]
      {:ok, target: target, wait_states: wait_states}
    end

    test "drags a backlog child behind the parent's target", %{target: target, wait_states: wait_states} do
      child = %IssueRecord{id: 1, status_id: 1, status: %WorkflowStatus{id: 1, name: "Backlog", position: 0, is_terminal: false}}

      assert Context.cascade_drag_subtask?(child, target, wait_states)
    end

    test "skips a child already in the target status", %{target: target, wait_states: wait_states} do
      child = %IssueRecord{id: 1, status_id: 3, status: target}

      refute Context.cascade_drag_subtask?(child, target, wait_states)
    end

    test "skips a child in a configured wait state", %{target: target, wait_states: wait_states} do
      child = %IssueRecord{
        id: 1,
        status_id: 4,
        status: %WorkflowStatus{id: 4, name: "Human Review", position: 4, is_terminal: false}
      }

      refute Context.cascade_drag_subtask?(child, target, wait_states)
    end

    test "skips a terminal child", %{target: target, wait_states: wait_states} do
      child = %IssueRecord{
        id: 1,
        status_id: 7,
        status: %WorkflowStatus{id: 7, name: "Done", position: 7, is_terminal: true}
      }

      refute Context.cascade_drag_subtask?(child, target, wait_states)
    end

    test "skips a child more advanced than the parent's target by workflow position", %{
      target: target,
      wait_states: wait_states
    } do
      child = %IssueRecord{
        id: 1,
        status_id: 6,
        status: %WorkflowStatus{id: 6, name: "Merging", position: 6, is_terminal: false}
      }

      refute Context.cascade_drag_subtask?(child, target, wait_states)
    end
  end
end
