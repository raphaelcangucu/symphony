defmodule SymphonyElixirWeb.Tracker.TunnelControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Cloudflare.Tunnel

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Application.delete_env(:symphony_elixir, :cloudflare_tunnel_checker)
      Application.delete_env(:symphony_elixir, :cloudflare_tunnel_spawner)
    end)

    :ok
  end

  test "start returns 409 when the public tunnel is disabled" do
    conn = post(authorized_conn(), "/api/tracker/v1/tunnel/start")

    assert json_response(conn, 409) == %{
             "error" => %{
               "code" => "public_tunnel_disabled",
               "message" => "The public preview tunnel is disabled for this workspace."
             }
           }
  end

  test "start spawns the tunnel and reports running when enabled" do
    Application.put_env(:symphony_elixir, :cloudflare_tunnel_checker, fn -> false end)
    Application.put_env(:symphony_elixir, :cloudflare_tunnel_spawner, fn _spec -> :ok end)
    start_supervised!(Tunnel)

    conn = post(authorized_conn(), "/api/tracker/v1/tunnel/start")

    assert json_response(conn, 200) == %{
             "data" => %{"enabled" => true, "running" => true}
           }
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
