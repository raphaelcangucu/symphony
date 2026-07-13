defmodule SymphonyElixir.AgentGoalTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentGoal
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    {:ok, project} = Context.ensure_project(%{name: "AG", slug: "agent-goal"})
    {:ok, issue} = Context.create_issue("agent-goal", %{"title" => "T", "status" => "Todo"})
    issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
    workspace = Workspace.path_for_issue(issue_ref)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    Application.put_env(:symphony_elixir, :claude_goal_supported_override, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_supported_override) end)

    %{project: project, issue: issue, workspace: workspace}
  end

  test "routes execution set_objective to Claude when agent is claude", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    assert {:ok, %{goal: goal}} =
             AgentGoal.execute(project, issue.identifier, "set_objective", "execution", %{
               "objective" => "tests pass",
               "agent" => "claude"
             })

    assert goal["objective"] == "tests pass"
    assert {:ok, %{"pending_command" => "set"}} = GoalStore.read(workspace, :execution)
  end

  test "routes execution get to Claude mirror", %{project: project, issue: issue} do
    assert {:ok, _} =
             AgentGoal.execute(project, issue.identifier, "set_objective", "execution", %{
               "objective" => "tests pass",
               "agent" => "claude"
             })

    assert {:ok, %{goal: %{"objective" => "tests pass"}}} =
             AgentGoal.execute(project, issue.identifier, "get", "execution", %{"agent" => "claude"})
  end

  test "cursor set_objective is unsupported", %{project: project, issue: issue} do
    assert {:error, :unsupported_for_agent} =
             AgentGoal.execute(project, issue.identifier, "set_objective", "execution", %{
               "objective" => "tests pass",
               "agent" => "cursor"
             })
  end

  test "claude pause is unsupported", %{project: project, issue: issue} do
    assert {:error, :unsupported_for_agent} =
             AgentGoal.execute(project, issue.identifier, "pause", "execution", %{"agent" => "claude"})
  end

  test "authoring context uses authoring role for Claude", %{
    project: project,
    issue: issue,
    workspace: workspace
  } do
    {:ok, thread} =
      SymphonyElixir.Assistant.History.create_issue_session_thread(project.slug, issue.identifier, %{
        workspace_path: workspace,
        agent_kind: "claude"
      })

    assert {:ok, %{goal: goal}} =
             AgentGoal.execute(
               project,
               issue.identifier,
               "set_objective",
               "authoring",
               %{
                 "objective" => "draft the plan",
                 "agent" => "claude"
               },
               assistant_thread_id: thread.id,
               bound_issue_identifier: issue.identifier
             )

    assert goal.objective == "draft the plan"
    assert {:ok, _} = GoalStore.read(workspace, :authoring, thread.id)
    assert GoalStore.read(workspace, :execution) == :error
  end

  test "codex execution set_objective still hits Codex GoalControl", %{project: project, issue: issue} do
    # Default test env has Codex goals disabled → expect goals_disabled, proving Codex path.
    assert {:error, :goals_disabled} =
             AgentGoal.execute(project, issue.identifier, "set_objective", "execution", %{
               "objective" => "ship it",
               "agent" => "codex"
             })
  end

  test "resolves agent from issue settings when not passed", %{project: project, issue: issue, workspace: workspace} do
    :ok = Context.put_agent_settings(project.slug, issue.identifier, %{agent_kind: "claude"})

    assert {:ok, %{goal: _}} =
             AgentGoal.execute(project, issue.identifier, "set_objective", "execution", %{
               "objective" => "from settings"
             })

    assert {:ok, %{"objective" => "from settings"}} = GoalStore.read(workspace, :execution)
  end

  test "authoring rejects an archived current thread", %{workspace: workspace} do
    {:ok, thread} = History.create_freeform_thread(%{workspace_path: workspace, agent_kind: "codex"})
    {:ok, archived} = History.archive_thread(thread.id)

    assert {:error, :assistant_thread_not_active} =
             AgentGoal.execute(
               nil,
               nil,
               "set_objective",
               "authoring",
               %{"objective" => "must not activate"},
               assistant_thread_id: archived.id
             )
  end

  test "authoring rejects a thread outside the current project context", %{project: project, workspace: workspace} do
    {:ok, other_project} = Context.ensure_project(%{name: "Other", slug: "other-agent-goal"})

    {:ok, thread} =
      History.create_project_session_thread(other_project.slug, %{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    assert {:error, :assistant_thread_context_mismatch} =
             AgentGoal.execute(
               project,
               nil,
               "set_objective",
               "authoring",
               %{"objective" => "wrong project"},
               assistant_thread_id: thread.id
             )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
