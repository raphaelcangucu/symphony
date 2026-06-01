defmodule SymphonyElixir.Tracker.Sync.PullRequestsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, PullRequests}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})

    {:ok, issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_1", remote_number: 1, identifier: "1", title: "t", description: nil,
        state: "Todo", priority: nil, assignee_id: nil, branch_name: nil, remote_url: "u",
        creator: nil, position: 0, remote_updated_at: DateTime.utc_now(), labels: [], comments: []
      })

    :ok =
      LocalStore.upsert_pull_requests(issue, [
        %{remote_id: "pr-7", number: 7, url: "http://gh/pr/7", title: "Fix", state: "open"}
      ])

    %{project: project}
  end

  test "for_issue returns locally-mirrored pull requests", %{project: project} do
    assert {:ok, [pr]} = PullRequests.for_issue(project.slug, "1")
    assert pr.number == 7
    assert pr.state == "open"
    assert pr.url == "http://gh/pr/7"
  end

  test "for_issue returns empty list when no PRs", %{project: project} do
    assert {:ok, []} = PullRequests.for_issue(project.slug, "999")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- ["tracker_pull_requests", "local_tracker_issues", "local_tracker_workflow_statuses", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end
  end
end
