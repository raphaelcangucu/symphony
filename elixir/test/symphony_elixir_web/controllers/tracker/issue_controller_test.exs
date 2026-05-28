defmodule SymphonyElixirWeb.Tracker.IssueControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "rejects missing tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/projects")

    assert json_response(conn, 401) == %{
             "error" => %{"code" => "unauthorized", "message" => "invalid tracker token"}
           }
  end

  test "creates and reads projects with bearer token" do
    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects", %{
        "name" => "Macro Markets",
        "slug" => "macro-markets",
        "description" => "Local tracker project"
      })

    assert %{
             "data" => %{
               "name" => "Macro Markets",
               "slug" => "macro-markets",
               "description" => "Local tracker project",
               "statuses" => statuses
             }
           } = json_response(conn, 201)

    assert Enum.map(statuses, & &1["name"]) == [
             "Backlog",
             "Todo",
             "In Progress",
             "Human Review",
             "Merging",
             "Rework",
             "Done"
           ]

    list_conn = get(authorized_conn(), "/api/tracker/v1/projects")
    assert %{"data" => [%{"slug" => "macro-markets"}]} = json_response(list_conn, 200)

    show_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets")
    assert %{"data" => %{"slug" => "macro-markets"}} = json_response(show_conn, 200)
  end

  test "manages project issues, comments, and blockers" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    create_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues", %{
        "title" => "API issue",
        "description" => "Created through JSON API",
        "status" => "Todo",
        "priority" => 1
      })

    assert %{"data" => %{"identifier" => "MAC-1", "title" => "API issue", "status" => %{"name" => "Todo"}}} =
             json_response(create_conn, 201)

    {:ok, _blocker} = Context.create_issue("macro-markets", %{"title" => "Blocking issue", "status" => "Todo"})

    list_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues")
    assert %{"data" => [%{"identifier" => "MAC-1"}, %{"identifier" => "MAC-2"}]} = json_response(list_conn, 200)

    update_conn =
      authorized_conn()
      |> patch("/api/tracker/v1/projects/macro-markets/issues/MAC-1", %{
        "description" => "Updated through API"
      })

    assert %{"data" => %{"description" => "Updated through API"}} = json_response(update_conn, 200)

    move_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/move", %{"status" => "In Progress"})

    assert %{"data" => %{"status" => %{"name" => "In Progress"}}} = json_response(move_conn, 200)

    comment_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/comments", %{
        "body" => "Needs review",
        "author" => "api"
      })

    assert %{"data" => %{"body" => "Needs review", "author" => "api"}} = json_response(comment_conn, 201)

    list_comments_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/comments")

    assert %{"data" => [%{"body" => "Needs review", "author" => "api"}]} =
             json_response(list_comments_conn, 200)

    blocker_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers", %{
        "target_identifier" => "MAC-2"
      })

    assert %{"data" => %{"source_identifier" => "MAC-1", "target_identifier" => "MAC-2"}} =
             json_response(blocker_conn, 201)

    list_blockers_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers")

    assert %{"data" => [%{"source_identifier" => "MAC-1", "target_identifier" => "MAC-2"}]} =
             json_response(list_blockers_conn, 200)

    delete_conn =
      authorized_conn()
      |> delete("/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers/MAC-2")

    assert response(delete_conn, 204) == ""
  end

  test "returns clear errors for missing tracker records" do
    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/missing/issues", %{"title" => "No project"})

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
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
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
