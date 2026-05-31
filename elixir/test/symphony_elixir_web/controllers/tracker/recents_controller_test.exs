defmodule SymphonyElixirWeb.Tracker.RecentsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, conn: authorize()}
  end

  test "GET /recents returns unified items including freeform chats", %{conn: conn} do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: System.tmp_dir!()})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "hello"})

    conn = get(conn, "/api/tracker/v1/recents?limit=20")
    body = json_response(conn, 200)
    assert %{"data" => items} = body
    assert is_list(items)
    assert Enum.any?(items, fn i -> i["kind"] == "chat" and i["scope"] == "freeform" end)

    chat = Enum.find(items, &(&1["kind"] == "chat"))
    assert is_binary(chat["id"])
    assert Map.has_key?(chat, "status_kind")
    assert Map.has_key?(chat, "updated_at")
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
