defmodule SymphonyElixir.Codex.GoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Mgr", slug: "mgr"})
    {:ok, issue} = Context.create_issue("mgr", %{title: "Goal issue", status: "Todo"})
    {:ok, project: project, issue: issue}
  end

  test "get returns a cached goal from agent_goal when no Codex thread exists yet", %{
    project: project,
    issue: issue
  } do
    {:ok, _} = Context.set_agent_goal(project.slug, issue.identifier, "Ship the admin i18n plan")

    assert {:ok, goal} = GoalControl.get(project, issue.identifier)
    assert goal["objective"] == "Ship the admin i18n plan"
    assert goal["status"] == "pending"
    assert goal["capabilities"] == ["get", "edit", "clear"]
  end

  test "set_objective updates the cached agent_goal without a Codex thread", %{project: project, issue: issue} do
    assert {:ok, goal} =
             GoalControl.set_objective(project, issue.identifier, "Implement phase 1 of the plan")

    assert goal["objective"] == "Implement phase 1 of the plan"
    assert {:ok, reloaded} = Context.get_issue(project.slug, issue.identifier)
    assert reloaded.agent_goal == "Implement phase 1 of the plan"
  end

  test "clear removes the cached agent_goal when Codex goal mode is disabled", %{project: project, issue: issue} do
    {:ok, _} = Context.set_agent_goal(project.slug, issue.identifier, "Temporary goal")

    # Simulate a persisted Codex session without enabling native goal controls.
    {:ok, updated} =
      issue
      |> SymphonyElixir.LocalTracker.IssueRecord.changeset(%{agent_session_id: "thread-resume"})
      |> SymphonyElixir.Repo.update()

    assert {:ok, :cleared} = GoalControl.clear(project, updated.identifier)
    assert {:ok, reloaded} = Context.get_issue(project.slug, updated.identifier)
    assert reloaded.agent_goal in [nil, ""]
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
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
