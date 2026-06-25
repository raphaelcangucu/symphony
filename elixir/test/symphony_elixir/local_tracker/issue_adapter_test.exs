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

  test "list_issues exposes grouped subtasks from group_lead_id", %{project: project} do
    {:ok, parent} = Context.create_issue("demo", %{title: "Parent", status: "Todo"})
    {:ok, child} = Context.create_issue("demo", %{title: "Child", status: "Todo"})
    {:ok, _child} = Context.set_issue_group("demo", child.identifier, parent.identifier)

    assert {:ok, issues} = IssueAdapter.list_issues(project, [])
    parent_dto = Enum.find(issues, &(&1.identifier == parent.identifier))
    child_dto = Enum.find(issues, &(&1.identifier == child.identifier))

    assert parent_dto.group_member_identifiers == [child.identifier]
    assert child_dto.group_lead_identifier == parent.identifier
  end

  test "get_issue maps not_found", %{project: project} do
    assert {:error, :issue_not_found} = IssueAdapter.get_issue(project, "NOPE-1")
  end

  test "list_issues returns when an issue label is stored as a github label id", %{project: project} do
    {:ok, issue} = Context.create_issue("demo", %{title: "Labelled", status: "Todo"})
    assert {:ok, _} = Context.add_issue_label("demo", issue.identifier, "LA_kwDOJHngx88AAAACmEYycw")

    task = Task.async(fn -> IssueAdapter.list_issues(project, []) end)
    assert {:ok, issues} = Task.await(task, 1_000)
    assert length(issues) == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
