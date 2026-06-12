defmodule SymphonyElixirWeb.Tracker.PushControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.PushNotifications.Subscriptions
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    Repo.delete_all(SymphonyElixir.PushNotifications.Subscription)
    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")

    previous_public = Application.get_env(:web_push_elixir, :vapid_public_key)
    previous_private = Application.get_env(:web_push_elixir, :vapid_private_key)
    previous_subject = Application.get_env(:web_push_elixir, :vapid_subject)

    Application.put_env(:web_push_elixir, :vapid_public_key, "test-public-key")
    Application.put_env(:web_push_elixir, :vapid_private_key, "test-private-key")
    Application.put_env(:web_push_elixir, :vapid_subject, "mailto:test@example.com")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:web_push_elixir, :vapid_public_key, previous_public)
      restore_app_env(:web_push_elixir, :vapid_private_key, previous_private)
      restore_app_env(:web_push_elixir, :vapid_subject, previous_subject)
    end)

    :ok
  end

  defp restore_env(_key, nil), do: System.delete_env(@token_env)
  defp restore_env(_key, value), do: System.put_env(@token_env, value)

  defp restore_app_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_app_env(app, key, value), do: Application.put_env(app, key, value)

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  @valid_subscription %{
    "endpoint" => "https://push.example.test/subscription/1",
    "keys" => %{
      "p256dh" => "BNcRdreALRFXkOouf859hxMFWkBFTS0LHv_FhoJXsCzDDJz5e3Cnx88Ypv9fc1Ph2W9zzbMxvW0J6ZX7Czhp_Ps",
      "auth" => "tBHItJI5svbpe7MdlkYEpA"
    }
  }

  test "GET /api/tracker/v1/push/config reports enabled state" do
    conn = get(authed_conn(), "/api/tracker/v1/push/config")

    assert %{
             "data" => %{
               "enabled" => true,
               "public_key" => "test-public-key",
               "subscription_count" => 0
             }
           } = json_response(conn, 200)
  end

  test "POST /api/tracker/v1/push/subscriptions upserts a browser subscription" do
    conn = post(authed_conn(), "/api/tracker/v1/push/subscriptions", @valid_subscription)
    assert %{"data" => %{"endpoint" => endpoint}} = json_response(conn, 201)
    assert endpoint == @valid_subscription["endpoint"]
    assert Subscriptions.count() == 1

    conn = post(authed_conn(), "/api/tracker/v1/push/subscriptions", @valid_subscription)
    assert %{"data" => %{"endpoint" => ^endpoint}} = json_response(conn, 201)
    assert Subscriptions.count() == 1
  end

  test "DELETE /api/tracker/v1/push/subscriptions removes by endpoint" do
    assert {:ok, _} = Subscriptions.upsert(SymphonyElixir.PushNotifications.Subscription.from_browser_map(@valid_subscription))

    conn =
      delete(authed_conn(), "/api/tracker/v1/push/subscriptions", %{
        "endpoint" => @valid_subscription["endpoint"]
      })

    assert %{"data" => %{"deleted" => true}} = json_response(conn, 200)
    assert Subscriptions.count() == 0
  end

  test "POST returns 503 when VAPID is not configured" do
    Application.delete_env(:web_push_elixir, :vapid_public_key)
    Application.delete_env(:web_push_elixir, :vapid_private_key)

    conn = post(authed_conn(), "/api/tracker/v1/push/subscriptions", @valid_subscription)
    assert %{"error" => %{"code" => "push_not_configured"}} = json_response(conn, 503)
  end
end
