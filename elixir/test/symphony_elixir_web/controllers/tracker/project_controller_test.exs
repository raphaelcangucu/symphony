defmodule SymphonyElixirWeb.Tracker.ProjectControllerTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.HotpathCache
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    clear_projects_cache()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    {:ok, _project} = Context.ensure_project(%{name: "Activity", slug: "activity"})

    on_exit(fn ->
      clear_projects_cache()
      restore_env(@token_env, previous_token)
    end)

    {:ok, conn: authorize()}
  end

  test "GET /projects includes last_activity_at from threads and issues", %{conn: conn} do
    thread_at = ~U[2026-07-10 12:00:00.000000Z]
    issue_at = ~U[2026-07-11 15:30:00.000000Z]

    insert_thread!("Thread session", thread_at)
    {:ok, issue} = Context.create_issue("activity", %{title: "Board issue"})
    {1, _} = Repo.update_all(from(issue in SymphonyElixir.LocalTracker.IssueRecord, where: issue.id == ^issue.id), set: [updated_at: issue_at])

    conn = get(conn, "/api/tracker/v1/projects")
    body = json_response(conn, 200)

    assert %{"data" => [project]} = body
    assert project["slug"] == "activity"
    assert project["last_activity_at"] == "2026-07-11T15:30:00Z"
  end

  test "GET /projects returns null last_activity_at when project has no sessions or issues", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/projects")
    body = json_response(conn, 200)

    assert %{"data" => [project]} = body
    assert project["slug"] == "activity"
    assert is_nil(project["last_activity_at"])
  end

  defp insert_thread!(title, updated_at) do
    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "project_session",
        project_slug: "activity",
        title: title,
        workspace_path: "/tmp/#{String.downcase(String.replace(title, " ", "-"))}",
        status: "active",
        metadata: %{},
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

  defp clear_projects_cache do
    HotpathCache.invalidate({:tracker_projects_index, false})
    HotpathCache.invalidate({:tracker_projects_index, true})
  end
end
