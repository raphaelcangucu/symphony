defmodule SymphonyElixir.LocalTracker.ContextFindSlugTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    {:ok, _alpha} = Context.ensure_project(%{name: "Alpha", slug: "alpha"})
    {:ok, _beta} = Context.ensure_project(%{name: "Beta", slug: "beta"})

    :ok
  end

  test "resolves the project slug from a unique issue identifier" do
    {:ok, issue} = Context.create_issue("alpha", %{title: "First"})

    assert Context.find_project_slug(issue.identifier) == "alpha"
  end

  test "returns nil when no issue matches the identifier" do
    assert Context.find_project_slug("nope") == nil
  end

  test "returns nil when the identifier is ambiguous across projects" do
    insert_issue_with_identifier!("alpha", "DUP-1")
    insert_issue_with_identifier!("beta", "DUP-1")

    assert Context.find_project_slug("DUP-1") == nil
  end

  test "returns nil for a non-binary identifier" do
    assert Context.find_project_slug(nil) == nil
  end

  defp insert_issue_with_identifier!(project_slug, identifier) do
    {:ok, project} = Context.get_project(project_slug)
    status = Repo.get_by!(WorkflowStatus, project_id: project.id, name: "Todo")

    %IssueRecord{}
    |> IssueRecord.changeset(%{
      project_id: project.id,
      status_id: status.id,
      identifier: identifier,
      title: "Issue #{identifier}",
      position: 0
    })
    |> Repo.insert!()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
