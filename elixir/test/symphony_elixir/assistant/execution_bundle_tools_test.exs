defmodule SymphonyElixir.Assistant.ExecutionBundleToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.ToolExecutor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    :ok
  end

  test "classify_execution_unit returns child_run for a different repo" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/backend",
               "parent_repo" => "macro-markets/frontend"
             })

    assert result.tool == "classify_execution_unit"
    assert result.data.classification == "child_run"
    assert result.data.rule == "different_repo"
  end

  test "classify_execution_unit returns workpad_task for the same repo" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/frontend",
               "parent_repo" => "macro-markets/frontend"
             })

    assert result.data.classification == "workpad_task"
    assert result.data.rule == "same_repo_inline"
  end

  test "classify_execution_unit is exposed in the project board tool specs" do
    names = Enum.map(SymphonyElixir.Assistant.ProjectBoardTools.tool_specs(), & &1["name"])
    assert "classify_execution_unit" in names
  end

  describe "create_subtask" do
    setup do
      {:ok, parent} = Context.create_issue("macro-markets", %{"title" => "Lottery wheel", "status" => "Backlog"})
      %{parent: parent}
    end

    test "auto-classifies an independent deliverable as a child_run", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Backend wheel API",
                 "repo" => "macro-markets/backend",
                 "deliverable" => "pr"
               })

      assert result.tool == "create_subtask"
      assert result.data.unit_type == "child_run"
      assert result.data.parent == parent.identifier
    end

    test "auto-classifies a same-repo subtask as a workpad_task", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Tweak copy",
                 "repo" => "macro-markets/app"
               })

      assert result.data.unit_type == "workpad_task"
    end

    test "links the child under the parent and surfaces parent_identifier", %{parent: parent} do
      {:ok, result} =
        ToolExecutor.execute("macro-markets", "create_subtask", %{
          "parent_identifier" => parent.identifier,
          "title" => "Child issue",
          "repo" => "macro-markets/app"
        })

      {:ok, child} = Context.get_issue("macro-markets", result.data.subtask)
      child_dto = SymphonyElixir.LocalTracker.IssueAdapter.to_dto(child)
      assert child_dto.parent_identifier == parent.identifier
    end

    test "writes the unit into the parent's workpad execution bundle", %{parent: parent} do
      {:ok, result} =
        ToolExecutor.execute("macro-markets", "create_subtask", %{
          "parent_identifier" => parent.identifier,
          "title" => "Child issue",
          "repo" => "macro-markets/backend",
          "deliverable" => "pr"
        })

      {:ok, comments} = Context.list_comments("macro-markets", parent.identifier)
      workpad = Enum.find(comments, &SymphonyElixir.Tracker.Workpad.workpad?(&1.body))
      assert workpad
      {:ok, bundle} = SymphonyElixir.Workpad.ExecutionBundle.parse(workpad.body)
      assert Enum.any?(bundle.units, &(&1.id == result.data.subtask))
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.delete_all(SymphonyElixir.Settings.Setting)

    for table <- [
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
