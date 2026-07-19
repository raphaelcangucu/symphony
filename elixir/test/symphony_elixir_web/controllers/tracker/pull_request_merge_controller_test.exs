defmodule SymphonyElixirWeb.Tracker.PullRequestMergeControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule AcceptedClient do
    def graphql(query, _variables, _opts) when is_binary(query) do
      cond do
        query =~ "issueNodeId" or query =~ "IssueNodeId" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_node"}}}}}

        true ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "timelineItems" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [
                       pr_node(509, "acme/app")
                     ]
                   }
                 }
               }
             }
           }}
      end
    end

    def rest_put(path, body, _opts) do
      send(self(), {:merge, path, body})
      {:ok, %{status: 200, body: %{"merged" => true, "sha" => "abc123"}}}
    end

    defp pr_node(number, repo) do
      %{
        "number" => number,
        "title" => "Ship it",
        "url" => "https://github.com/#{repo}/pull/#{number}",
        "state" => "OPEN",
        "isDraft" => false,
        "merged" => false,
        "headRefName" => "feat-#{number}",
        "baseRefName" => "main",
        "repository" => %{"nameWithOwner" => repo},
        "author" => %{"login" => "codex-bot"},
        "updatedAt" => "2026-05-29T00:00:00Z",
        "commits" => %{"nodes" => []},
        "comments" => %{"nodes" => []},
        "reviews" => %{"nodes" => []}
      }
    end
  end

  defmodule MultiRepoGraphqlClient do
    def graphql(query, _variables, _opts) when is_binary(query) do
      cond do
        query =~ "issueNodeId" or query =~ "IssueNodeId" ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_node"}}}}}

        true ->
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
                         "number" => 509,
                         "title" => "fix(auth): rotate tokens",
                         "url" => "https://github.com/acme/backend/pull/509",
                         "state" => "OPEN",
                         "isDraft" => false,
                         "merged" => false,
                         "headRefName" => "fix-auth",
                         "baseRefName" => "dev",
                         "repository" => %{"nameWithOwner" => "acme/backend"},
                         "author" => %{"login" => "codex-bot"},
                         "updatedAt" => "2026-05-29T00:00:00Z",
                         "commits" => %{"nodes" => []},
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

    def rest_put(path, body, _opts) do
      send(self(), {:merge, path, body})
      {:ok, %{status: 200, body: %{"merged" => true, "sha" => "abc123"}}}
    end
  end

  defmodule BlockedClient do
    def graphql(query, variables, opts), do: AcceptedClient.graphql(query, variables, opts)

    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 405}}
  end

  defmodule MoveAdapter do
    def move_issue(project, identifier, attrs) do
      send(self(), {:move_issue, identifier, attrs})

      {:ok,
       IssueDTO.build(%{
         identifier: identifier,
         title: "Merged work",
         status: %{name: "Done", category: "completed", position: nil, is_terminal: true},
         project_slug: project.slug
       })}
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

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_client_module)
      Application.delete_env(:symphony_elixir, :issue_adapters)
      restore_env(@token_env, previous_token)
      restore_env(@github_token_env, previous_github)
    end)

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Remote",
        "slug" => "remote",
        "tracker" => %{"kind" => "github", "config" => %{"repo" => "acme/app", "project_id" => "PVT_1"}},
        "repositories" => [],
        "setup" => %{}
      })

    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => MoveAdapter})

    %{project: project}
  end

  test "merges a pull request and moves the issue to Done" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/merge", %{
        "method" => "squash"
      })

    assert %{
             "data" => %{
               "merged" => true,
               "method" => "squash",
               "bypass" => false,
               "issue" => %{"identifier" => "508", "status" => %{"name" => "Done"}}
             }
           } = json_response(conn, 200)

    assert_received {:merge, "/repos/acme/app/pulls/509/merge", %{merge_method: "squash"}}
    assert_received {:move_issue, "508", %{"status" => "Done"}}
  end

  test "supports force merge intent" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/merge", %{
        "method" => "rebase",
        "bypass" => true
      })

    assert %{"data" => %{"merged" => true, "method" => "rebase", "bypass" => true}} = json_response(conn, 200)
    assert_received {:merge, "/repos/acme/app/pulls/509/merge", %{merge_method: "rebase"}}
    assert_received {:move_issue, "508", %{"status" => "Done"}}
  end

  test "uses the PR repo for multi-repo projects" do
    Application.put_env(:symphony_elixir, :github_client_module, MultiRepoGraphqlClient)

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/merge", %{
        "method" => "merge"
      })

    assert %{"data" => %{"merged" => true}} = json_response(conn, 200)
    assert_received {:merge, "/repos/acme/backend/pulls/509/merge", %{merge_method: "merge"}}
    assert_received {:move_issue, "508", %{"status" => "Done"}}
  end

  test "rejects invalid pr numbers" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/abc/merge")

    assert %{"error" => %{"code" => "invalid_pr_number"}} = json_response(conn, 422)
  end

  test "rejects invalid merge methods" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/merge", %{
        "method" => "octopus"
      })

    assert %{"error" => %{"code" => "invalid_merge_method"}} = json_response(conn, 422)
  end

  test "returns a clear error when GitHub blocks the merge" do
    Application.put_env(:symphony_elixir, :github_client_module, BlockedClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/merge")

    assert %{"error" => %{"code" => "pull_request_not_mergeable"}} = json_response(conn, 422)
    refute_received {:move_issue, _identifier, _attrs}
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
