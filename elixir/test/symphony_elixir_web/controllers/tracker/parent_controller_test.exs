defmodule SymphonyElixirWeb.Tracker.ParentControllerTest do
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

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Parent", status: "Todo"})
    {:ok, _child} = Context.create_issue("macro-markets", %{title: "Child", status: "Todo"})

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    :ok
  end

  test "POST parent sets the parent identifier" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/parent", %{
        "parent_identifier" => "MAC-1"
      })

    assert %{"data" => data} = json_response(conn, 200)
    assert data["parent_identifier"] == "MAC-1"
    assert {:ok, ["MAC-2"]} = Context.list_subtask_children("macro-markets", "MAC-1")
  end

  test "POST parent without parent_identifier is 422" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/parent", %{})
    assert json_response(conn, 422)
  end

  test "POST parent with self is 422" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/parent", %{
        "parent_identifier" => "MAC-1"
      })

    assert %{"error" => %{"code" => "cannot_parent_self"}} = json_response(conn, 422)
  end

  test "DELETE parent clears the parent identifier" do
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")

    conn = delete(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/parent")

    assert %{"data" => data} = json_response(conn, 200)
    assert data["parent_identifier"] == nil
    assert {:ok, []} = Context.list_subtask_children("macro-markets", "MAC-1")
  end

  test "POST subtasks creates a child linked to the parent" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/subtasks", %{
        "title" => "Generated subtask"
      })

    assert %{"data" => data} = json_response(conn, 201)
    assert data["title"] == "Generated subtask"
    assert data["parent_identifier"] == "MAC-1"

    assert {:ok, children} = Context.list_subtask_children("macro-markets", "MAC-1")
    assert data["identifier"] in children
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
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
