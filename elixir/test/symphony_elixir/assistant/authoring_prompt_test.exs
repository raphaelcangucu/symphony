defmodule SymphonyElixir.Assistant.AuthoringPromptTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.SubtaskAuthoring
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  test "authoring guidance explains the two execution shapes and tools" do
    text = SubtaskAuthoring.guidance()

    assert text =~ "workpad_task"
    assert text =~ "child_run"
    assert text =~ "create_subtask"
    assert text =~ "set_issue_parent"
    assert text =~ "shared contract"
  end

  test "authoring guidance names the inspection and preview tools" do
    text = SubtaskAuthoring.guidance()

    assert text =~ "classify_execution_unit"
    assert text =~ "preview_execution_plan"
    assert text =~ "define_shared_contract"
  end

  test "default (lab off) guidance describes unified same-tree execution, not isolated worktrees" do
    refute Settings.Lab.bundle_child_orchestration?()
    text = SubtaskAuthoring.guidance()

    assert text =~ "lab.bundle_child_orchestration is OFF"
    assert text =~ "same working tree"
    assert text =~ "feature branch per repo"
    assert text =~ "Do NOT suggest isolated git worktrees"
    refute text =~ "isolated git worktree and branch"
    refute text =~ "opens a PR against the\n    parent's per-repo integration branch"
  end

  test "lab-on guidance describes isolated worktrees and integration branches" do
    assert {:ok, true} = Settings.put("lab", "bundle_child_orchestration", true)
    text = SubtaskAuthoring.guidance()

    assert text =~ "lab.bundle_child_orchestration is ON"
    assert text =~ "isolated git worktree"
    assert text =~ "symphony/{parent}/{repo}"
  end

  test "guidance/1 accepts an explicit orchestration mode override" do
    text = SubtaskAuthoring.guidance(orchestration_mode: :bundle_child)

    assert text =~ "lab.bundle_child_orchestration is ON"
    assert text =~ "isolated git worktree"
  end
end
