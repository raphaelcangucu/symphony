defmodule SymphonyElixir.MobileRpc.CryptoTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Crypto

  @fixture_path Path.expand(
                  "../../../../docs/superpowers/specs/fixtures/mobile-rpc-crypto-v1.json",
                  __DIR__
                )

  setup_all do
    {:ok, Jason.decode!(File.read!(@fixture_path))}
  end

  test "matches the fixed X25519 shared-secret vector from both peers", vector do
    x25519 = vector["x25519"]
    client_secret = hex!(x25519["client_secret_hex"])
    host_secret = hex!(x25519["host_secret_hex"])

    assert {:ok, client_public} = Crypto.public_key(client_secret)
    assert {:ok, host_public} = Crypto.public_key(host_secret)
    assert hex(client_public) == x25519["client_public_hex"]
    assert hex(host_public) == x25519["host_public_hex"]

    assert {:ok, client_shared} = Crypto.shared_secret(client_secret, host_public)
    assert {:ok, host_shared} = Crypto.shared_secret(host_secret, client_public)
    assert client_shared == host_shared
    assert hex(client_shared) == x25519["shared_secret_hex"]
  end

  test "implements RFC 5869 HKDF-SHA-256 and derives directional session keys", vector do
    rfc = vector["hkdf_rfc5869_case_1"]

    assert {:ok, %{prk: prk, okm: okm}} =
             Crypto.hkdf_sha256(
               hex!(rfc["ikm_hex"]),
               hex!(rfc["salt_hex"]),
               hex!(rfc["info_hex"]),
               rfc["length"]
             )

    assert hex(prk) == rfc["prk_hex"]
    assert hex(okm) == rfc["okm_hex"]

    assert {:ok, keys} =
             Crypto.derive_session(
               hex!(vector["x25519"]["shared_secret_hex"]),
               hex!(vector["session"]["transcript_hash_hex"]),
               hex!(vector["session"]["salt_hex"])
             )

    assert hex(keys.client_to_host) == vector["session"]["client_to_host_key_hex"]
    assert hex(keys.host_to_client) == vector["session"]["host_to_client_key_hex"]
  end

  test "matches and decrypts the ChaCha20-Poly1305 frame vector", vector do
    frame = vector["client_to_host"]
    key = hex!(vector["session"]["client_to_host_key_hex"])
    sequence = String.to_integer(frame["sequence"])

    assert {:ok, nonce} = Crypto.nonce_for_sequence(sequence)
    assert {:ok, aad} = Crypto.aad_for_frame(:client_to_host, sequence)
    assert hex(nonce) == frame["nonce_hex"]
    assert hex(aad) == frame["aad_hex"]

    assert {:ok, encrypted} =
             Crypto.encrypt_frame(
               key,
               :client_to_host,
               sequence,
               frame["plaintext_utf8"]
             )

    assert hex(encrypted) == frame["ciphertext_hex"] <> frame["tag_hex"]

    assert {:ok, frame["plaintext_utf8"]} ==
             Crypto.decrypt_frame(key, :client_to_host, sequence, encrypted)
  end

  test "rejects authentication changes without consuming sequence and rejects replay", vector do
    keys = %{
      client_to_host: hex!(vector["session"]["client_to_host_key_hex"]),
      host_to_client: hex!(vector["session"]["host_to_client_key_hex"])
    }

    sender = Crypto.new_session(keys)
    receiver = Crypto.new_session(keys)
    assert {:ok, encrypted, sender} = Crypto.encrypt(sender, :client_to_host, 1, "heartbeat")

    changed = flip_last_byte(encrypted)

    assert {:error, :authentication_failed} =
             Crypto.decrypt(receiver, :client_to_host, 1, changed)

    assert {:ok, "heartbeat", receiver} =
             Crypto.decrypt(receiver, :client_to_host, 1, encrypted)

    assert {:error, :invalid_sequence} =
             Crypto.decrypt(receiver, :client_to_host, 1, encrypted)

    assert {:error, :invalid_sequence} =
             Crypto.decrypt(receiver, :client_to_host, 3, encrypted)

    assert {:error, :invalid_sequence} =
             Crypto.encrypt(sender, :host_to_client, 0, "heartbeat")
  end

  defp hex!(value), do: Base.decode16!(value, case: :mixed)
  defp hex(value), do: Base.encode16(value, case: :lower)

  defp flip_last_byte(binary) do
    prefix_size = byte_size(binary) - 1
    <<prefix::binary-size(prefix_size), last>> = binary
    prefix <> <<Bitwise.bxor(last, 1)>>
  end
end
