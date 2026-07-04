defmodule SymphonyElixirWeb.Tracker.WorkspaceFileControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> restore_env(@token_env, previous_token) end)

    :ok
  end

  test "returns matching workspace files for the issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Files issue", "status" => "Todo"})

    workspace = Workspace.path_for_issue("MAC-1")
    File.rm_rf(workspace)
    File.mkdir_p!(Path.join(workspace, "lib"))
    File.write!(Path.join(workspace, "lib/a.ex"), "a")
    File.write!(Path.join(workspace, "lib/b.ex"), "b")
    on_exit(fn -> File.rm_rf(workspace) end)

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/files?q=a")

    assert json_response(conn, 200) == %{"data" => ["lib/a.ex"]}
  end

  test "missing workspace returns an empty list, not an error" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "No tree", "status" => "Todo"})

    workspace = Workspace.path_for_issue("MAC-1")
    File.rm_rf(workspace)
    refute File.dir?(workspace)

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/files?q=a")

    assert json_response(conn, 200) == %{"data" => []}
  end

  test "blank query returns an empty list" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Blank q", "status" => "Todo"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/files")

    assert json_response(conn, 200) == %{"data" => []}
  end

  test "returns 404 for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-404/files?q=a")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
  end

  defp authorized_conn do
    build_conn() |> put_req_header("authorization", "Bearer secret")
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
