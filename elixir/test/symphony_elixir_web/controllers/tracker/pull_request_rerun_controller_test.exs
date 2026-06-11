defmodule SymphonyElixirWeb.Tracker.PullRequestRerunControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule RerunClient do
    @moduledoc false

    def graphql(query, _variables, _opts) when is_binary(query) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{
                 "nodes" => [
                   %{
                     "number" => 7,
                     "title" => "Fix failing CI",
                     "url" => "https://github.com/acme/app/pull/7",
                     "state" => "OPEN",
                     "isDraft" => false,
                     "merged" => false,
                     "headRefName" => "fix-7",
                     "baseRefName" => "main",
                     "repository" => %{"nameWithOwner" => "acme/app"},
                     "author" => %{"login" => "codex-bot"},
                     "updatedAt" => "2026-06-10T00:00:00Z",
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
                                     "name" => "test",
                                     "status" => "COMPLETED",
                                     "conclusion" => "FAILURE",
                                     "checkSuite" => %{
                                       "workflowRun" => %{
                                         "url" => "https://github.com/acme/app/actions/runs/99",
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
    end

    def rest_post(path, body, _opts) do
      send(self(), {:rerun, path, body})
      {:ok, %{status: 201, body: %{}}}
    end
  end

  defmodule RerunForbiddenClient do
    @moduledoc false

    def graphql(query, variables, opts), do: RerunClient.graphql(query, variables, opts)

    def rest_post(_path, _body, _opts) do
      {:error, {:github_api_status, 403}}
    end
  end

  defmodule NoFailuresClient do
    @moduledoc false

    def graphql(query, _variables, _opts) when is_binary(query) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{
             "issue" => %{
               "linkedBranches" => %{"nodes" => []},
               "timelineItems" => %{"nodes" => []},
               "closedByPullRequestsReferences" => %{
                 "nodes" => [
                   %{
                     "number" => 7,
                     "title" => "Fix lint",
                     "url" => "https://github.com/acme/app/pull/7",
                     "state" => "OPEN",
                     "isDraft" => false,
                     "merged" => false,
                     "headRefName" => "fix-7",
                     "baseRefName" => "main",
                     "repository" => %{"nameWithOwner" => "acme/app"},
                     "author" => %{"login" => "codex-bot"},
                     "updatedAt" => "2026-06-10T00:00:00Z",
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
                                         "url" => "https://github.com/acme/app/actions/runs/77",
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
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    previous_github = System.get_env(@github_token_env)
    System.put_env(@github_token_env, "gh-token")

    Application.put_env(:symphony_elixir, :github_client_module, RerunClient)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_client_module)
      restore_env(@token_env, previous_token)
      restore_env(@github_token_env, previous_github)
    end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Remote",
        "slug" => "remote",
        "tracker" => %{"kind" => "github", "config" => %{"repo" => "acme/app", "project_id" => "PVT_1"}},
        "repositories" => [],
        "setup" => %{}
      })

    :ok
  end

  test "POST rerun_failed reruns each failing run and returns the list" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/42/pull_requests/7/rerun_failed")

    assert %{"data" => %{"reruns" => [%{"run_id" => 99, "ok" => true}]}} = json_response(conn, 200)
    assert_received {:rerun, "/repos/acme/app/actions/runs/99/rerun-failed-jobs", %{}}
  end

  test "returns 422 when there is nothing to rerun" do
    Application.put_env(:symphony_elixir, :github_client_module, NoFailuresClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/42/pull_requests/7/rerun_failed")

    assert %{"error" => %{"code" => "no_failed_runs"}} = json_response(conn, 422)
  end

  test "returns invalid_pr_number for non-numeric pull request number" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/42/pull_requests/abc/rerun_failed")

    assert %{"error" => %{"code" => "invalid_pr_number"}} = json_response(conn, 422)
  end

  test "returns structured rerun_failed error when rerun request is rejected" do
    Application.put_env(:symphony_elixir, :github_client_module, RerunForbiddenClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/42/pull_requests/7/rerun_failed")

    assert %{
             "data" => %{
               "reruns" => [
                 %{"run_id" => 99, "ok" => false, "error" => "rerun_failed", "status" => 403}
               ]
             }
           } = json_response(conn, 200)
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
