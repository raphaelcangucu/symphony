defmodule SymphonyElixir.Assistant.ProjectBoardToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{ProjectBoardTools, ToolExecutor}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "freeform list_issues requires project_slug and lists issues" do
    {:ok, _} = Context.ensure_project(%{name: "Board", slug: "board"})
    {:ok, _} = Context.create_issue("board", %{"title" => "Task A", "status" => "Todo"})

    assert {:ok, result} =
             ProjectBoardTools.execute("list_issues", %{"project_slug" => "board", "limit" => 10})

    assert result.tool == "list_issues"
    assert length(result.data.issues) == 1
  end

  test "create_tracker_project creates a local project without project_slug" do
    assert {:ok, result} =
             ProjectBoardTools.execute("create_tracker_project", %{
               "name" => "New Board",
               "slug" => "new-board"
             })

    assert result.tool == "create_tracker_project"
    assert result.data.slug == "new-board"
    assert {:ok, _} = Context.get_project("new-board")
  end

  test "freeform executor delegates board tools" do
    {:ok, _} = Context.ensure_project(%{name: "Gamma", slug: "gamma"})
    {:ok, _} = Context.create_issue("gamma", %{"title" => "One", "status" => "Todo"})

    response = ToolExecutor.freeform_codex_tool_executor().("list_issues", %{"project_slug" => "gamma"})

    assert response["success"] == true
    assert response["toolResult"]["tool"] == "list_issues"
  end

  test "tool specs put discovery before board tools" do
    names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"])
    discovery_idx = Enum.find_index(names, &(&1 == "list_tracker_projects"))
    board_idx = Enum.find_index(names, &(&1 == "list_issues"))
    assert discovery_idx < board_idx
  end

  test "board tool specs require project_slug" do
    spec = Enum.find(ProjectBoardTools.tool_specs(), &(&1["name"] == "move_issue"))
    assert "project_slug" in spec["inputSchema"]["required"]
  end

  test "freeform specs include setup and dev_env with project_slug" do
    names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"])
    assert "manage_dev_env" in names
    assert "scan_project_setup" in names
    assert "suggest_project_setup" in names

    dev_env = Enum.find(ToolExecutor.freeform_tool_specs(), &(&1["name"] == "manage_dev_env"))
    assert "project_slug" in dev_env["inputSchema"]["required"]
  end

  test "tool_specs builds schemas for tools without a required list (e.g. get_project)" do
    assert Enum.all?(ProjectBoardTools.tool_specs(), &is_map/1)

    get_project = Enum.find(ProjectBoardTools.tool_specs(), &(&1["name"] == "get_project"))
    assert "project_slug" in get_project["inputSchema"]["required"]
    assert Map.has_key?(get_project["inputSchema"]["properties"], "project_slug")

    list_repos = Enum.find(ProjectBoardTools.tool_specs(), &(&1["name"] == "list_project_repositories"))
    assert "project_slug" in list_repos["inputSchema"]["required"]
  end

  test "update_project_repositories is exposed through the freeform board tools" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Board Repos",
        "slug" => "board-repos",
        "tracker" => %{"kind" => "local"},
        "workflow_statuses" => [%{"name" => "Todo", "category" => "todo", "position" => 1, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    response =
      ToolExecutor.freeform_codex_tool_executor().("update_project_repositories", %{
        "project_slug" => "board-repos",
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "board-repos/web", "role" => "frontend"}
        ]
      })

    assert response["success"] == true
    assert response["toolResult"]["tool"] == "update_project_repositories"
    assert hd(response["toolResult"]["data"]["repositories"])["github_full_name"] == "acme/web"
  end

  test "freeform end-to-end: list projects, list issues, move issue (macro-markets scenario)" do
    {:ok, _} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _} = Context.create_issue("macro-markets", %{"title" => "One", "status" => "Todo"})
    {:ok, _} = Context.create_issue("macro-markets", %{"title" => "Two", "status" => "Todo"})
    {:ok, issue} = Context.create_issue("macro-markets", %{"title" => "Task three", "status" => "Todo"})
    assert issue.identifier == "MAC-3"

    executor = ToolExecutor.freeform_codex_tool_executor()

    assert %{"success" => true, "toolResult" => %{"tool" => "list_tracker_projects"}} =
             executor.("list_tracker_projects", %{})

    assert %{"success" => true, "toolResult" => %{"tool" => "list_issues"}} =
             executor.("list_issues", %{"project_slug" => "macro-markets"})

    assert %{"success" => true, "toolResult" => %{"tool" => "move_issue", "data" => data}} =
             executor.("move_issue", %{
               "project_slug" => "macro-markets",
               "identifier" => "MAC-3",
               "status" => "In Progress"
             })

    assert data["status"]["name"] == "In Progress"
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
          "local_tracker_projects",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
