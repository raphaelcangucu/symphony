defmodule SymphonyElixir.Claude.GoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.{GoalControl, GoalStore}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    {:ok, project} = Context.ensure_project(%{name: "G", slug: "goal-claude"})
    {:ok, issue} = Context.create_issue("goal-claude", %{"title" => "T", "status" => "Todo"})
    issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
    workspace = Workspace.path_for_issue(issue_ref)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    Application.put_env(:symphony_elixir, :claude_goal_supported_override, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_supported_override) end)

    %{project: project, issue: issue, workspace: workspace}
  end

  test "set_objective writes active mirror with pending set", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, goal} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert goal["status"] == "active"
    assert goal["objective"] == "tests pass"
    assert goal["pending_command"] == "set"
    assert {:ok, stored} = GoalStore.read(workspace, :execution)
    assert stored["objective"] == "tests pass"
  end

  test "set_objective mirrors agent_goal for execution", %{project: project, issue: issue} do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:ok, reloaded} = Context.get_issue(project.slug, issue.identifier)
    assert reloaded.agent_goal == "tests pass"
  end

  test "clear queues pending clear", %{project: project, issue: issue} do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:ok, goal} = GoalControl.clear(project, issue.identifier, :execution)
    assert goal["pending_command"] == "clear"
    assert goal["status"] == "active"
  end

  test "clear without goal is idempotent", %{project: project, issue: issue} do
    assert {:ok, :cleared} = GoalControl.clear(project, issue.identifier, :execution)
  end

  test "pause resume set_budget are unsupported", %{project: project, issue: issue} do
    assert {:error, :unsupported_for_agent} = GoalControl.pause(project, issue.identifier, :execution)
    assert {:error, :unsupported_for_agent} = GoalControl.resume(project, issue.identifier, :execution)
    assert {:error, :unsupported_for_agent} = GoalControl.set_budget(project, issue.identifier, :execution, 1000)
  end

  test "rejects objective over 4000 bytes", %{project: project, issue: issue} do
    big = String.duplicate("a", 4001)
    assert {:error, :objective_too_long} = GoalControl.set_objective(project, issue.identifier, :execution, big)
  end

  test "rejects empty objective", %{project: project, issue: issue} do
    assert {:error, :empty_objective} = GoalControl.set_objective(project, issue.identifier, :execution, "  ")
  end

  test "consume_pending and acknowledge_inject for set", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:inject, :set, "tests pass"} = GoalControl.consume_pending(workspace, :execution)
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, :set)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["pending_command"] == nil
    assert goal["status"] == "active"
  end

  test "acknowledge_inject clear marks cleared", %{project: project, issue: issue, workspace: workspace} do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:ok, _} = GoalControl.clear(project, issue.identifier, :execution)
    assert {:inject, :clear} = GoalControl.consume_pending(workspace, :execution)
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, :clear)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "cleared"
    assert goal["objective"] == nil
  end

  test "requeue_set_if_active when active without pending", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, :set)
    assert :ok = GoalControl.requeue_set_if_active(workspace, :execution)
    assert {:ok, %{"pending_command" => "set", "objective" => "tests pass"}} =
             GoalStore.read(workspace, :execution)
  end

  test "version gate blocks set_objective", %{project: project, issue: issue} do
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, false)
    assert {:error, :claude_goal_unsupported_version} =
             GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
  end

  test "authoring role uses separate sidecar", %{project: project, issue: issue, workspace: workspace} do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :authoring, "draft the plan")
    assert {:ok, %{"objective" => "draft the plan"}} = GoalStore.read(workspace, :authoring)
    assert GoalStore.read(workspace, :execution) == :error
  end

  test "apply_pending_to_prompt prefixes /goal for set and clear", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")

    assert {"/goal tests pass\n\nDo the work", :set} =
             GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)

    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, :set)
    assert {:ok, _} = GoalControl.clear(project, issue.identifier, :execution)

    assert {"/goal clear\n\nDo the work", :clear} =
             GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)

    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, :clear)
    assert {"Do the work", :none} = GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
