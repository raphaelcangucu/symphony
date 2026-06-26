defmodule SymphonyElixirWeb.Tracker.GitHubAssetControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    previous_github_token = System.get_env(@github_token_env)
    previous_download_fun = Application.get_env(:symphony_elixir, :github_asset_download_fun)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "ghp_test")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_env(@github_token_env, previous_github_token)
      restore_app_env(:github_asset_download_fun, previous_download_fun)
    end)

    {:ok, _github} =
      Context.ensure_project(%{
        name: "GH Asset Proxy",
        slug: "gh-asset-proxy",
        tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_1"}
      })

    {:ok, _local} = Context.ensure_project(%{name: "GH Asset Local", slug: "gh-asset-local"})

    :ok
  end

  test "streams managed asset bytes with the derived content type" do
    Application.put_env(:symphony_elixir, :github_asset_download_fun, fn _url, _headers ->
      {:ok, %{status: 200, body: <<137, 80, 78, 71>>}}
    end)

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/gh-asset-proxy/github/assets/GambaLabs/frontend/abc123.png")

    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "image/png"
    assert conn.resp_body == <<137, 80, 78, 71>>
  end

  test "returns 404 for a non-GitHub project" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/gh-asset-local/github/assets/GambaLabs/frontend/abc123.png")

    assert %{"error" => %{"code" => "issue_not_found"}} = json_response(conn, 404)
  end

  test "rejects a basename that is not content-addressed" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/gh-asset-proxy/github/assets/GambaLabs/frontend/notahash")

    assert %{"error" => %{"code" => "attachment_not_found"}} = json_response(conn, 404)
  end

  test "maps a remote 404 to attachment_not_found" do
    Application.put_env(:symphony_elixir, :github_asset_download_fun, fn _url, _headers ->
      {:ok, %{status: 404, body: ""}}
    end)

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/gh-asset-proxy/github/assets/GambaLabs/frontend/abc123.png")

    assert %{"error" => %{"code" => "attachment_not_found"}} = json_response(conn, 404)
  end

  test "rejects unauthenticated requests" do
    conn = get(build_conn(), "/api/tracker/v1/projects/gh-asset-proxy/github/assets/GambaLabs/frontend/abc123.png")
    assert json_response(conn, 401)
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

  defp restore_app_env(key, value) do
    case value do
      nil -> Application.delete_env(:symphony_elixir, key)
      val -> Application.put_env(:symphony_elixir, key, val)
    end
  end
end
