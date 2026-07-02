defmodule SymphonyElixirWeb.Tracker.GatewayControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Gateways.{Binding, PairingCode}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    cleanup()
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")

    on_exit(fn ->
      cleanup()
      restore_env(previous)
    end)

    :ok
  end

  test "GET /settings/gateways returns telegram settings without token plaintext" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/gateways")

    assert %{"data" => %{"telegram" => telegram}} = json_response(conn, 200)
    assert telegram["enabled"] == false
    assert telegram["botTokenConfigured"] == false
    refute Map.has_key?(telegram, "botToken")
  end

  test "PUT /settings/gateways/telegram updates telegram settings" do
    conn =
      put(authed_conn(), "/api/tracker/v1/settings/gateways/telegram", %{
        "enabled" => true,
        "pollingEnabled" => true,
        "groupChatId" => "-100123",
        "allowedUserIds" => ["777"],
        "dmAllowedUserIds" => ["777"],
        "requireMention" => false
      })

    assert %{"data" => %{"telegram" => telegram}} = json_response(conn, 200)
    assert telegram["enabled"] == true
    assert telegram["pollingEnabled"] == true
    assert telegram["groupChatId"] == "-100123"
    assert telegram["allowedUserIds"] == ["777"]
    assert telegram["dmAllowedUserIds"] == ["777"]
    assert telegram["requireMention"] == false
  end

  test "POST /settings/gateways/telegram/pairing_code returns setup command" do
    conn = post(authed_conn(), "/api/tracker/v1/settings/gateways/telegram/pairing_code")

    assert %{"data" => %{"command" => command, "code" => code}} = json_response(conn, 200)
    assert command == "/symphony_setup #{code}"
    assert is_binary(code)
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp cleanup do
    Repo.delete_all(PairingCode)
    Repo.delete_all(Binding)
    Repo.delete_all(Setting)
  end
end
