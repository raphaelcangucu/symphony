defmodule SymphonyElixirWeb.Tracker.PullRequestFixControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule StubAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    def kind, do: :github
    def list_issues(_p, _f), do: {:ok, []}
    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:ok, []}

    def add_comment(_p, _i, body, _a) do
      send(self(), {:added_comment, body})
      {:ok, %{id: "c1", body: body}}
    end

    def move_issue(_p, _i, attrs) do
      send(self(), {:moved, attrs})
      {:ok, %{id: "i1"}}
    end
  end

  defmodule FailingChecksClient do
    def graphql(query, _vars, _opts) when is_binary(query) do
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
                     "title" => "docs: add llms.txt",
                     "url" => "https://github.com/acme/app/pull/509",
                     "state" => "OPEN",
                     "updatedAt" => "2026-05-29T00:00:00Z",
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
                                     "name" => "vitest / test",
                                     "conclusion" => "FAILURE",
                                     "databaseId" => 9,
                                     "detailsUrl" => "https://github.com/acme/app/actions/runs/1/job/9"
                                   }
                                 ]
                               }
                             }
                           }
                         }
                       ]
                     }
                   }
                 ]
               }
             }
           }
         }
       }}
    end

    def rest_get(_path, _opts), do: {:ok, %{status: 200, body: "2026-05-29T00:00:00Z ##[error]boom"}}
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => StubAdapter})
    Application.put_env(:symphony_elixir, :github_client_module, FailingChecksClient)

    previous_github = System.get_env(@github_token_env)
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :issue_adapters)
      Application.delete_env(:symphony_elixir, :github_client_module)
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

    %{project: project}
  end

  test "posts a CI-failure comment and moves the issue to Rework" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/509/pull_requests/fix")

    assert %{"data" => %{"moved_to" => "Rework", "comment_posted" => true, "jobs" => jobs}} =
             json_response(conn, 201)

    assert [%{"name" => "vitest / test"}] = jobs

    assert_received {:added_comment, _body}
    assert_received {:moved, %{"status" => "Rework"}}
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
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
