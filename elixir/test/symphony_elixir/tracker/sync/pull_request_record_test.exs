defmodule SymphonyElixir.Tracker.Sync.PullRequestRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

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

  test "inserts a pull request record", %{issue: issue} do
    attrs = %{
      issue_id: issue.id,
      remote_id: "PR_kwDO1",
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Fix bug",
      state: "open"
    }

    assert {:ok, pr} = %PullRequestRecord{} |> PullRequestRecord.changeset(attrs) |> Repo.insert()
    assert pr.state == "open"
    assert pr.number == 42
  end

  test "rejects invalid state", %{issue: issue} do
    attrs = %{issue_id: issue.id, remote_id: "PR_x", number: 1, url: "u", title: "t", state: "weird"}
    assert {:error, _changeset} = %PullRequestRecord{} |> PullRequestRecord.changeset(attrs) |> Repo.insert()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_pull_requests")
    Repo.query!("delete from local_tracker_issues")
    Repo.query!("delete from local_tracker_workflow_statuses")
    Repo.query!("delete from local_tracker_projects")
  end
end
