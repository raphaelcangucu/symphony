defmodule SymphonyElixir.GitHub.PullRequestsForProjectIssueTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo

  defmodule ClientStub do
    @moduledoc false

    def graphql(query, variables, _opts) do
      cond do
        query =~ "SymphonyTrackerIssuePullRequests" ->
          send(self(), {:issue_prs, variables})

          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{"nodes" => []},
                   "timelineItems" => %{
                     "nodes" => [
                       %{
                         "isCrossRepository" => true,
                         "source" => %{
                           "__typename" => "PullRequest",
                           "number" => 3992,
                           "title" => "docs(cloudflare): add operations guide",
                           "url" => "https://github.com/GambaLabs/backend/pull/3992",
                           "state" => "MERGED",
                           "repository" => %{"nameWithOwner" => "GambaLabs/backend"},
                           "isDraft" => false,
                           "merged" => true,
                           "mergedAt" => "2026-06-10T21:34:12Z",
                           "createdAt" => "2026-06-10T20:00:00Z",
                           "updatedAt" => "2026-06-10T21:34:12Z",
                           "headRefName" => "codex/gam-5-cloudflare-docs",
                           "baseRefName" => "dev",
                           "author" => %{"login" => "codex-bot"},
                           "commits" => %{"nodes" => []},
                           "comments" => %{"nodes" => []},
                           "reviews" => %{"nodes" => []}
                         }
                       }
                     ]
                   }
                 }
               }
             }
           }}

        query =~ "issueNodeId" or query =~ "IssueNodeId" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_remote"}}}}}

        true ->
          {:ok, %{"data" => %{"repository" => %{"pullRequests" => %{"nodes" => []}}}}}
      end
    end

    def rest_get(_path, _opts), do: {:ok, %{status: 200, body: %{"items" => []}}}
  end

  defmodule MarkerClientStub do
    @moduledoc false

    def graphql(query, variables, _opts) do
      cond do
        query =~ "SymphonyTrackerIssuePullRequests" ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{"nodes" => []},
                   "timelineItems" => %{"nodes" => []}
                 }
               }
             }
           }}

        query =~ "issueNodeId" or query =~ "IssueNodeId" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_remote"}}}}}

        query =~ "SymphonyPullRequestByNumber" ->
          {:ok, %{"data" => %{"repository" => %{"pullRequest" => pr_for(variables)}}}}

        true ->
          {:ok, %{"data" => %{"repository" => %{"pullRequests" => %{"nodes" => []}}}}}
      end
    end

    # Marker candidate search: only the backend PR carries the marker in its body.
    def rest_get("/search/issues?" <> query, _opts) do
      if String.contains?(query, "backend") do
        {:ok,
         %{
           status: 200,
           body: %{
             "items" => [
               %{
                 "number" => 3997,
                 "pull_request" => %{
                   "url" => "https://github.com/GambaLabs/backend/pull/3997"
                 }
               }
             ]
           }
         }}
      else
        {:ok, %{status: 200, body: %{"items" => []}}}
      end
    end

    def rest_get(_path, _opts), do: {:error, :not_stubbed}

    defp pr_for(%{"name" => "backend", "number" => 3997}),
      do: pr_node(3997, "GambaLabs/backend", "symphony/1857", "Recovery publish\n\nSymphony-Issue: GAM-2")

    defp pr_for(%{"name" => "frontend", "number" => 1866}),
      do: pr_node(1866, "GambaLabs/frontend", "feat/DailyTipLimit", "test")

    defp pr_for(_variables), do: nil

    defp pr_node(number, repo, head_ref, body) do
      %{
        "number" => number,
        "title" => "#{number}: test",
        "url" => "https://github.com/#{repo}/pull/#{number}",
        "body" => body,
        "state" => "OPEN",
        "repository" => %{"nameWithOwner" => repo},
        "isDraft" => false,
        "merged" => false,
        "mergedAt" => nil,
        "createdAt" => "2026-06-11T19:49:00Z",
        "updatedAt" => "2026-06-11T19:49:00Z",
        "headRefName" => head_ref,
        "baseRefName" => "dev",
        "author" => %{"login" => "agent"},
        "commits" => %{"nodes" => []},
        "comments" => %{"nodes" => []},
        "reviews" => %{"nodes" => []}
      }
    end
  end

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  test "for_project_issue resolves local identifiers via remote_number" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba",
        tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_test"}
      })

    {:ok, issue} = Context.create_issue(project.slug, %{title: "Cloudflare docs", status: "Human Review"})

    issue
    |> IssueRecord.changeset(%{
      remote_number: 1_860,
      remote_url: "https://github.com/GambaLabs/frontend/issues/1860",
      url: "https://github.com/GambaLabs/frontend/issues/1860"
    })
    |> Repo.update!()

    assert {:ok, prs} =
             PullRequests.for_project_issue(project, issue.identifier,
               client_module: ClientStub
             )

    assert [%{number: 3992, merged: true, repo: "GambaLabs/backend"}] = prs
    assert_received {:issue_prs, %{"name" => "frontend", "number" => 1_860, "owner" => "GambaLabs"}}
  end

  test "for_project_issue unions workpad block + marker search" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba-marker",
        tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_test"}
      })

    {:ok, repos} =
      Context.replace_repositories(project.slug, [
        %{
          github_full_name: "GambaLabs/frontend",
          role: "primary",
          workspace_path: "frontend",
          selected_branch: "development"
        },
        %{
          github_full_name: "GambaLabs/backend",
          role: "backend",
          workspace_path: "backend",
          selected_branch: "dev"
        }
      ])

    assert length(repos) == 2

    {:ok, issue} = Context.create_issue(project.slug, %{title: "Daily tip limit", status: "Human Review"})

    issue
    |> IssueRecord.changeset(%{
      identifier: "GAM-2",
      remote_number: 1_857,
      remote_url: "https://github.com/GambaLabs/frontend/issues/1857",
      url: "https://github.com/GambaLabs/frontend/issues/1857"
    })
    |> Repo.update!()

    # Workpad block lists the frontend PR; marker search finds the backend PR.
    workpad =
      SymphonyElixir.Workpad.PullRequestBlock.upsert_block(nil, [
        %{
          repo: "GambaLabs/frontend",
          number: 1866,
          branch: "feat/DailyTipLimit",
          url: "https://github.com/GambaLabs/frontend/pull/1866"
        }
      ])

    {:ok, _comment} = Context.add_comment(project.slug, "GAM-2", workpad)

    assert {:ok, prs} =
             PullRequests.for_project_issue(project, "GAM-2", client_module: MarkerClientStub)

    pairs = prs |> Enum.map(&{&1.repo, &1.number}) |> Enum.sort()
    assert {"GambaLabs/backend", 3997} in pairs
    assert {"GambaLabs/frontend", 1866} in pairs
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
