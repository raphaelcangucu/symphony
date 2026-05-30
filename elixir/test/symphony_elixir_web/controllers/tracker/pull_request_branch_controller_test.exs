defmodule SymphonyElixirWeb.Tracker.PullRequestBranchControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule AcceptedClient do
    def rest_put(_path, _body, _opts), do: {:ok, %{status: 202, body: %{}}}
  end

  defmodule ConflictClient do
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

    on_exit(fn ->
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

  test "returns updated:true on success" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"data" => %{"updated" => true}} = json_response(conn, 200)
  end

  test "maps a conflict to 422" do
    Application.put_env(:symphony_elixir, :github_client_module, ConflictClient)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/remote/issues/508/pull_requests/509/update_branch")

    assert %{"error" => %{"code" => "update_branch_conflict"}} = json_response(conn, 422)
  end

  test "rejects a non-numeric pr number with 422" do
    Application.put_env(:symphony_elixir, :github_client_module, AcceptedClient)

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
