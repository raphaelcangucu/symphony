defmodule SymphonyElixir.Orchestrator.ParentCompletionGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      version: 1,
      mode: "bundle",
      parent: "MAC-1",
      units: [
        %{
          id: "api",
          type: :child_run,
          issue: "MAC-2",
          repo: "macro/be",
          produces: [],
          consumes: [],
          depends_on: [],
          deliverable: nil
        },
        %{
          id: "ui",
          type: :child_run,
          issue: "MAC-3",
          repo: "macro/fe",
          produces: [],
          consumes: [],
          depends_on: [],
          deliverable: nil
        }
      ],
      shared_contracts: []
    }
  end

  defp parent, do: %Issue{id: "id-1", identifier: "MAC-1"}

  test "a coordinator parent is held while any child run is not done" do
    held? =
      Orchestrator.parent_completion_held_for_test(parent(),
        bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
        done_units: fn _bundle -> MapSet.new(["api"]) end,
        lab_bundle_child_orchestration: true
      )

    assert held?
  end

  test "a coordinator parent completes once all child runs are done" do
    held? =
      Orchestrator.parent_completion_held_for_test(parent(),
        bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
        done_units: fn _bundle -> MapSet.new(["api", "ui"]) end,
        lab_bundle_child_orchestration: true
      )

    refute held?
  end

  test "a non-coordinator issue (no bundle) completes normally" do
    held? =
      Orchestrator.parent_completion_held_for_test(parent(),
        bundle_loader: fn _ -> :error end,
        done_units: fn _ -> MapSet.new() end
      )

    refute held?
  end

  test "a bundle with only workpad tasks is not held" do
    workpad_only = %ExecutionBundle{
      mode: "bundle",
      units: [
        %{
          id: "copy",
          type: :workpad_task,
          issue: nil,
          repo: nil,
          produces: [],
          consumes: [],
          depends_on: [],
          deliverable: nil
        }
      ],
      shared_contracts: []
    }

    held? =
      Orchestrator.parent_completion_held_for_test(parent(),
        bundle_loader: fn _ -> {:ok, workpad_only} end,
        done_units: fn _ -> MapSet.new() end
      )

    refute held?
  end

  test "a coordinator parent is held from dispatch while any child run is not done" do
    held? =
      Orchestrator.coordinator_parent_dispatch_held_for_test(parent(),
        bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
        done_units: fn _bundle -> MapSet.new(["api"]) end,
        lab_bundle_child_orchestration: true
      )

    assert held?
  end

  test "a coordinator parent is released for dispatch once all child runs are done" do
    held? =
      Orchestrator.coordinator_parent_dispatch_held_for_test(parent(),
        bundle_loader: fn "MAC-1" -> {:ok, bundle()} end,
        done_units: fn _bundle -> MapSet.new(["api", "ui"]) end,
        lab_bundle_child_orchestration: true
      )

    refute held?
  end

  test "a leaf issue with no bundle is never held from dispatch" do
    held? =
      Orchestrator.coordinator_parent_dispatch_held_for_test(parent(),
        bundle_loader: fn _ -> :error end,
        done_units: fn _ -> MapSet.new() end
      )

    refute held?
  end
end
