defmodule SymphonyElixirWeb.MobileRpcSocketTest do
  use ExUnit.Case, async: true

  import Plug.Conn
  import Plug.Test

  alias SymphonyElixir.MobileRpc.{AuthLimiter, Socket}
  alias SymphonyElixirWeb.MobileRpcUpgradePlug

  test "upgrades only the dedicated credential-free WebSocket route" do
    conn =
      conn(:get, "/mobile/rpc")
      |> then(&%{&1 | req_headers: [{"host", "host.test"} | &1.req_headers]})
      |> put_req_header("connection", "upgrade")
      |> put_req_header("upgrade", "websocket")
      |> put_req_header("sec-websocket-key", Base.encode64(:crypto.strong_rand_bytes(16)))
      |> put_req_header("sec-websocket-version", "13")
      |> MobileRpcUpgradePlug.call([])

    assert conn.state == :upgraded
  end

  test "rejects query-string credentials before upgrade" do
    conn =
      conn(:get, "/mobile/rpc?token=global-secret")
      |> MobileRpcUpgradePlug.call([])

    assert conn.status == 400
    assert conn.resp_body == "mobile RPC accepts no query parameters"
  end

  test "rejects plaintext authentication and closes a stalled handshake" do
    awaiting_auth = %{phase: :awaiting_auth, session: nil}

    assert {:stop, :plaintext_auth_forbidden, {1008, _reason}, ^awaiting_auth} =
             Socket.handle_in({~s({"type":"auth","device_token":"secret"}), opcode: :text}, awaiting_auth)

    awaiting_hello = %{phase: :awaiting_hello}

    assert {:stop, :handshake_timeout, {1008, _reason}, ^awaiting_hello} =
             Socket.handle_info(:handshake_timeout, awaiting_hello)
  end

  test "disconnects every live socket registered for one revoked device" do
    parent = self()
    device_id = "device_#{System.unique_integer([:positive])}"

    {socket, monitor_ref} =
      spawn_monitor(fn ->
        Registry.register(SymphonyElixir.MobileRpc.ConnectionRegistry, device_id, nil)
        send(parent, :registered)

        receive do
          :device_revoked -> send(parent, :disconnected)
        end
      end)

    assert_receive :registered
    assert :ok = Socket.disconnect_device(device_id)
    assert_receive :disconnected
    assert_receive {:DOWN, ^monitor_ref, :process, ^socket, :normal}
  end

  test "rate limits repeated failures without affecting another host address" do
    key = {:test, System.unique_integer([:positive])}
    other_key = {:test, System.unique_integer([:positive])}

    assert AuthLimiter.allowed?(key)
    Enum.each(1..5, fn _attempt -> AuthLimiter.record_failure(key) end)

    refute AuthLimiter.allowed?(key)
    assert AuthLimiter.allowed?(other_key)
    assert :ok = AuthLimiter.reset(key)
  end
end
