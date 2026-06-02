defmodule SymphonyElixirWeb.Tracker.PullRequestControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeGitHubClient do
    @moduledoc false

    def graphql(query, variables, _opts) do
      cond do
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

      assert_received {:pr_query, %{"number" => 7}}
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
      assert_received {:single_pr_query, %{"number" => 277}}
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

    test "rejects an invalid PR url on link" do
      conn =
        post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/510/pull_requests/link", %{
          url: "https://github.com/clouapp/back/issues/10"
        })

      assert json_response(conn, 422)["error"]["message"] =~ "Invalid"
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
