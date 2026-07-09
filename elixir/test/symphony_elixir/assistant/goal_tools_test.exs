defmodule SymphonyElixir.Assistant.GoalToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.GoalTools
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    {:ok, project} = Context.ensure_project(%{name: "Distribution", slug: "distributionmachine"})
    {:ok, issue} = Context.create_issue("distributionmachine", %{"title" => "Goal tool issue", "status" => "Todo"})
    {:ok, project: project, issue: issue}
  end

  test "assistant spec requires identifier and action" do
    spec = GoalTools.assistant_tool_spec()
    assert spec["name"] == "manage_codex_goal"
    assert "identifier" in spec["inputSchema"]["required"]
    assert "action" in spec["inputSchema"]["required"]
  end

  test "issue-bound spec omits identifier and defaults to authoring context", %{project: project, issue: issue} do
    assert {:ok, result} =
             GoalTools.execute(
               project.slug,
               %{"action" => "set_objective", "objective" => "Draft the rollout plan"},
               bound_issue_identifier: issue.identifier
             )

    assert result.tool == "manage_codex_goal"
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

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
