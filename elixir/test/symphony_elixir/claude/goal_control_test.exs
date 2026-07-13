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

  test "set_objective writes canonical running mirror with pending set", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, goal} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert goal["status"] == "running"
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
    assert goal["status"] == "running"
  end

  test "clear without goal is idempotent", %{project: project, issue: issue} do
    assert {:ok, :cleared} = GoalControl.clear(project, issue.identifier, :execution)
  end

  test "get and clear return explicit errors for malformed sidecars", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    path = GoalStore.path(workspace, :execution)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "{not-json")

    assert {:error, :invalid_goal_store} = GoalControl.get(project, issue.identifier, :execution)
    assert {:error, :invalid_goal_store} = GoalControl.clear(project, issue.identifier, :execution)
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
    {_, set_token} = GoalControl.apply_pending_to_prompt("work", workspace, :execution)
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, set_token, nil)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["pending_command"] == nil
    assert goal["status"] == "running"
  end

  test "acknowledge_inject clear marks completed", %{project: project, issue: issue, workspace: workspace} do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:ok, _} = GoalControl.clear(project, issue.identifier, :execution)
    assert {:inject, :clear} = GoalControl.consume_pending(workspace, :execution)
    {_, clear_token} = GoalControl.apply_pending_to_prompt("work", workspace, :execution)
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, clear_token, nil)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "completed"
    assert goal["objective"] == nil
  end

  test "requeue_set_if_active when active without pending", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    {_, set_token} = GoalControl.apply_pending_to_prompt("work", workspace, :execution)
    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, set_token, nil)
    assert :ok = GoalControl.requeue_set_if_active(workspace, :execution)

    assert {:ok, %{"pending_command" => "set", "objective" => "tests pass"}} =
             GoalStore.read(workspace, :execution)
  end

  test "version gate blocks set_objective", %{project: project, issue: issue} do
    Application.put_env(:symphony_elixir, :claude_goal_supported_override, false)

    assert {:error, :claude_goal_unsupported_version} =
             GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
  end

  test "issue-keyed and unscoped authoring APIs require an assistant thread", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:error, :assistant_thread_id_required} =
             GoalControl.set_objective(project, issue.identifier, :authoring, "draft the plan")

    assert {:error, :assistant_thread_id_required} =
             GoalControl.get(project, issue.identifier, :authoring)

    assert {:error, :assistant_thread_id_required} =
             GoalControl.clear(project, issue.identifier, :authoring)

    assert_raise ArgumentError, ~r/assistant_thread_id/, fn ->
      GoalControl.apply_pending_to_prompt("Work", workspace, :authoring)
    end
  end

  test "apply_pending_to_prompt prefixes /goal for set and clear", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")

    assert {"/goal tests pass\n\nDo the work", {:set, set_revision}} =
             GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)

    assert is_binary(set_revision)

    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, {:set, set_revision}, nil)
    assert {:ok, _} = GoalControl.clear(project, issue.identifier, :execution)

    assert {"/goal clear\n\nDo the work", {:clear, clear_revision}} =
             GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)

    assert is_binary(clear_revision)

    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, {:clear, clear_revision}, nil)
    assert {"Do the work", :none} = GoalControl.apply_pending_to_prompt("Do the work", workspace, :execution)
  end

  test "multiline objectives remain one retryable goal command", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    objective = "Audit authentication\nRun the focused tests\nReport failures"
    assert {:ok, _goal} = GoalControl.set_objective(project, issue.identifier, :execution, objective)

    assert {prompt, {:set, revision}} =
             GoalControl.apply_pending_to_prompt("Continue the work", workspace, :execution)

    assert prompt == "/goal #{objective}\n\nContinue the work"
    assert is_binary(revision)

    assert :ok = GoalControl.acknowledge_inject(workspace, :execution, {:set, revision}, nil)
    assert :ok = GoalControl.requeue_set_if_active(workspace, :execution)

    assert {retry_prompt, {:set, retry_revision}} =
             GoalControl.apply_pending_to_prompt("Retry after interruption", workspace, :execution)

    assert retry_prompt == "/goal #{objective}\n\nRetry after interruption"
    refute retry_revision == revision
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
