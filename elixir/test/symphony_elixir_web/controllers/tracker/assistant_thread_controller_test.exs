defmodule SymphonyElixirWeb.Tracker.AssistantThreadControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.{CodexSession, History}

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    :ok
  end

  test "POST creates a freeform thread" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "freeform", title: "Ideas"})

    assert %{"data" => %{"scope" => "freeform", "title" => "Ideas", "project_slug" => nil, "id" => _}} =
             json_response(conn, 201)
  end

  test "POST freeform thread stores a per-thread workspace path, not the shared root" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "freeform", title: "Scoped"})

    assert %{"data" => %{"id" => id}} = json_response(conn, 201)

    {:ok, thread} = History.get_thread(id)

    assert thread.workspace_path == CodexSession.freeform_workspace(id)
    refute thread.workspace_path == CodexSession.freeform_workspace_root()
  end

  test "GET lists freeform threads" do
    {:ok, _} = History.create_freeform_thread(%{title: "A", workspace_path: System.tmp_dir!()})

    conn = get(authorize(), "/api/tracker/v1/assistant/threads?scope=freeform")

    assert %{"data" => [%{"scope" => "freeform"} | _]} = json_response(conn, 200)
  end

  test "POST archive hides thread from list" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Old", workspace_path: System.tmp_dir!()})
    id = thread.id

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads/#{id}/archive")

    assert %{"data" => %{"id" => ^id, "status" => "archived"}} = json_response(conn, 200)
    refute Enum.any?(History.list_threads(scope: "freeform"), &(&1.id == id))
  end

  test "POST with unsupported scope returns 422" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "project"})

    assert %{"error" => %{"message" => _}} = json_response(conn, 422)
  end

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end
end
