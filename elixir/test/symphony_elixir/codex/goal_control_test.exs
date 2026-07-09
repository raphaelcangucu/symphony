defmodule SymphonyElixir.Codex.GoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Mgr", slug: "mgr"})
    {:ok, issue} = Context.create_issue("mgr", %{title: "Goal issue", status: "Todo"})
    {:ok, project: project, issue: issue}
  end

  test "get returns nil when no Codex thread exists yet, ignoring agent_goal", %{
    project: project,
    issue: issue
  } do
    # A legacy cached objective must NOT be surfaced as if it were a native goal:
    # the Codex thread is the only source of truth.
    {:ok, _} = Context.set_agent_goal(project.slug, issue.identifier, "Ship the admin i18n plan")

    assert {:ok, nil} = GoalControl.get(project, issue.identifier)
  end

  test "set_objective never caches agent_goal and requires Codex goal mode", %{project: project, issue: issue} do
    # With Codex goal mode disabled (test default) there is no native thread to
    # write to, and the legacy agent_goal column must stay untouched.
    assert {:error, :goals_disabled} =
             GoalControl.set_objective(project, issue.identifier, "Implement phase 1 of the plan")

    assert {:ok, reloaded} = Context.get_issue(project.slug, issue.identifier)
    assert reloaded.agent_goal in [nil, ""]
  end

  test "clear reports cleared and removes any legacy agent_goal when no Codex thread exists", %{
    project: project,
    issue: issue
  } do
    {:ok, _} = Context.set_agent_goal(project.slug, issue.identifier, "Temporary goal")

    assert {:ok, :cleared} = GoalControl.clear(project, issue.identifier)
    assert {:ok, reloaded} = Context.get_issue(project.slug, issue.identifier)
    assert reloaded.agent_goal in [nil, ""]
  end

  test "clear succeeds when goal mode is disabled but a mirrored workspace goal exists", %{
    project: project,
    issue: issue
  } do
    issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
    workspace = Workspace.path_for_issue(issue_ref)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    # Simulate a durable thread + mirrored goal left by authoring handoff while
    # the project keeps Codex goal mode disabled (the default in tests).
    CodexStore.write(workspace, "thread-handoff")
    :ok = CodexStore.put_goal(workspace, %{"objective" => "Stale objective", "status" => "active"})
    {:ok, _} = Context.set_agent_session_id(project.slug, issue.identifier, "thread-handoff")

    assert {:ok, %{"objective" => "Stale objective"}} = CodexStore.read_goal(workspace)

    assert {:ok, :cleared} = GoalControl.clear(project, issue.identifier)

    assert CodexStore.read_goal(workspace) == :error
    assert {:ok, reloaded} = Context.get_issue(project.slug, issue.identifier)
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
