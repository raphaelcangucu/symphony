defmodule SymphonyElixir.AgentRunnerPromptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.RunContract.RepoState
  alias SymphonyElixir.Workpad.ExecutionContract

  defp states_with_work do
    [struct!(RepoState, %{path: "/w/frontend", name: "frontend", branch: "docs/gam-3", ahead_count: 3, upstream?: false})]
  end

  test "resume_section lists prior work and forbids restart" do
    text = AgentRunner.resume_section(states_with_work())
    assert text =~ "Resume notice"
    assert text =~ "docs/gam-3"
    assert text =~ "Do NOT restart from scratch"
    assert text =~ "VALIDATE/evidence only when"
  end

  test "continuation_prompt embeds deliverable state" do
    text = AgentRunner.continuation_prompt(2, 20, states_with_work())
    assert text =~ "continuation turn #2 of 20"
    assert text =~ "commits_ahead=3"
    assert text =~ "pull request"
    assert text =~ "evidence` skill"
    assert text =~ "VALIDATE-only"
    assert text =~ "do **not** loop"
    assert text =~ "validation/evidence/commit"
  end

  test "continuation_prompt names the next incomplete plan task when a contract is present" do
    text = AgentRunner.continuation_prompt(2, 20, states_with_work(), execution_contract: incomplete_contract())

    assert text =~ "Next incomplete plan task"
    assert text =~ "Task 2: Not done"
  end

  test "handoff_ready_outcome continues when publish work remains" do
    workspace = create_dirty_workspace!()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace,
               validate_gate_evaluator: fn _ws -> :satisfied end
             )
  end

  test "handoff_ready_outcome stops completed when deliverables are clean and validate satisfied" do
    workspace = create_clean_workspace!()

    assert {:stop, :completed} =
             AgentRunner.handoff_ready_outcome(workspace,
               validate_gate_evaluator: fn _ws -> :satisfied end
             )
  end

  test "handoff_ready_outcome continues when plan scope is incomplete even if deliverables are clean" do
    workspace = create_clean_workspace!()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace,
               execution_contract: incomplete_contract(),
               validate_gate_evaluator: fn _ws -> :satisfied end
             )
  end

  test "open PR does not stop an in-progress github issue while plan scope is incomplete" do
    issue = %Issue{identifier: "DIS-6", state: "In Progress"}
    project_config = struct!(ProjectConfig, %{project_id: 1, project_slug: "distributionmachine", tracker_kind: "github"})

    refute AgentRunner.open_pr_should_stop_turns?(issue, project_config, execution_contract: incomplete_contract())
  end

  test "DIS-6 regression does not treat partial plan slice as final completion" do
    workspace = create_clean_workspace!()
    issue = %Issue{identifier: "DIS-6", state: "In Progress"}
    project_config = struct!(ProjectConfig, %{project_id: 1, project_slug: "distributionmachine", tracker_kind: "github"})
    contract = dis6_partial_contract()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace,
               execution_contract: contract,
               validate_gate_evaluator: fn _ws -> :satisfied end
             )

    refute AgentRunner.open_pr_should_stop_turns?(issue, project_config, execution_contract: contract)
  end

  test "handoff_ready_outcome stops validate_gate incomplete when only environment blockers remain" do
    workspace = create_clean_workspace!()

    violations = [%{kind: :environment_blocked, repo: "backend", detail: "Docker unreachable"}]

    assert {:stop, {:incomplete, {:validate_gate, ^violations}}} =
             AgentRunner.handoff_ready_outcome(workspace,
               validate_gate_evaluator: fn _ws -> {:violations, violations} end
             )
  end

  test "handoff_ready_outcome continues when validate still has fixable violations" do
    workspace = create_clean_workspace!()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace,
               validate_gate_evaluator: fn _ws ->
                 {:violations, [%{kind: :e2e_missing, repo: "frontend", detail: "no e2e"}]}
               end
             )
  end

  defp create_clean_workspace! do
    workspace =
      Path.join(
        System.tmp_dir!(),
        "symphony-handoff-#{System.unique_integer([:positive])}"
      )

    File.rm_rf!(workspace)
    init_repo!(Path.join(workspace, "frontend"))
    workspace
  end

  defp create_dirty_workspace! do
    workspace = create_clean_workspace!()
    File.write!(Path.join([workspace, "frontend", "dirty.txt"]), "pending")
    workspace
  end

  defp incomplete_contract do
    struct!(ExecutionContract, %{
      source_plan: "docs/superpowers/plans/demo.md",
      mode: "full-plan",
      scope_status: "in_progress",
      tasks: [%{status: :pending, title: "Task 2: Not done", remaining: []}],
      scope_complete?: false,
      final_validate_allowed?: false,
      final_publish_allowed?: false,
      next_incomplete: %{status: :pending, title: "Task 2: Not done", remaining: []}
    })
  end

  defp dis6_partial_contract do
    struct!(ExecutionContract, %{
      source_plan: "docs/superpowers/plans/2026-06-23-dis-6-admin-i18n-complete-plan.md",
      mode: "full-plan",
      scope_status: "in_progress",
      tasks: [
        %{status: :done, title: "Task 1: Stabilize The Existing First Slice", remaining: []},
        %{status: :done, title: "Task 2: Add Settings And System Namespace", remaining: []},
        %{status: :partial, title: "Task 3: Add Tasks, Review, And Runs Namespace", remaining: ["TasksList.jsx", "TasksBoard.jsx"]},
        %{status: :pending, title: "Task 4: Add Distribution Namespace", remaining: []},
        %{status: :pending, title: "Task 5: Add Content Namespace", remaining: []},
        %{status: :pending, title: "Task 6: Add Keywords And Research Namespace", remaining: []},
        %{status: :pending, title: "Task 7: Add Market And Intel Namespace", remaining: []},
        %{status: :pending, title: "Task 8: Add Engagement And Clips Namespace", remaining: []},
        %{status: :done, title: "Task 9: Add Formatting Helpers", remaining: []},
        %{status: :done, title: "Task 10: Add Guardrails And Coverage Report", remaining: []},
        %{status: :pending, title: "Task 11: Final Verification And Issue Evidence", remaining: []}
      ],
      scope_complete?: false,
      final_validate_allowed?: false,
      final_publish_allowed?: false,
      next_incomplete: %{status: :partial, title: "Task 3: Add Tasks, Review, And Runs Namespace", remaining: ["TasksList.jsx", "TasksBoard.jsx"]}
    })
  end

  defp init_repo!(repo) do
    File.mkdir_p!(repo)
    System.cmd("git", ["init"], cd: repo, stderr_to_stdout: true)
    File.write!(Path.join(repo, "README.md"), "ok")
    System.cmd("git", ["add", "README.md"], cd: repo, stderr_to_stdout: true)

    System.cmd(
      "git",
      ["commit", "-m", "init"],
      cd: repo,
      stderr_to_stdout: true,
      env: git_env()
    )
  end

  defp git_env do
    [
      {"GIT_AUTHOR_NAME", "t"},
      {"GIT_COMMITTER_NAME", "t"},
      {"GIT_AUTHOR_EMAIL", "t@t.com"},
      {"GIT_COMMITTER_EMAIL", "t@t.com"}
    ]
  end
end
