defmodule SymphonyElixir.AgentRunnerPromptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.RunContract.RepoState

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
  end

  test "handoff_ready_outcome continues when publish work remains" do
    workspace = create_dirty_workspace!()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace, [
               validate_gate_evaluator: fn _ws -> :satisfied end
             ])
  end

  test "handoff_ready_outcome stops completed when deliverables are clean and validate satisfied" do
    workspace = create_clean_workspace!()

    assert {:stop, :completed} =
             AgentRunner.handoff_ready_outcome(workspace, [
               validate_gate_evaluator: fn _ws -> :satisfied end
             ])
  end

  test "handoff_ready_outcome stops validate_gate incomplete when only environment blockers remain" do
    workspace = create_clean_workspace!()

    violations = [%{kind: :environment_blocked, repo: "backend", detail: "Docker unreachable"}]

    assert {:stop, {:incomplete, {:validate_gate, ^violations}}} =
             AgentRunner.handoff_ready_outcome(workspace, [
               validate_gate_evaluator: fn _ws -> {:violations, violations} end
             ])
  end

  test "handoff_ready_outcome continues when validate still has fixable violations" do
    workspace = create_clean_workspace!()

    assert :continue =
             AgentRunner.handoff_ready_outcome(workspace, [
               validate_gate_evaluator: fn _ws ->
                 {:violations, [%{kind: :e2e_missing, repo: "frontend", detail: "no e2e"}]}
               end
             ])
  end

  defp create_clean_workspace! do
    workspace =
      Path.join(
        System.tmp_dir!(),
        "symphony-handoff-#{System.unique_integer([:positive])}"
      )

    init_repo!(Path.join(workspace, "frontend"))
    workspace
  end

  defp create_dirty_workspace! do
    workspace = create_clean_workspace!()
    File.write!(Path.join([workspace, "frontend", "dirty.txt"]), "pending")
    workspace
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
