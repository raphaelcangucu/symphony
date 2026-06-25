defmodule SymphonyElixirWeb.Tracker.PullRequestBranchControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

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

    def rest_put(path, _body, _opts) do
      send(self(), {:put, path})
      {:ok, %{status: 202, body: %{}}}
    end

    defp pr_node(number, repo) do
      %{
        "number" => number,
        "title" => "docs: add llms.txt",
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

    def rest_put(path, _body, _opts) do
      send(self(), {:put, path})
      {:ok, %{status: 202, body: %{}}}
    end
  end

  defmodule ConflictClient do
    def graphql(query, variables, opts), do: AcceptedClient.graphql(query, variables, opts)

    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 422}}
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    previous_github = System.get_env(@github_token_env)
    System.put_env(@github_token_env, "gh-token")

    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

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

  test "returns updated:true on success" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"data" => %{"updated" => true}} = json_response(conn, 200)
    assert_received {:put, "/repos/acme/app/pulls/509/update-branch"}
  end

  test "uses the PR repo for multi-repo projects" do
    Application.put_env(:symphony_elixir, :github_client_module, MultiRepoGraphqlClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"data" => %{"updated" => true}} = json_response(conn, 200)
    assert_received {:put, "/repos/acme/backend/pulls/509/update-branch"}
  end

  test "maps a conflict to 422" do
    Application.put_env(:symphony_elixir, :github_client_module, ConflictClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"error" => %{"code" => "update_branch_conflict"}} = json_response(conn, 422)
  end

  test "rejects a non-numeric pr number with 422" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/abc/update_branch")

    assert %{"error" => %{"code" => "invalid_pr_number"}} = json_response(conn, 422)
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
