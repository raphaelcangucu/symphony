defmodule SymphonyElixir.Tracker.CliTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Cli

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    :ok
  end

  test "list_tracker_projects works without a slug" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    assert {:ok, result} = Cli.call("list_tracker_projects", nil, %{})
    assert result.tool == "list_tracker_projects"
  end

  test "routes a project-scoped tool to ToolExecutor" do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, _issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})

    assert {:ok, result} = Cli.call("list_issues", "macro", %{})
    assert result.tool == "list_issues"
  end

  test "requires a slug for project-scoped tools" do
    assert {:error, :project_slug_required} = Cli.call("get_issue", nil, %{"identifier" => "X-1"})
  end

  test "routes list_running_agents without a slug to the global running view" do
    assert {:ok, result} = Cli.call("list_running_agents", nil, %{})
    assert result.tool == "list_running_agents"
    assert result.data.project_slug == nil
    assert is_list(result.data.running)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
