defmodule SymphonyElixir.Orchestrator.UnifiedModeDispatchTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp coordinator_bundle do
    %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/front", produces: [], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "MAC-13", type: :child_run, issue: "MAC-13", repo: "clouapp/back", produces: [], consumes: [], depends_on: ["MAC-12"], deliverable: "pr"}
      ],
      shared_contracts: []
    }
  end

  test "coordinator bundle with lab flag off runs as :parent_unified" do
    bundle = coordinator_bundle()

    ctx =
      Orchestrator.bundle_run_context(%Issue{identifier: "510"},
        bundle_resolver: fn "510" -> {:ok, bundle} end,
        lab_bundle_child_orchestration: false,
        sub_issue_loader: fn _slug, _parent -> [] end
      )

    assert ctx.role == :parent_unified
    assert Keyword.get(ctx.run_opts, :bundle) == bundle
    assert Keyword.get(ctx.run_opts, :unified_parent) == true
    assert Keyword.get(ctx.run_opts, :feature_branch) == "feat/510"
    refute ctx.role == :parent
  end

  test "child_run issues are held from orchestrator dispatch when parent is unified" do
    child = %Issue{identifier: "MAC-12", id: "c1", parent_identifier: "510"}

    held =
      Orchestrator.held_child_issue_ids_for_test([child],
        bundle_loader: fn "510" -> {:ok, coordinator_bundle()} end,
        lab_bundle_child_orchestration: false
      )

    assert MapSet.member?(held, "c1")
  end

  test "child_run issues are not blanket-held when lab flag is on" do
    child = %Issue{identifier: "MAC-12", id: "c1", parent_identifier: "510"}

    held =
      Orchestrator.held_child_issue_ids_for_test([child],
        bundle_loader: fn "510" -> {:ok, coordinator_bundle()} end,
        lab_bundle_child_orchestration: true
      )

    refute MapSet.member?(held, "c1")
  end
end
