defmodule SymphonyElixir.Tracker.Sync.LocalStorePullRequestsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, PullRequests}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "link_manual_pull_request persists a manual cross-repo PR (no local issue row)", %{
    project: project
  } do
    {:ok, _pr} =
      LocalStore.link_manual_pull_request(project.id, "510", %{
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

  test "link_manual_pull_request normalizes a #-prefixed identifier", %{project: project} do
    {:ok, _} =
      LocalStore.link_manual_pull_request(project.id, "#510", %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    {:ok, [pr]} = PullRequests.for_issue("mm", "510")
    assert pr.number == 277
  end

  test "link_manual_pull_request is idempotent on url", %{project: project} do
    attrs = %{url: "https://github.com/clouapp/back/pull/277", repo: "clouapp/back", number: 277}
    {:ok, _} = LocalStore.link_manual_pull_request(project.id, "510", attrs)
    {:ok, _} = LocalStore.link_manual_pull_request(project.id, "510", attrs)

    {:ok, prs} = PullRequests.for_issue("mm", "510")
    assert length(prs) == 1
  end

  test "unlink_pull_request removes a manual PR by url", %{project: project} do
    {:ok, _} =
      LocalStore.link_manual_pull_request(project.id, "510", %{
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        number: 277
      })

    :ok = LocalStore.unlink_pull_request(project.id, "510", "https://github.com/clouapp/back/pull/277")
    {:ok, prs} = PullRequests.for_issue("mm", "510")
    assert prs == []
  end

  test "upsert_discovered_pull_requests stores repo and origin auto", %{project: project} do
    :ok =
      LocalStore.upsert_discovered_pull_requests(project.id, "510", [
        %{
          remote_id: "https://github.com/clouapp/front/pull/12",
          number: 12,
          url: "https://github.com/clouapp/front/pull/12",
          title: "FE",
          state: "open",
          repo: "clouapp/front"
        }
      ])

    {:ok, [pr]} = PullRequests.for_issue("mm", "510")
    assert pr.repo == "clouapp/front"
    assert pr.origin == "auto"
  end

  test "upsert_discovered_pull_requests persists head_branch", %{project: project} do
    :ok =
      LocalStore.upsert_discovered_pull_requests(project.id, "GAM-2", [
        %{
          remote_id: "https://github.com/GambaLabs/backend/pull/3997",
          url: "https://github.com/GambaLabs/backend/pull/3997",
          number: 3997,
          repo: "GambaLabs/backend",
          state: "open",
          head_branch: "symphony/1857",
          origin: "auto"
        }
      ])

    assert {:ok, [pr]} = PullRequests.for_issue(project.slug, "GAM-2")
    assert pr.head_branch == "symphony/1857"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
