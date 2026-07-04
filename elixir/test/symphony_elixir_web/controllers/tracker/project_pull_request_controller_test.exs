defmodule SymphonyElixirWeb.Tracker.ProjectPullRequestControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeClient do
    @moduledoc false

    def rest_get("/search/issues?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: %{
           "items" => [
             %{
               "number" => 9,
               "title" => "Add cache",
               "html_url" => "https://github.com/o/r/pull/9",
               "pull_request" => %{"html_url" => "https://github.com/o/r/pull/9"},
               "user" => %{"login" => "octocat"},
               "updated_at" => "2026-06-21T09:00:00Z",
               "body" => "Symphony-Issue: ADV-2"
             }
           ]
         }
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    ReadCache.invalidate_all()
    Application.put_env(:symphony_elixir, :github_client_module, FakeClient)

    prev_token = System.get_env(@token_env)
    prev_gh = System.get_env(@github_token_env)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      restore_env(@token_env, prev_token)
      restore_env(@github_token_env, prev_gh)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Advising",
        "slug" => "advising-pr-list",
        "tracker" => %{"kind" => "jira", "config" => %{"project_key" => "ADV"}},
        "repositories" => [
          %{
            "github_full_name" => "o/r",
            "clone_url" => "https://github.com/o/r.git",
            "role" => "primary",
            "workspace_path" => "r"
          }
        ],
        "setup" => %{}
      })

    {:ok, project: project}
  end

  test "lists open PRs for the project with marker-derived issue identifiers" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/advising-pr-list/pull_requests")

    assert %{"data" => [pr], "supported" => true} = json_response(conn, 200)
    assert pr["number"] == 9
    assert pr["repo"] == "o/r"
    assert pr["issue_identifier"] == "ADV-2"
  end

  test "returns supported: false for projects with no repos" do
    {:ok, _} =
      Context.create_workspace_project(%{
        "name" => "Local",
        "slug" => "local-no-repo",
        "tracker" => %{"kind" => "local"},
        "repositories" => [],
        "setup" => %{}
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/local-no-repo/pull_requests")
    assert %{"data" => [], "supported" => false} = json_response(conn, 200)
  end

  defp authorized_conn do
    build_conn()
    |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo, do: Ecto.Migrator.run(SymphonyElixir.Repo, :up, all: true)

  defp clean_repo do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Project)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
