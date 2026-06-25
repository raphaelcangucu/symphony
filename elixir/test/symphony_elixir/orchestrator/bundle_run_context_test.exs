defmodule SymphonyElixir.Orchestrator.BundleRunContextTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator

  test "a subtask whose parent checkout is a git repo runs in an isolated worktree" do
    issue = %Issue{identifier: "MAC-2", parent_identifier: "MAC-1", repository_full_name: "macro/be"}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn "MAC-1" -> "/tmp/parent-ws" end,
        git_repo?: fn "/tmp/parent-ws" -> true end
      )

    assert ctx.role == :child
    assert ctx.parent_identifier == "MAC-1"
    assert ctx.unit_id == "MAC-2"
    assert ctx.repo == "macro/be"
    assert Keyword.get(ctx.run_opts, :worktree) == true
    assert Keyword.get(ctx.run_opts, :worktree_repo) == "/tmp/parent-ws"
    assert Keyword.get(ctx.run_opts, :worktree_branch) == "feat/MAC-2"
    assert Keyword.get(ctx.run_opts, :parent_identifier) == "MAC-1"
  end

  test "a subtask falls back to the standard workspace when the parent checkout is not a git repo" do
    issue = %Issue{identifier: "MAC-2", parent_identifier: "MAC-1"}

    ctx =
      Orchestrator.bundle_run_context(issue,
        workspace_resolver: fn _ -> "/tmp/missing" end,
        git_repo?: fn _ -> false end
      )

    assert ctx.role == :child
    assert ctx.parent_identifier == "MAC-1"
    assert ctx.run_opts == []
  end

  test "a non-subtask issue is standalone with no extra run opts" do
    ctx = Orchestrator.bundle_run_context(%Issue{identifier: "MAC-9"})

    assert ctx.role == :standalone
    assert ctx.parent_identifier == nil
    assert ctx.run_opts == []
  end
end
