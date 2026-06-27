defmodule SymphonyElixirWeb.Tracker.PullRequestControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestMonitor.MonitorState
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeGitHubClient do
    @moduledoc false

    def graphql(query, variables, _opts) do
      cond do
        query =~ "SymphonyUiIssueNodeId" ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{"id" => "I_#{variables["number"]}", "title" => "Issue", "body" => "", "labels" => %{"nodes" => []}}
               }
             }
           }}

        query =~ "SymphonyTrackerIssuePullRequests" ->
          send(self(), {:pr_query, variables})

          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [
                       %{
                         "number" => 7,
                         "title" => "Fix",
                         "url" => "https://github.com/o/r/pull/7",
                         "state" => "OPEN",
                         "isDraft" => false,
                         "merged" => false,
                         "headRefName" => "fix-7",
                         "baseRefName" => "main",
                         "author" => %{"login" => "codex-bot"},
                         "updatedAt" => "2026-05-26T12:00:00Z",
                         "commits" => %{
                           "nodes" => [
                             %{
                               "commit" => %{
                                 "statusCheckRollup" => %{
                                   "state" => "SUCCESS",
                                   "contexts" => %{
                                     "nodes" => [
                                       %{
                                         "__typename" => "CheckRun",
                                         "name" => "lint",
                                         "status" => "COMPLETED",
                                         "conclusion" => "SUCCESS",
                                         "checkSuite" => %{
                                           "workflowRun" => %{
                                             "url" => "https://github.com/o/r/actions/runs/1",
                                             "workflow" => %{"name" => "CI"}
                                           }
                                         }
                                       }
                                     ]
                                   }
                                 }
                               }
                             }
                           ]
                         },
                         "comments" => %{"nodes" => []},
                         "reviews" => %{"nodes" => []}
                       }
                     ]
                   }
                 }
               }
             }
           }}

        query =~ "SymphonyPullRequestByNumber" ->
          send(self(), {:single_pr_query, variables})

          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "pullRequest" => %{
                   "number" => variables["number"],
                   "title" => "Backend fix",
                   "url" => "https://github.com/clouapp/back/pull/277",
                   "state" => "OPEN",
                   "isDraft" => false,
                   "merged" => false,
                   "headRefName" => "fix-277",
                   "baseRefName" => "dev",
                   "repository" => %{"nameWithOwner" => "clouapp/back"},
                   "author" => %{"login" => "codex-bot"},
                   "updatedAt" => "2026-06-01T12:00:00Z",
                   "commits" => %{
                     "nodes" => [
                       %{
                         "commit" => %{
                           "statusCheckRollup" => %{
                             "state" => "FAILURE",
                             "contexts" => %{
                               "nodes" => [
                                 %{
                                   "__typename" => "CheckRun",
                                   "name" => "tests (1) / test",
                                   "status" => "COMPLETED",
                                   "conclusion" => "FAILURE",
                                   "checkSuite" => %{
                                     "workflowRun" => %{
                                       "url" => "https://github.com/clouapp/back/actions/runs/9",
                                       "workflow" => %{"name" => "CI/CD Pipeline"}
                                     }
                                   }
                                 }
                               ]
                             }
                           }
                         }
                       }
                     ]
                   },
                   "comments" => %{"nodes" => []},
                   "reviews" => %{"nodes" => []}
                 }
               }
             }
           }}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    # The controller now serves live PR reads through the shared ReadCache; clear
    # it between tests so a cached entry from a prior test cannot leak across.
    ReadCache.invalidate_all()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    :ok
  end

  test "returns supported: false for local projects" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Local",
        "slug" => "local",
        "tracker" => %{"kind" => "local"},
        "repositories" => [],
        "setup" => %{}
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/local/issues/LOC-1/pull_requests")

    assert %{"data" => [], "supported" => false} = json_response(conn, 200)
  end

  describe "jira project with github repositories" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, FakeGitHubClient)
      previous_github = System.get_env(@github_token_env)
      System.put_env(@github_token_env, "gh-token")

      {:ok, project} =
        Context.create_workspace_project(%{
          "name" => "Advising",
          "slug" => "advising-jira-pr",
          "tracker" => %{"kind" => "jira", "config" => %{"project_key" => "CDE"}},
          "repositories" => [
            %{
              "github_full_name" => "civitaslearning/advising",
              "clone_url" => "https://github.com/civitaslearning/advising.git",
              "role" => "primary",
              "workspace_path" => "advising"
            }
          ],
          "setup" => %{}
        })

      {:ok, _pr} =
        SymphonyElixir.Tracker.Sync.LocalStore.link_manual_pull_request(project.id, "CDE-1132", %{
          url: "https://github.com/civitaslearning/advising/pull/9540",
          repo: "civitaslearning/advising",
          number: 9540
        })

      on_exit(fn ->
        Application.delete_env(:symphony_elixir, :github_client_module)
        restore_env(@github_token_env, previous_github)
      end)

      %{project: project}
    end

    test "returns supported: true and persisted PRs for external tracker issues", %{project: _project} do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/advising-jira-pr/issues/CDE-1132/pull_requests")

      assert %{
               "supported" => true,
               "available" => true,
               "data" => [pr]
             } = json_response(conn, 200)

      assert pr["number"] == 9540
      assert pr["url"] == "https://github.com/civitaslearning/advising/pull/9540"
      assert pr["origin"] == "manual"
    end
  end

  describe "github project" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, FakeGitHubClient)
      previous_github = System.get_env(@github_token_env)
      System.put_env(@github_token_env, "gh-token")

      {:ok, project} =
        Context.create_workspace_project(%{
          "name" => "Remote",
          "slug" => "remote",
          "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}},
          "repositories" => [],
          "setup" => %{}
        })

      on_exit(fn ->
        Application.delete_env(:symphony_elixir, :github_client_module)
        restore_env(@github_token_env, previous_github)
      end)

      %{project: project}
    end

    test "resolves related PR with pipelines" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/%237/pull_requests")

      assert %{
               "supported" => true,
               "available" => true,
               "data" => [pr]
             } = json_response(conn, 200)

      assert pr["number"] == 7
      assert pr["state"] == "open"
      assert [%{"name" => "CI", "jobs" => [%{"name" => "lint"}]}] = pr["pipelines"]
      assert pr["monitor"] == nil
    end

    test "includes monitor payload when a monitor state exists" do
      {:ok, _state} =
        MonitorState.upsert("remote", "#7", "https://github.com/o/r/pull/7", %{
          auto_rework_count: 2,
          last_action: "kept_human_review",
          last_action_at: ~U[2026-06-10 18:30:00Z],
          last_classification: %{"summary" => "CI failure appears unrelated"}
        })

      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/%237/pull_requests")

      assert %{"data" => [pr]} = json_response(conn, 200)
      assert pr["monitor"]["last_action"] == "kept_human_review"
      assert pr["monitor"]["summary"] == "CI failure appears unrelated"
      assert pr["monitor"]["auto_rework_count"] == 2
      assert pr["monitor"]["last_action_at"] == "2026-06-10T18:30:00.000000Z"
    end

    test "merges a manual cross-repo PR with live discovery", %{project: project} do
      {:ok, _} =
        SymphonyElixir.Tracker.Sync.LocalStore.link_manual_pull_request(project.id, "510", %{
          url: "https://github.com/clouapp/back/pull/277",
          repo: "clouapp/back",
          number: 277
        })

      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests")
      body = json_response(conn, 200)

      urls = Enum.map(body["data"], & &1["url"])
      assert "https://github.com/clouapp/back/pull/277" in urls
      assert "https://github.com/o/r/pull/7" in urls

      manual = Enum.find(body["data"], &(&1["url"] == "https://github.com/clouapp/back/pull/277"))
      assert manual["repo"] == "clouapp/back"
      assert manual["origin"] == "manual"

      assert [%{"name" => "CI/CD Pipeline", "jobs" => [%{"name" => "tests (1) / test"}]}] =
               manual["pipelines"]

      assert manual["state"] == "open"
      assert manual["checks_state"] == "FAILURE"
    end

    test "link then unlink a PR" do
      url = "https://github.com/clouapp/back/pull/277"

      conn =
        post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests/link", %{
          url: url
        })

      assert json_response(conn, 200)["data"]["url"] == url

      conn =
        delete(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests/link", %{
          url: url
        })

      assert json_response(conn, 200)["data"]["unlinked"] == true
    end

    test "unlink dismisses auto-discovered PRs so they stay hidden on refresh" do
      url = "https://github.com/o/r/pull/7"

      conn =
        get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests")

      assert url in Enum.map(json_response(conn, 200)["data"], & &1["url"])

      conn =
        delete(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests/link", %{
          url: url
        })

      assert json_response(conn, 200)["data"]["unlinked"] == true

      conn =
        get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests?refresh=1")

      urls = Enum.map(json_response(conn, 200)["data"], & &1["url"])
      refute url in urls
    end

    test "rejects an invalid PR url on link" do
      conn =
        post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests/link", %{
          url: "https://github.com/clouapp/back/issues/10"
        })

      assert json_response(conn, 422)["error"]["message"] =~ "Invalid"
    end

    test "consolidates sub-issue PRs under the parent's children", %{project: project} do
      {:ok, parent} = Context.create_issue("remote", %{title: "Parent epic"})
      {:ok, child} = Context.create_issue("remote", %{title: "Child task"})
      {:ok, _} = Context.set_issue_parent("remote", child.identifier, parent.identifier)

      {:ok, _} =
        SymphonyElixir.Tracker.Sync.LocalStore.link_manual_pull_request(project.id, child.identifier, %{
          url: "https://github.com/clouapp/back/pull/289",
          repo: "clouapp/back",
          number: 289
        })

      conn =
        get(
          authorized_conn(),
          "/api/tracker/v1/projects/remote/issues/#{URI.encode_www_form(parent.identifier)}/pull_requests"
        )

      body = json_response(conn, 200)

      assert [child_group] = body["children"]
      assert child_group["identifier"] == child.identifier
      assert child_group["title"] == "Child task"
      assert [child_pr] = child_group["pull_requests"]
      assert child_pr["url"] == "https://github.com/clouapp/back/pull/289"
      assert child_pr["repo"] == "clouapp/back"
    end

    test "omits sub-issues that have no pull requests from children" do
      {:ok, parent} = Context.create_issue("remote", %{title: "Lonely parent"})
      {:ok, child} = Context.create_issue("remote", %{title: "Childless work"})
      {:ok, _} = Context.set_issue_parent("remote", child.identifier, parent.identifier)

      conn =
        get(
          authorized_conn(),
          "/api/tracker/v1/projects/remote/issues/#{URI.encode_www_form(parent.identifier)}/pull_requests"
        )

      assert json_response(conn, 200)["children"] == []
    end
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
