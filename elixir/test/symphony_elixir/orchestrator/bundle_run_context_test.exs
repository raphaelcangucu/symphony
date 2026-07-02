defmodule SymphonyElixir.Orchestrator.BundleRunContextTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Workpad.ExecutionBundle

  test "a subtask carries its bundle unit and shared contracts so the child prompt is scoped" do
    issue = %Issue{identifier: "MAC-12", parent_identifier: "510"}

    bundle = %ExecutionBundle{
      mode: "bundle",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/back", produces: ["schema"], consumes: [], depends_on: [], deliverable: "branch"}
      ],
      shared_contracts: [%{id: "schema", owner_unit: "MAC-12", consumers: [], kind: "db", artifact: nil, status: :draft}]
    }

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-12" -> "clouapp/back" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> {:ok, bundle} end
      )

    unit = Keyword.get(ctx.run_opts, :bundle_unit)
    assert is_map(unit)
    assert unit[:id] == "MAC-12"
    assert Keyword.get(ctx.run_opts, :shared_contracts) == bundle.shared_contracts
  end

  test "a subtask omits bundle unit opts when the parent bundle does not resolve" do
    issue = %Issue{identifier: "MAC-12", parent_identifier: "510"}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-12" -> "clouapp/back" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> :error end
      )

    refute Keyword.has_key?(ctx.run_opts, :bundle_unit)
    refute Keyword.has_key?(ctx.run_opts, :shared_contracts)
  end

  test "a cross-repo subtask forks off and PRs into the parent's per-repo integration branch" do
    issue = %Issue{identifier: "MAC-12", parent_identifier: "510", repository_full_name: nil}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-12" -> "clouapp/back" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn "/tmp/ws/clouapp/front/510/back" -> true end
      )

    assert ctx.role == :child
    assert ctx.parent_identifier == "510"
    assert ctx.unit_id == "MAC-12"
    assert ctx.repo == "clouapp/back"
    assert Keyword.get(ctx.run_opts, :worktree) == true
    assert Keyword.get(ctx.run_opts, :worktree_repo) == "/tmp/ws/clouapp/front/510/back"
    assert Keyword.get(ctx.run_opts, :worktree_branch) == "feat/MAC-12"
    assert Keyword.get(ctx.run_opts, :parent_identifier) == "510"
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "symphony/510/clouapp-back"
    assert Keyword.get(ctx.run_opts, :pr_base) == "symphony/510/clouapp-back"
    # Different repo than the parent => keeps its own setup/preview.
    assert Keyword.get(ctx.run_opts, :reuse_parent_setup) == false
  end

  test "a same-repo subtask reuses the parent's setup/preview while still PRing into the integration branch" do
    issue = %Issue{identifier: "MAC-20", parent_identifier: "510", repository_full_name: nil}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-20" -> "clouapp/front" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn "/tmp/ws/clouapp/front/510/front" -> true end
      )

    assert Keyword.get(ctx.run_opts, :reuse_parent_setup) == true
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "symphony/510/clouapp-front"
    assert Keyword.get(ctx.run_opts, :pr_base) == "symphony/510/clouapp-front"
  end

  test "a dependent same-repo subtask forks off its predecessor's branch as reference while still PRing into the integration branch" do
    issue = %Issue{identifier: "MAC-13", parent_identifier: "510"}

    bundle = %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/back", produces: ["schema"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "MAC-13", type: :child_run, issue: "MAC-13", repo: "clouapp/back", produces: [], consumes: ["schema"], depends_on: ["MAC-12"], deliverable: "pr"}
      ],
      shared_contracts: []
    }

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-13" -> "clouapp/back" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> {:ok, bundle} end
      )

    # Forks its worktree off the predecessor's branch so the dependency's work is present as a starting reference.
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "feat/MAC-12"
    # But still opens its PR into the parent's per-repo integration branch (the umbrella), NOT the predecessor branch.
    assert Keyword.get(ctx.run_opts, :pr_base) == "symphony/510/clouapp-back"
  end

  test "a dependent forks off the deepest same-repo predecessor in a linear chain" do
    issue = %Issue{identifier: "MAC-14", parent_identifier: "510"}

    bundle = %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/back", produces: ["schema"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "MAC-13", type: :child_run, issue: "MAC-13", repo: "clouapp/back", produces: ["api"], consumes: ["schema"], depends_on: ["MAC-12"], deliverable: "pr"},
        %{id: "MAC-14", type: :child_run, issue: "MAC-14", repo: "clouapp/back", produces: [], consumes: ["api"], depends_on: ["MAC-12", "MAC-13"], deliverable: "pr"}
      ],
      shared_contracts: []
    }

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-14" -> "clouapp/back" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> {:ok, bundle} end
      )

    # MAC-13 already contains MAC-12 (it forked from it), so MAC-14 forks off MAC-13 to inherit the whole chain.
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "feat/MAC-13"
    assert Keyword.get(ctx.run_opts, :pr_base) == "symphony/510/clouapp-back"
  end

  test "a dependent whose predecessor is cross-repo forks off the integration branch (not the other repo's branch)" do
    issue = %Issue{identifier: "MAC-13", parent_identifier: "510"}

    bundle = %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/front", produces: ["theme"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "MAC-13", type: :child_run, issue: "MAC-13", repo: "clouapp/back", produces: [], consumes: ["theme"], depends_on: ["MAC-12"], deliverable: "pr"}
      ],
      shared_contracts: []
    }

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-13" -> "clouapp/back" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> {:ok, bundle} end
      )

    # The predecessor's branch lives in a different repo checkout, so fall back to this repo's integration branch.
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "symphony/510/clouapp-back"
    assert Keyword.get(ctx.run_opts, :pr_base) == "symphony/510/clouapp-back"
  end

  test "an explicit unit pr_base overrides the derived integration branch" do
    issue = %Issue{identifier: "MAC-12", parent_identifier: "510"}

    bundle = %ExecutionBundle{
      mode: "bundle",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/back", produces: [], consumes: [], depends_on: [], deliverable: "pr", pr_base: "release/next"}
      ],
      shared_contracts: []
    }

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "510" -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn "510", "MAC-12" -> "clouapp/back" end,
        parent_repo_resolver: fn "510" -> "clouapp/front" end,
        git_repo?: fn _ -> true end,
        bundle_resolver: fn "510" -> {:ok, bundle} end
      )

    assert Keyword.get(ctx.run_opts, :pr_base) == "release/next"
    assert Keyword.get(ctx.run_opts, :worktree_base_branch) == "release/next"
  end

  test "a subtask falls back to the parent container when no bundle unit repo resolves" do
    issue = %Issue{identifier: "MAC-2", parent_identifier: "MAC-1", repository_full_name: "macro/be"}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "MAC-1" -> "/tmp/parent-ws" end,
        unit_repo_resolver: fn _, _ -> nil end,
        git_repo?: fn "/tmp/parent-ws" -> true end
      )

    assert ctx.role == :child
    assert ctx.repo == "macro/be"
    assert Keyword.get(ctx.run_opts, :worktree_repo) == "/tmp/parent-ws"
    assert Keyword.get(ctx.run_opts, :worktree_branch) == "feat/MAC-2"
  end

  test "a subtask falls back to the standard workspace when the resolved checkout is not a git repo" do
    issue = %Issue{identifier: "MAC-12", parent_identifier: "510"}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn _ -> "/tmp/ws/clouapp/front/510" end,
        unit_repo_resolver: fn _, _ -> "clouapp/back" end,
        git_repo?: fn _ -> false end
      )

    assert ctx.role == :child
    assert ctx.parent_identifier == "510"
    assert ctx.run_opts == []
  end

  test "a non-subtask issue is standalone with no extra run opts" do
    ctx = Orchestrator.bundle_run_context(%Issue{identifier: "MAC-9"})

    assert ctx.role == :standalone
    assert ctx.parent_identifier == nil
    assert ctx.run_opts == []
  end

  test "a parent whose workpad holds a coordinator bundle runs as :parent and carries the bundle" do
    bundle = %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/back", produces: ["c"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "MAC-13", type: :child_run, issue: "MAC-13", repo: "clouapp/back", produces: [], consumes: ["c"], depends_on: ["MAC-12"], deliverable: "pr"}
      ],
      shared_contracts: [%{id: "c", owner_unit: "MAC-12", consumers: ["MAC-13"], kind: "db", artifact: nil, status: :ready}]
    }

    ctx =
      Orchestrator.bundle_run_context(%Issue{identifier: "510"},
        bundle_resolver: fn "510" -> {:ok, bundle} end,
        lab_bundle_child_orchestration: true
      )

    assert ctx.role == :parent
    assert ctx.parent_identifier == nil
    assert ctx.unit_id == nil
    # The coordinator prompt is injected from run_opts[:bundle]; never run the parent as a standalone implementer.
    assert Keyword.get(ctx.run_opts, :bundle) == bundle
    # Child issues the coordinator sequences/integrates (dispatchable child_run units).
    assert ctx.child_identifiers == ["MAC-12", "MAC-13"]
  end

  test "a parent whose bundle is workpad_task-only stays standalone (no child_run units to coordinate)" do
    bundle = %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "t1", type: :workpad_task, issue: nil, repo: "clouapp/front", produces: [], consumes: [], depends_on: [], deliverable: "inline"}
      ],
      shared_contracts: []
    }

    ctx = Orchestrator.bundle_run_context(%Issue{identifier: "510"}, bundle_resolver: fn "510" -> {:ok, bundle} end)

    assert ctx.role == :standalone
    assert ctx.child_identifiers == []
    assert ctx.run_opts == []
  end
end
