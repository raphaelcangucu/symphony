defmodule SymphonyElixir.Assistant.DiscoveryToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{DiscoveryTools, ToolExecutor}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "list_tracker_projects returns local projects" do
    {:ok, _} = Context.ensure_project(%{name: "Alpha", slug: "alpha"})
    {:ok, _} = Context.ensure_project(%{name: "Beta", slug: "beta"})

    assert {:ok, result} = DiscoveryTools.execute("list_tracker_projects", %{})
    assert result.tool == "list_tracker_projects"
    slugs = Enum.map(result.data.projects, & &1.slug)
    assert "alpha" in slugs
    assert "beta" in slugs
  end

  test "freeform tool executor runs list_tracker_projects" do
    {:ok, _} = Context.ensure_project(%{name: "Gamma", slug: "gamma"})

    executor = ToolExecutor.freeform_codex_tool_executor()
    response = executor.("list_tracker_projects", %{})

    assert response["success"] == true
    assert response["toolResult"]["tool"] == "list_tracker_projects"
    assert Enum.any?(response["toolResult"]["data"]["projects"], &(&1["slug"] == "gamma"))
  end

  test "freeform_tool_specs lists discovery tools before board and GitHub tools" do
    names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"])

    assert Enum.at(names, 0) == "list_tracker_projects"
    assert Enum.find_index(names, &(&1 == "list_issues")) > Enum.find_index(names, &(&1 == "list_jira_projects"))
    assert Enum.find_index(names, &(&1 == "list_github_projects")) > Enum.find_index(names, &(&1 == "list_issues"))
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
