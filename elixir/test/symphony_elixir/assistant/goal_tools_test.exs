defmodule SymphonyElixir.Assistant.GoalToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.GoalTools
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()

    workspace_root =
      Path.join(System.tmp_dir!(), "goal-tools-workspaces-#{System.unique_integer([:positive])}")

    workflow_file = Path.join(workspace_root, "WORKFLOW.md")
    File.mkdir_p!(workspace_root)

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: workspace_root
    )

    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(workspace_root)
    end)

    {:ok, project} = Context.ensure_project(%{name: "Distribution", slug: "distributionmachine"})
    {:ok, issue} = Context.create_issue("distributionmachine", %{"title" => "Goal tool issue", "status" => "Todo"})
    {:ok, project: project, issue: issue, workflow_file: workflow_file}
  end

  test "assistant spec permits authoring without identifier and requires action" do
    spec = GoalTools.assistant_tool_spec()
    assert spec["name"] == "goal"
    refute "identifier" in spec["inputSchema"]["required"]
    assert "action" in spec["inputSchema"]["required"]
  end

  test "issue-bound spec omits identifier and defaults to authoring context", %{
    project: project,
    issue: issue,
    workflow_file: workflow_file
  } do
    enable_codex_goals!(workflow_file)
    workspace = Workspace.path_for_issue(%{id: issue.id, identifier: issue.identifier, project_slug: project.slug})
    File.mkdir_p!(workspace)

    {:ok, thread} =
      SymphonyElixir.Assistant.History.ensure_issue_thread(project.slug, issue.identifier, %{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    assert {:ok, result} =
             GoalTools.execute(
               project.slug,
               %{"action" => "set_objective", "objective" => "Draft the rollout plan"},
               bound_issue_identifier: issue.identifier,
               assistant_thread_id: thread.id
             )

    assert result.tool == "goal"
    assert result.data.context == "authoring"
    assert result.data.objective == "Draft the rollout plan"
    assert result.data.enabled == true
  end

  test "execution clear removes mirrored workspace goals when goal mode is disabled", %{
    project: project,
    issue: issue
  } do
    issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
    workspace = Workspace.path_for_issue(issue_ref)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    CodexStore.write(workspace, "00000000-0000-4000-8000-000000000001")
    :ok = CodexStore.put_goal(workspace, %{"objective" => "Stale", "status" => "active"})
    {:ok, _} = Context.set_agent_session_id(project.slug, issue.identifier, "00000000-0000-4000-8000-000000000001")

    assert {:ok, result} =
             GoalTools.execute(
               project.slug,
               %{"identifier" => issue.identifier, "action" => "clear", "context" => "execution"}
             )

    assert result.data.cleared == true
    assert CodexStore.read_goal(workspace) == :error
  end

  test "returns missing identifier for project chat calls without identifier", %{project: project} do
    assert {:error, :missing_identifier} =
             GoalTools.execute(project.slug, %{"action" => "get", "context" => "execution"})
  end

  test "execution uses the validated bound issue identifier instead of model input", %{
    project: project,
    issue: issue
  } do
    assert {:ok, result} =
             GoalTools.execute(
               project.slug,
               %{
                 "identifier" => "WRONG-999",
                 "action" => "get",
                 "context" => "execution",
                 "agent" => "claude"
               },
               bound_issue_identifier: issue.identifier
             )

    assert result.data.identifier == issue.identifier
    assert result.message =~ issue.identifier
    refute result.message =~ "WRONG-999"
  end

  test "authoring without identifier targets the exact bound issue session thread", %{
    project: project,
    issue: issue,
    workflow_file: workflow_file
  } do
    enable_codex_goals!(workflow_file)
    workspace = Path.join(System.tmp_dir!(), "goal-tools-session-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, canonical} =
      SymphonyElixir.Assistant.History.ensure_issue_thread(project.slug, issue.identifier, %{
        workspace_path: workspace
      })

    {:ok, session} =
      SymphonyElixir.Assistant.History.create_issue_session_thread(project.slug, issue.identifier, %{
        workspace_path: workspace,
        agent_kind: "codex"
      })

    File.mkdir_p!(session.workspace_path)

    assert {:ok, result} =
             GoalTools.execute(
               project.slug,
               %{"action" => "set_objective", "context" => "authoring", "objective" => "Session objective"},
               assistant_thread_id: session.id,
               bound_issue_identifier: issue.identifier
             )

    assert result.data.identifier == nil
    assert result.data.objective == "Session objective"

    {:ok, reloaded_session} = SymphonyElixir.Assistant.History.get_thread(session.id)
    {:ok, reloaded_canonical} = SymphonyElixir.Assistant.History.get_thread(canonical.id)
    assert SymphonyElixir.Assistant.History.thread_goal_objective(reloaded_session) == "Session objective"
    assert SymphonyElixir.Assistant.History.thread_goal_objective(reloaded_canonical) == nil
  end

  test "execution still requires identifier when a thread is bound", %{project: project} do
    {:ok, thread} =
      SymphonyElixir.Assistant.History.create_project_session_thread(project.slug, %{
        workspace_path: Path.join(System.tmp_dir!(), "goal-tools-project-session")
      })

    assert {:error, :missing_identifier} =
             GoalTools.execute(
               project.slug,
               %{"action" => "get", "context" => "execution"},
               assistant_thread_id: thread.id
             )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp enable_codex_goals!(workflow_file) do
    workflow_file
    |> File.read!()
    |> String.replace("codex:\n", "codex:\n  goals_enabled: true\n", global: false)
    |> then(&File.write!(workflow_file, &1))
  end
end
