defmodule SymphonyElixir.LocalTracker.CommentSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Comment, Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    status = Repo.all(WorkflowStatus) |> hd()

    {:ok, issue} =
      %IssueRecord{}
      |> IssueRecord.changeset(%{project_id: project.id, status_id: status.id, identifier: "1", title: "I", position: 0})
      |> Repo.insert()

    %{issue: issue}
  end

  test "changeset accepts comment sync metadata", %{issue: issue} do
    now = DateTime.utc_now()

    attrs = %{
      issue_id: issue.id,
      kind: "comment",
      body: "hello",
      author: "octocat",
      remote_id: "IC_kwDO1",
      sync_status: "synced",
      remote_updated_at: now,
      last_synced_at: now,
      dirty_fields: %{}
    }

    assert {:ok, comment} = %Comment{} |> Comment.changeset(attrs) |> Repo.insert()
    assert comment.remote_id == "IC_kwDO1"
    assert comment.sync_status == "synced"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
