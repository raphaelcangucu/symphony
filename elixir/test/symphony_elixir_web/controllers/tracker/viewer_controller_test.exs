defmodule SymphonyElixirWeb.Tracker.ViewerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Viewer

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    unless Process.whereis(Viewer.Server) do
      {:ok, _pid} = start_supervised(Viewer.Server)
    end

    Viewer.invalidate_cache()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      Viewer.invalidate_cache()
      if previous_token, do: System.put_env(@token_env, previous_token), else: System.delete_env(@token_env)
    end)

    :ok
  end

  test "returns 200 with cached viewer payload" do
    Viewer.put_cached(%{login: "octocat", name: "Octo", avatar_url: "https://x"})

    conn = get(authorized_conn(), "/api/tracker/v1/viewer")

    assert json_response(conn, 200) == %{
             "data" => %{
               "github_login" => "octocat",
               "name" => "Octo",
               "avatar_url" => "https://x"
             }
           }
  end

  test "returns 503 github_token_missing when token absent" do
    System.delete_env("GITHUB_TOKEN")

    conn = get(authorized_conn(), "/api/tracker/v1/viewer")

    assert %{"error" => %{"code" => "github_token_missing"}} = json_response(conn, 503)
  end

  test "rejects requests without tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/viewer")

    assert json_response(conn, 401) == %{
             "error" => %{"code" => "unauthorized", "message" => "invalid tracker token"}
           }
  end

  defp authorized_conn do
    build_conn() |> put_req_header("authorization", "Bearer secret")
  end
end
