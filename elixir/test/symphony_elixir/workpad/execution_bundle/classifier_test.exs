defmodule SymphonyElixir.Workpad.ExecutionBundle.ClassifierTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle.Classifier

  @parent_repo "macro-markets/frontend"

  test "different repo => child_run (rule :different_repo)" do
    assert {:ok, :child_run, :different_repo} =
             Classifier.classify(%{repo: "macro-markets/backend"}, parent_repo: @parent_repo)
  end

  test "independent deliverable => child_run (rule :independent_deliverable)" do
    assert {:ok, :child_run, :independent_deliverable} =
             Classifier.classify(%{repo: @parent_repo, deliverable: "pr"}, parent_repo: @parent_repo)
  end

  test "same repo + consumes contract => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, consumes: ["api"]}, parent_repo: @parent_repo)
  end

  test "same repo + produces contract => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, produces: ["api"]}, parent_repo: @parent_repo)
  end

  test "same repo + depends_on => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, depends_on: ["x"]}, parent_repo: @parent_repo)
  end

  test "same repo + contract but deliverable pr => child_run (independent wins)" do
    assert {:ok, :child_run, :independent_deliverable} =
             Classifier.classify(
               %{repo: @parent_repo, consumes: ["api"], deliverable: "pr"},
               parent_repo: @parent_repo
             )
  end

  test "contract-coupled but parent_repo unknown => child_run (rule :shared_contract)" do
    assert {:ok, :child_run, :shared_contract} =
             Classifier.classify(%{repo: "macro-markets/app", consumes: ["api"]}, parent_repo: nil)
  end

  test "same repo, no isolation => workpad_task (rule :same_repo_inline)" do
    assert {:ok, :workpad_task, :same_repo_inline} =
             Classifier.classify(%{repo: @parent_repo}, parent_repo: @parent_repo)
  end

  test "unknown repo => ambiguous" do
    assert {:ambiguous, :unknown_repo} =
             Classifier.classify(%{}, parent_repo: @parent_repo)
  end
end
