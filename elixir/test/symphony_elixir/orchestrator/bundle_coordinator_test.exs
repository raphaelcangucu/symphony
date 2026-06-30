defmodule SymphonyElixir.Orchestrator.BundleCoordinatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.BundleCoordinator
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      mode: "bundle",
      parent: "macro/app#1",
      units: [
        %{id: "be", type: :child_run, issue: "macro/be#2", repo: "macro/be", produces: ["api"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "fe", type: :child_run, issue: "macro/fe#3", repo: "macro/fe", produces: [], consumes: ["api"], depends_on: ["be"], deliverable: "pr"},
        %{id: "copy", type: :workpad_task, issue: nil, repo: "macro/app", produces: [], consumes: [], depends_on: [], deliverable: nil}
      ],
      shared_contracts: [%{id: "api", owner_unit: "be", consumers: ["fe"], kind: "graphql", artifact: nil, status: :draft}]
    }
  end

  test "coordinator? is true only for a bundle that has child_run units" do
    assert BundleCoordinator.coordinator?(bundle())
    refute BundleCoordinator.coordinator?(%ExecutionBundle{mode: "single", units: []})
    refute BundleCoordinator.coordinator?(nil)
  end

  test "child_dispatch_specs gates on contracts and emits worktree run opts" do
    specs = BundleCoordinator.child_dispatch_specs(bundle(), %{}, parent_identifier: "MAC-1")

    assert Enum.map(specs, & &1.unit_id) == ["be"]

    [be] = specs
    assert be.repo == "macro/be"
    assert be.issue == "macro/be#2"
    assert Keyword.get(be.run_opts, :worktree) == true
    assert Keyword.get(be.run_opts, :unit_id) == "be"
    assert Keyword.get(be.run_opts, :parent_identifier) == "MAC-1"
    assert Keyword.get(be.run_opts, :worktree_branch) == "feat/be"
    assert Keyword.get(be.run_opts, :bundle_unit).id == "be"
  end

  test "child_dispatch_specs releases the consumer once its contract is ready and producer done" do
    ready = %ExecutionBundle{bundle() | shared_contracts: [%{id: "api", owner_unit: "be", consumers: ["fe"], kind: "graphql", artifact: nil, status: :ready}]}

    specs = BundleCoordinator.child_dispatch_specs(ready, %{"be" => :done}, parent_identifier: "MAC-1")

    assert "fe" in Enum.map(specs, & &1.unit_id)
  end

  test "children_complete? is true only when every child_run is done" do
    refute BundleCoordinator.children_complete?(bundle(), %{"be" => :done})
    assert BundleCoordinator.children_complete?(bundle(), %{"be" => :done, "fe" => :done})
  end

  test "children_all_done? checks every child_run unit id against the done set" do
    refute BundleCoordinator.children_all_done?(bundle(), MapSet.new(["be"]))
    assert BundleCoordinator.children_all_done?(bundle(), MapSet.new(["be", "fe"]))
  end

  test "children_all_done? is true for a bundle with no child_run units" do
    workpad_only = %ExecutionBundle{mode: "bundle", units: [%{id: "x", type: :workpad_task, issue: nil, repo: nil, produces: [], consumes: [], depends_on: [], deliverable: nil}]}
    assert BundleCoordinator.children_all_done?(workpad_only, MapSet.new())
  end

  defp subagent_bundle do
    %ExecutionBundle{
      mode: "bundle",
      parent: "macro/app#1",
      units: [
        %{id: "be", type: :subagent_unit, issue: "macro/app#2", repo: "macro/app", produces: ["api"], consumes: [], depends_on: [], deliverable: nil},
        %{id: "fe", type: :subagent_unit, issue: "macro/app#3", repo: "macro/app", produces: [], consumes: ["api"], depends_on: ["be"], deliverable: nil}
      ],
      shared_contracts: [%{id: "api", owner_unit: "be", consumers: ["fe"], kind: "graphql", artifact: nil, status: :draft}]
    }
  end

  test "subagent_unit bundles are coordinators and dispatch as children (Phase 1 bridge)" do
    assert BundleCoordinator.coordinator?(subagent_bundle())

    specs = BundleCoordinator.child_dispatch_specs(subagent_bundle(), %{}, parent_identifier: "MAC-1")
    assert Enum.map(specs, & &1.unit_id) == ["be"]

    refute BundleCoordinator.children_all_done?(subagent_bundle(), MapSet.new(["be"]))
    assert BundleCoordinator.children_all_done?(subagent_bundle(), MapSet.new(["be", "fe"]))
  end
end
