defmodule SymphonyElixirWeb.Tracker.NotionControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Credentials
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @notion_env "NOTION_API_KEY"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    Repo.delete_all(Setting)

    previous_token = System.get_env(@token_env)
    previous_notion = System.get_env(@notion_env)
    System.put_env(@token_env, "test-token")
    System.delete_env(@notion_env)

    on_exit(fn ->
      Repo.delete_all(Setting)

      if previous_token,
        do: System.put_env(@token_env, previous_token),
        else: System.delete_env(@token_env)

      if previous_notion,
        do: System.put_env(@notion_env, previous_notion),
        else: System.delete_env(@notion_env)
    end)

    :ok
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  test "POST import without Notion API key returns credential error" do
    conn =
      post(authed_conn(), "/api/tracker/v1/notion/import", %{
        "url" => "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17"
      })

    assert %{"error" => %{"message" => message}} = json_response(conn, 422)
    assert message =~ "Settings → Providers"
    assert message =~ "NOTION_API_KEY"
  end

  test "POST import with invalid URL returns 400" do
    assert {:ok, _} = Credentials.put("notion", "api_key", "secret-notion-key")

    conn =
      post(authed_conn(), "/api/tracker/v1/notion/import", %{
        "url" => "https://example.com/not-notion"
      })

    assert %{"error" => %{"code" => "invalid_notion_url", "message" => message}} =
             json_response(conn, 400)

    assert message =~ "Invalid Notion URL"
  end

  test "GET show returns markdown meta and assets from tmp import tree" do
    import_id = Ecto.UUID.generate()
    root = Path.join([System.tmp_dir!(), "symphony-notion", import_id])
    assets_dir = Path.join(root, "assets")
    File.mkdir_p!(assets_dir)

    meta = %{
      "source_url" => "https://www.notion.so/example",
      "notion_id" => "39c33f2e-afc1-4020-ac9b-c223b4520d17",
      "kind" => "page",
      "title" => "Preview Page",
      "imported_at" => "2026-07-17T00:00:00Z",
      "asset_count" => 1,
      "warnings" => []
    }

    File.write!(Path.join(root, "meta.json"), Jason.encode!(meta))
    File.write!(Path.join(root, "page.md"), "# Preview Page\n\nHello from Notion.\n")
    File.write!(Path.join(assets_dir, "image.png"), <<0, 1, 2>>)

    on_exit(fn -> File.rm_rf(root) end)

    conn = get(authed_conn(), "/api/tracker/v1/notion/imports/#{import_id}")

    assert %{
             "data" => %{
               "meta" => %{"title" => "Preview Page", "kind" => "page"},
               "markdown" => markdown,
               "assets" => ["image.png"]
             }
           } = json_response(conn, 200)

    assert markdown =~ "Hello from Notion"
  end

  test "GET show returns 404 when import is missing" do
    import_id = Ecto.UUID.generate()
    conn = get(authed_conn(), "/api/tracker/v1/notion/imports/#{import_id}")
    assert %{"error" => %{"code" => "notion_import_not_found"}} = json_response(conn, 404)
  end

  test "GET show rejects non-UUID and traversal-like import ids" do
    conn = get(authed_conn(), "/api/tracker/v1/notion/imports/not-a-uuid")
    assert %{"error" => %{"code" => "invalid_import_id"}} = json_response(conn, 400)

    # Keep `..` inside a single path segment so Plug does not normalize it away.
    conn = get(authed_conn(), "/api/tracker/v1/notion/imports/abc..def")
    assert %{"error" => %{"code" => "invalid_import_id"}} = json_response(conn, 400)
  end

  test "requests without the bearer token are unauthorized" do
    conn = post(build_conn(), "/api/tracker/v1/notion/import", %{"url" => "https://www.notion.so/x"})
    assert conn.status == 401
  end
end
