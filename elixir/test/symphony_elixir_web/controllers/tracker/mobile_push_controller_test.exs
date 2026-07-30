defmodule SymphonyElixirWeb.Tracker.MobilePushControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.PushNotifications.MobileSubscription
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Vault
  alias SymphonyElixirWeb.Tracker.MobilePushController

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    Repo.delete_all(MobileSubscription)
    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    previous_sender = Application.get_env(:symphony_elixir, :native_push_sender)
    Application.put_env(:symphony_elixir, :native_push_sender, __MODULE__.Sender)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:native_push_sender, previous_sender)
    end)

    :ok
  end

  test "registers an encrypted Expo token without presenting the token" do
    token = "ExponentPushToken[private-value]"

    conn =
      post(authed_conn(), "/api/tracker/v1/mobile_push/subscriptions", %{
        "profile_id" => "profile-1",
        "device_id" => "device-1",
        "platform" => "android",
        "token" => token
      })

    assert %{
             "data" => %{
               "registered" => true,
               "device_id" => "device-1",
               "platform" => "android"
             }
           } = response = json_response(conn, 201)

    refute inspect(response) =~ token
    subscription = Repo.one!(MobileSubscription)
    refute subscription.token_ciphertext =~ token
    assert Vault.decrypt(subscription.token_ciphertext) == {:ok, token}
  end

  test "deletes only the selected profile and device registration" do
    attrs = %{
      profile_id: "profile-1",
      device_id: "device-1",
      platform: "ios",
      token: "ExponentPushToken[first]"
    }

    assert {:ok, _subscription} =
             SymphonyElixir.PushNotifications.MobileSubscriptions.upsert(attrs)

    conn =
      delete(authed_conn(), "/api/tracker/v1/mobile_push/subscriptions", %{
        "profile_id" => "profile-1",
        "device_id" => "device-1"
      })

    assert %{"data" => %{"deleted" => true}} = json_response(conn, 200)
    assert Repo.aggregate(MobileSubscription, :count) == 0
  end

  test "keeps legacy validation for an incomplete delete payload" do
    conn =
      delete(authed_conn(), "/api/tracker/v1/mobile_push/subscriptions", %{
        "device_id" => "device-1"
      })

    assert %{"error" => %{"code" => "validation_failed"}} =
             json_response(conn, 422)
  end

  test "sends a test notification through the native sender boundary" do
    conn = post(authed_conn(), "/api/tracker/v1/mobile_push/test", %{})

    assert %{"data" => %{"sent" => true, "device_count" => 0}} =
             json_response(conn, 200)

    assert_receive {:native_push, "test", %{title: "Symphony test"}}
  end

  test "binds RPC push registration and deletion to the authenticated paired device" do
    token = "ExponentPushToken[rpc-private-value]"
    native_device_id = "expo-native-device"

    registered =
      rpc_conn("host-alpha", "paired-alpha")
      |> MobilePushController.create(%{
        "profile_id" => "forged-profile",
        "device_id" => native_device_id,
        "platform" => "android",
        "token" => token
      })

    assert %{"data" => %{"registered" => true}} = json_response(registered, 201)
    subscription = Repo.one!(MobileSubscription)
    assert subscription.profile_id == "host-alpha"
    assert subscription.owner_device_id == "paired-alpha"

    rejected =
      rpc_conn("host-alpha", "paired-beta")
      |> MobilePushController.create(%{
        "profile_id" => "host-alpha",
        "device_id" => native_device_id,
        "platform" => "android",
        "token" => "ExponentPushToken[attacker]"
      })

    assert %{"error" => %{"code" => "mobile_push_not_owned"}} =
             json_response(rejected, 403)

    not_deleted =
      rpc_conn("host-alpha", "paired-beta")
      |> MobilePushController.delete(%{
        "profile_id" => "forged-profile",
        "device_id" => native_device_id
      })

    assert %{"error" => %{"code" => "mobile_push_not_found"}} =
             json_response(not_deleted, 404)

    assert Repo.aggregate(MobileSubscription, :count) == 1

    deleted =
      rpc_conn("host-alpha", "paired-alpha")
      |> MobilePushController.delete(%{"device_id" => native_device_id})

    assert %{"data" => %{"deleted" => true}} = json_response(deleted, 200)
    assert Repo.aggregate(MobileSubscription, :count) == 0
  end

  defmodule Sender do
    def deliver_all(kind, payload) do
      send(self(), {:native_push, kind, payload})
      :ok
    end
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  defp rpc_conn(host_id, device_id) do
    build_conn()
    |> assign(:mobile_rpc_context, %{host_id: host_id, device_id: device_id})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(_key, nil), do: System.delete_env(@token_env)
  defp restore_env(_key, value), do: System.put_env(@token_env, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
