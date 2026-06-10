defmodule SymphonyElixir.Settings.VaultTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Settings.Vault

  test "round-trips plaintext through encrypt/decrypt" do
    blob = Vault.encrypt("super-secret-token")

    refute blob == "super-secret-token"
    assert String.starts_with?(blob, "v1:")
    assert {:ok, "super-secret-token"} = Vault.decrypt(blob)
  end

  test "uses a fresh iv so ciphertext differs per call" do
    refute Vault.encrypt("same") == Vault.encrypt("same")
  end

  test "rejects malformed and tampered blobs" do
    assert Vault.decrypt("garbage") == :error
    assert Vault.decrypt("v1:not base64!!") == :error
    assert Vault.decrypt("v1:" <> Base.encode64("short")) == :error
    assert Vault.decrypt("v1:" <> Base.encode64(:crypto.strong_rand_bytes(40))) == :error
  end

  test "round-trips empty and unicode payloads" do
    assert {:ok, ""} = Vault.decrypt(Vault.encrypt(""))
    assert {:ok, "tÖken-✓"} = Vault.decrypt(Vault.encrypt("tÖken-✓"))
  end
end
