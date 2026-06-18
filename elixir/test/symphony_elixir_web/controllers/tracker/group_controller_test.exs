defmodule SymphonyElixirWeb.Tracker.GroupControllerTest do
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
    {:ok, _lead} = Context.create_issue("macro-markets", %{title: "Lead", status: "Todo"})
    {:ok, _member} = Context.create_issue("macro-markets", %{title: "Member", status: "Todo"})

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "POST groups the issue under the lead" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{
        "lead_identifier" => "MAC-1"
      })

    assert %{"data" => data} = json_response(conn, 201)
    assert data["group_lead_identifier"] == "MAC-1"
  end

  test "POST without lead_identifier is 422" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group", %{})
    assert json_response(conn, 422)
  end

  test "POST grouping with self is 422" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/group", %{
        "lead_identifier" => "MAC-1"
      })

    assert %{"error" => %{"code" => "cannot_group_with_self"}} = json_response(conn, 422)
  end

  test "DELETE ungroups the issue" do
    {:ok, _} = Context.set_issue_group("macro-markets", "MAC-2", "MAC-1")
    conn = delete(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-2/group")
    assert response(conn, 204)
    assert {:ok, []} = Context.list_group_members("macro-markets", "MAC-1")
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
