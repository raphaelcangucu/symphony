defmodule SymphonyElixirWeb.Tracker.ProjectSessionControllerTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    {:ok, _project} = Context.ensure_project(%{name: "Sessions", slug: "sessions"})

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, conn: authorize()}
  end

  test "GET /projects/:slug/sessions returns paginated lightweight rows", %{conn: conn} do
    older = insert_thread!("Older title", ~U[2026-07-01 10:00:00.000000Z])
    newer = insert_thread!("Newer title", ~U[2026-07-01 11:00:00.000000Z])

    conn = get(conn, "/api/tracker/v1/projects/sessions/sessions?limit=1")
    body = json_response(conn, 200)

    assert %{"data" => [row], "meta" => meta} = body
    assert row["id"] == "thread:#{newer.id}"
    assert row["title"] == "Newer title"
    assert row["kind"] == "workspace_session"
    assert row["href"] == "/tracker/projects/sessions/workspaces/#{newer.id}"
    assert is_binary(row["updated_at"])
    assert row["aggregate_status"] == "active"
    assert row["agent_kind"] == "codex"
    assert row["issue_identifier"] == nil
    assert row["workspace_path"] == newer.workspace_path
    assert row["workspace_id"] == "workspace-1"
    assert row["pinned"] == false
    assert row["archived"] == false
    refute Map.has_key?(row, "description")

    assert %{"next_cursor" => cursor, "project_activity_at" => activity_at} = meta
    assert is_binary(cursor)
    assert activity_at == row["updated_at"]

    next_conn = get(conn, "/api/tracker/v1/projects/sessions/sessions?limit=1&cursor=#{cursor}")
    assert %{"data" => [older_row], "meta" => %{"next_cursor" => nil}} = json_response(next_conn, 200)
    assert older_row["id"] == "thread:#{older.id}"
    assert older_row["title"] == "Older title"
  end

  test "GET /projects/:slug/sessions rejects an invalid cursor", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/projects/sessions/sessions?cursor=not-valid!!")

    assert %{"error" => %{"code" => "invalid_cursor"}} = json_response(conn, 422)
  end

  defp insert_thread!(title, updated_at) do
    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "project_session",
        project_slug: "sessions",
        title: title,
        workspace_path: "/tmp/#{String.downcase(String.replace(title, " ", "-"))}",
        status: "active",
        metadata: %{"workspace_id" => "workspace-1"},
        agent_kind: "codex"
      })
      |> Repo.insert()

    {1, _} = Repo.update_all(from(thread in Thread, where: thread.id == ^thread.id), set: [updated_at: updated_at])
    Repo.get!(Thread, thread.id)
  end

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
