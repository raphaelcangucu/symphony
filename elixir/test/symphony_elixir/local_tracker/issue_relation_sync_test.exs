defmodule SymphonyElixir.LocalTracker.IssueRelationSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, IssueRelation, WorkflowStatus}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    status = Repo.all(WorkflowStatus) |> hd()

    insert = fn ident ->
      %IssueRecord{}
      |> IssueRecord.changeset(%{project_id: project.id, status_id: status.id, identifier: ident, title: "I#{ident}", position: 0})
      |> Repo.insert!()
    end

    %{source: insert.("1"), target: insert.("2")}
  end

  test "changeset accepts remote_origin flag", %{source: source, target: target} do
    attrs = %{source_issue_id: source.id, target_issue_id: target.id, type: "blocked_by", remote_origin: true}
    assert {:ok, relation} = %IssueRelation{} |> IssueRelation.changeset(attrs) |> Repo.insert()
    assert relation.remote_origin == true
  end

  test "remote_origin defaults to false", %{source: source, target: target} do
    attrs = %{source_issue_id: source.id, target_issue_id: target.id, type: "blocked_by"}
    assert {:ok, relation} = %IssueRelation{} |> IssueRelation.changeset(attrs) |> Repo.insert()
    assert relation.remote_origin == false
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
