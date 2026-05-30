defmodule SymphonyElixirWeb.Tracker.EditorControllerTest do
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

  test "returns disabled when the editor is off" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Editor issue", "status" => "Todo"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/editor")

    assert json_response(conn, 200) == %{"data" => %{"available" => false, "reason" => "disabled"}}
  end

  test "returns 404 for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-404/editor")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
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
