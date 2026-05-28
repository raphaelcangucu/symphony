defmodule SymphonyElixir.LocalTracker.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Demo", slug: "demo"})
    %{project: project}
  end

  test "kind/0 is :local" do
    assert IssueAdapter.kind() == :local
  end

  test "list_issues returns DTOs", %{project: project} do
    {:ok, _issue} = Context.create_issue("demo", %{title: "First", status: "Todo"})

    assert {:ok, [%IssueDTO{} = dto]} = IssueAdapter.list_issues(project, [])
    assert dto.title == "First"
    assert dto.status.name == "Todo"
    assert dto.project_slug == "demo"
  end

  test "create_issue returns DTO", %{project: project} do
    assert {:ok, %IssueDTO{title: "Made"}} =
             IssueAdapter.create_issue(project, %{"title" => "Made", "status" => "Todo"})
  end

  test "get_issue maps not_found", %{project: project} do
    assert {:error, :issue_not_found} = IssueAdapter.get_issue(project, "NOPE-1")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
