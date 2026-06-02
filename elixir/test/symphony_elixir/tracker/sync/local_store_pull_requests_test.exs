defmodule SymphonyElixir.Tracker.Sync.LocalStorePullRequestsTest do
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
        remote_id: "I_510",
        remote_number: 510,
        identifier: "510",
        title: "Issue 510",
        state: "Todo",
        remote_url: "https://github.com/clouapp/front/issues/510",
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    %{project: project, issue: issue}
  end

  test "link_manual_pull_request persists a manual cross-repo PR", %{issue: issue} do
    {:ok, _pr} =
      LocalStore.link_manual_pull_request(issue, %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    {:ok, [pr]} = PullRequests.for_issue("mm", "510")
    assert pr.repo == "clouapp/back"
    assert pr.origin == "manual"
    assert pr.state == "unknown"
    assert pr.url == "https://github.com/clouapp/back/pull/277"
    assert pr.title == "#277"
  end

  test "link_manual_pull_request is idempotent on url", %{issue: issue} do
    attrs = %{url: "https://github.com/clouapp/back/pull/277", repo: "clouapp/back", number: 277}
    {:ok, _} = LocalStore.link_manual_pull_request(issue, attrs)
    {:ok, _} = LocalStore.link_manual_pull_request(issue, attrs)

    {:ok, prs} = PullRequests.for_issue("mm", "510")
    assert length(prs) == 1
  end

  test "unlink_pull_request removes a manual PR by url", %{issue: issue} do
    {:ok, _} =
      LocalStore.link_manual_pull_request(issue, %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    :ok = LocalStore.unlink_pull_request(issue, "https://github.com/clouapp/back/pull/277")
    {:ok, prs} = PullRequests.for_issue("mm", "510")
    assert prs == []
  end

  test "upsert_pull_requests stores repo and origin auto", %{issue: issue} do
    :ok =
      LocalStore.upsert_pull_requests(issue, [
        %{
          remote_id: "https://github.com/clouapp/front/pull/12",
          number: 12,
          url: "https://github.com/clouapp/front/pull/12",
          title: "FE",
          state: "open",
          repo: "clouapp/front",
          origin: "auto"
        }
      ])

    {:ok, [pr]} = PullRequests.for_issue("mm", "510")
    assert pr.repo == "clouapp/front"
    assert pr.origin == "auto"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
