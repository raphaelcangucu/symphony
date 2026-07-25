defmodule SymphonyElixir.MobileRpc.HandshakeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.{Crypto, Handshake, HostIdentity}
  alias SymphonyElixir.Settings.Vault

  @client_secret :binary.list_to_bin(Enum.to_list(101..132))
  @client_nonce :binary.list_to_bin(Enum.to_list(11..42))
  @server_nonce :binary.list_to_bin(Enum.to_list(201..232))

  setup do
    {host_public, host_private} = :crypto.generate_key(:ecdh, :x25519)

    identity = %HostIdentity{
      host_id: "host_01",
      name: "Mac Studio",
      public_key: host_public,
      private_key_ciphertext: Vault.encrypt(Base.encode64(host_private))
    }

    %{identity: identity, host_private: host_private}
  end

  test "negotiates v1 and authenticates only from the first encrypted frame", %{
    identity: identity,
    host_private: host_private
  } do
    client_public = public_key!(@client_secret)
    hello = hello(identity.host_id, client_public)

    assert {:ok, handshake} =
             Handshake.new(identity,
               random_bytes: fn 32 -> @server_nonce end,
               authenticate: fn "device_01", "device-secret", 1 ->
                 {:ok, %{device_id: "device_01", name: "Phone"}}
               end
             )

    assert {:push, server_hello_raw, awaiting_auth} =
             Handshake.receive_text(Jason.encode!(hello), handshake)

    assert awaiting_auth.phase == :awaiting_auth
    refute server_hello_raw =~ "device-secret"

    auth_frame =
      encrypted_auth_frame(
        hello,
        server_hello_raw,
        host_private,
        %{
          "type" => "auth",
          "device_id" => "device_01",
          "device_token" => "device-secret",
          "transcript_hash" => Base.url_encode64(awaiting_auth.transcript_hash, padding: false)
        }
      )

    assert {:push, ready_frame, ready} = Handshake.receive_binary(auth_frame, awaiting_auth)
    assert ready.phase == :ready
    assert ready.device_id == "device_01"

    assert {:ok, ready_payload, _session} =
             decrypt_host_frame(ready_frame, ready.session, 1)

    assert Jason.decode!(ready_payload) == %{
             "type" => "authenticated",
             "host_id" => identity.host_id,
             "protocol" => 1
           }

    rpc_request = Jason.encode!(%{"type" => "rpc", "id" => "rpc_1", "method" => "system.health", "params" => %{}})

    assert {:ok, rpc_ciphertext} =
             Crypto.encrypt_frame(
               ready.session.client_to_host,
               :client_to_host,
               2,
               rpc_request
             )

    assert {:ok, ^rpc_request, rpc_state} =
             Handshake.decrypt_rpc(<<2::unsigned-big-64, rpc_ciphertext::binary>>, ready)

    rpc_response = Jason.encode!(%{"type" => "result", "id" => "rpc_1", "ok" => true})

    assert {:ok, <<2::unsigned-big-64, response_ciphertext::binary>>, response_state} =
             Handshake.encrypt_rpc(rpc_response, rpc_state)

    assert {:ok, ^rpc_response} =
             Crypto.decrypt_frame(
               response_state.session.host_to_client,
               :host_to_client,
               2,
               response_ciphertext
             )
  end

  test "rejects incompatible protocol, wrong host and malformed client key", %{identity: identity} do
    assert {:ok, state} = Handshake.new(identity, random_bytes: fn 32 -> @server_nonce end)

    assert {:error, :protocol_incompatible, _state} =
             Handshake.receive_text(
               Jason.encode!(%{
                 hello(identity.host_id, public_key!(@client_secret))
                 | "protocol_min" => 2,
                   "protocol_max" => 3
               }),
               state
             )

    assert {:error, :host_mismatch, _state} =
             Handshake.receive_text(
               Jason.encode!(hello("host_other", public_key!(@client_secret))),
               state
             )

    assert {:error, :invalid_client_key, _state} =
             Handshake.receive_text(
               Jason.encode!(hello(identity.host_id, <<1, 2, 3>>)),
               state
             )
  end

  test "rejects transcript mismatch, invalid tokens, tamper and replay", %{
    identity: identity,
    host_private: host_private
  } do
    hello = hello(identity.host_id, public_key!(@client_secret))

    assert {:ok, initial} =
             Handshake.new(identity,
               random_bytes: fn 32 -> @server_nonce end,
               authenticate: fn _device_id, _token, _protocol -> {:error, :invalid_token} end
             )

    assert {:push, server_hello_raw, awaiting_auth} =
             Handshake.receive_text(Jason.encode!(hello), initial)

    mismatched =
      encrypted_auth_frame(
        hello,
        server_hello_raw,
        host_private,
        %{
          "type" => "auth",
          "device_id" => "device_01",
          "device_token" => "secret",
          "transcript_hash" => Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
        }
      )

    assert {:error, :transcript_mismatch, _encrypted_error, _state} =
             Handshake.receive_binary(mismatched, awaiting_auth)

    valid_auth =
      encrypted_auth_frame(
        hello,
        server_hello_raw,
        host_private,
        %{
          "type" => "auth",
          "device_id" => "device_01",
          "device_token" => "wrong",
          "transcript_hash" => Base.url_encode64(awaiting_auth.transcript_hash, padding: false)
        }
      )

    assert {:error, :unauthorized, encrypted_error, _state} =
             Handshake.receive_binary(valid_auth, awaiting_auth)

    refute encrypted_error =~ "unauthorized"

    <<prefix::binary-size(byte_size(valid_auth) - 1), last>> = valid_auth
    tampered = prefix <> <<Bitwise.bxor(last, 1)>>

    assert {:error, :authentication_failed, _state} =
             Handshake.receive_binary(tampered, awaiting_auth)

    assert {:ok, authorized} =
             Handshake.new(identity,
               random_bytes: fn 32 -> @server_nonce end,
               authenticate: fn _device_id, _token, _protocol -> {:ok, %{device_id: "device_01"}} end
             )

    assert {:push, authorized_server_hello, authorized_awaiting} =
             Handshake.receive_text(Jason.encode!(hello), authorized)

    authorized_frame =
      encrypted_auth_frame(
        hello,
        authorized_server_hello,
        host_private,
        %{
          "type" => "auth",
          "device_id" => "device_01",
          "device_token" => "secret",
          "transcript_hash" => Base.url_encode64(authorized_awaiting.transcript_hash, padding: false)
        }
      )

    assert {:push, _reply, ready} =
             Handshake.receive_binary(authorized_frame, authorized_awaiting)

    assert {:error, :invalid_sequence, _state} =
             Handshake.receive_binary(authorized_frame, ready)
  end

  defp hello(host_id, client_public) do
    %{
      "type" => "hello",
      "protocol_min" => 1,
      "protocol_max" => 1,
      "host_id" => host_id,
      "client_public_key" => Base.url_encode64(client_public, padding: false),
      "client_nonce" => Base.url_encode64(@client_nonce, padding: false)
    }
  end

  defp encrypted_auth_frame(hello, server_hello_raw, host_private, payload) do
    client_hello_raw = Jason.encode!(hello)
    transcript_hash = :crypto.hash(:sha256, client_hello_raw <> "\n" <> server_hello_raw)
    {:ok, shared_secret} = Crypto.shared_secret(@client_secret, public_key!(host_private))

    server_hello = Jason.decode!(server_hello_raw)
    server_nonce = Base.url_decode64!(server_hello["server_nonce"], padding: false)
    salt = :crypto.hash(:sha256, @client_nonce <> server_nonce)
    {:ok, keys} = Crypto.derive_session(shared_secret, transcript_hash, salt)
    {:ok, ciphertext} = Crypto.encrypt_frame(keys.client_to_host, :client_to_host, 1, Jason.encode!(payload))
    <<1::unsigned-big-64, ciphertext::binary>>
  end

  defp decrypt_host_frame(<<1::unsigned-big-64, frame::binary>>, session, 1) do
    Crypto.decrypt(session, :host_to_client, 1, frame)
  end

  defp public_key!(private_key) do
    {:ok, public_key} = Crypto.public_key(private_key)
    public_key
  end
end
