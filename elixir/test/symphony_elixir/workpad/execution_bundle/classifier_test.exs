defmodule SymphonyElixir.Workpad.ExecutionBundle.ClassifierTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle.Classifier

  @parent_repo "macro-markets/frontend"

  describe "lab bundle_child_orchestration on (isolated child runs)" do
    @lab_on [bundle_child_orchestration: true]

    test "different repo => child_run (rule :different_repo)" do
      assert {:ok, :child_run, :different_repo} =
               Classifier.classify(%{repo: "macro-markets/backend"}, Keyword.put(@lab_on, :parent_repo, @parent_repo))
    end

    test "independent deliverable => child_run (rule :independent_deliverable)" do
      assert {:ok, :child_run, :independent_deliverable} =
               Classifier.classify(
                 %{repo: @parent_repo, deliverable: "pr"},
                 Keyword.put(@lab_on, :parent_repo, @parent_repo)
               )
    end

    test "same repo + consumes contract => child_run (rule :shared_contract)" do
      assert {:ok, :child_run, :shared_contract} =
               Classifier.classify(
                 %{repo: @parent_repo, consumes: ["api"]},
                 Keyword.put(@lab_on, :parent_repo, @parent_repo)
               )
    end

    test "same repo + produces contract => child_run (rule :shared_contract)" do
      assert {:ok, :child_run, :shared_contract} =
               Classifier.classify(
                 %{repo: @parent_repo, produces: ["api"]},
                 Keyword.put(@lab_on, :parent_repo, @parent_repo)
               )
    end

    test "same repo + depends_on => child_run (rule :shared_contract)" do
      assert {:ok, :child_run, :shared_contract} =
               Classifier.classify(
                 %{repo: @parent_repo, depends_on: ["x"]},
                 Keyword.put(@lab_on, :parent_repo, @parent_repo)
               )
    end

    test "same repo + contract but deliverable pr => child_run (independent wins)" do
      assert {:ok, :child_run, :independent_deliverable} =
               Classifier.classify(
                 %{repo: @parent_repo, consumes: ["api"], deliverable: "pr"},
                 Keyword.put(@lab_on, :parent_repo, @parent_repo)
               )
    end

    test "contract-coupled but parent_repo unknown => child_run (rule :shared_contract)" do
      assert {:ok, :child_run, :shared_contract} =
               Classifier.classify(%{repo: "macro-markets/app", consumes: ["api"]}, @lab_on)
    end

    test "same repo, no isolation => workpad_task (rule :same_repo_inline)" do
      assert {:ok, :workpad_task, :same_repo_inline} =
               Classifier.classify(%{repo: @parent_repo}, Keyword.put(@lab_on, :parent_repo, @parent_repo))
    end
  end

  describe "lab bundle_child_orchestration off (unified parent, default)" do
    @lab_off [bundle_child_orchestration: false]

    test "different repo still => child_run" do
      assert {:ok, :child_run, :different_repo} =
               Classifier.classify(%{repo: "macro-markets/backend"}, Keyword.put(@lab_off, :parent_repo, @parent_repo))
    end

    test "same repo + depends_on => workpad_task (no isolated worktree)" do
      assert {:ok, :workpad_task, :same_repo_inline} =
               Classifier.classify(
                 %{repo: @parent_repo, depends_on: ["foundation"]},
                 Keyword.put(@lab_off, :parent_repo, @parent_repo)
               )
    end

    test "same repo + shared contract => workpad_task" do
      assert {:ok, :workpad_task, :same_repo_inline} =
               Classifier.classify(
                 %{repo: @parent_repo, consumes: ["api"]},
                 Keyword.put(@lab_off, :parent_repo, @parent_repo)
               )
    end

    test "same repo + deliverable pr => workpad_task (ships on parent PR)" do
      assert {:ok, :workpad_task, :same_repo_inline} =
               Classifier.classify(
                 %{repo: @parent_repo, deliverable: "pr"},
                 Keyword.put(@lab_off, :parent_repo, @parent_repo)
               )
    end

    test "parent_repo unknown + contract => workpad_task (cannot prove cross-repo isolation)" do
      assert {:ok, :workpad_task, :same_repo_inline} =
               Classifier.classify(%{repo: "macro-markets/app", consumes: ["api"]}, @lab_off)
    end
  end

  test "unknown repo => ambiguous" do
    assert {:ambiguous, :unknown_repo} =
             Classifier.classify(%{}, parent_repo: @parent_repo, bundle_child_orchestration: true)
  end
end
