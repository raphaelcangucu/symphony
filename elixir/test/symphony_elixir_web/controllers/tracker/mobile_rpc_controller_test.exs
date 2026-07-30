defmodule SymphonyElixirWeb.Tracker.MobileRpcControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.MobileRpc.{Device, HostIdentity, PairingOffer}
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    Repo.delete_all(Device)
    Repo.delete_all(HostIdentity)
    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")

    on_exit(fn ->
      if previous_token,
        do: System.put_env(@token_env, previous_token),
        else: System.delete_env(@token_env)
    end)

    :ok
  end

  test "creates one device-scoped direct-host pairing offer" do
    conn =
      post(authed_conn(), "/api/tracker/v1/mobile_rpc/pairing_offer", %{
        "endpoint" => "wss://studio.test/mobile/rpc",
        "host_name" => "Mac Studio",
        "device_name" => "Raphael iPhone"
      })

    assert %{
             "data" => %{
               "url" => url,
               "host_id" => host_id,
               "device_id" => device_id,
               "single_device_credential" => true
             }
           } = json_response(conn, 201)

    assert {:ok, offer} = PairingOffer.decode(url)
    assert offer["host_id"] == host_id
    assert offer["device_id"] == device_id
    assert offer["device_token"] != ""
  end

  test "lists safe paired metadata and revokes one device" do
    assert {:ok, %{offer: offer}} =
             PairingOffer.generate(
               "wss://studio.test/mobile/rpc",
               "Mac Studio",
               "Raphael iPhone"
             )

    assert {:ok, _device} =
             SymphonyElixir.MobileRpc.Devices.activate(
               offer["device_id"],
               offer["device_token"],
               1
             )

    list_conn = get(authed_conn(), "/api/tracker/v1/mobile_rpc/devices")
    assert %{"data" => %{"devices" => [device]}} = json_response(list_conn, 200)
    assert device["device_id"] == offer["device_id"]
    refute Map.has_key?(device, "token_digest")
    refute inspect(device) =~ offer["device_token"]

    delete_conn =
      delete(
        authed_conn(),
        "/api/tracker/v1/mobile_rpc/devices/#{offer["device_id"]}"
      )

    assert %{"data" => %{"revoked" => true}} = json_response(delete_conn, 200)

    assert {:error, :revoked} =
             SymphonyElixir.MobileRpc.Devices.validate_token(
               offer["device_id"],
               offer["device_token"]
             )
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
