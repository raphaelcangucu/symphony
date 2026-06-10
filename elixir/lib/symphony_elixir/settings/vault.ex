defmodule SymphonyElixir.Settings.Vault do
  @moduledoc """
  Symmetric encryption for operator secrets stored in the local SQLite settings
  table (provider tokens edited via the UI).

  Uses AES-256-GCM. The key is resolved, in order:

    1. `SYMPHONY_CREDENTIALS_KEY` — base64-encoded 32 bytes (recommended for
       production; rotate by re-saving each credential).
    2. Otherwise derived as `SHA-256(secret_key_base)`, so encryption works out
       of the box without extra configuration.

  Encrypting at rest means a stolen `tracker.sqlite3` alone cannot reveal tokens
  without also knowing the instance secret.
  """

  @key_env "SYMPHONY_CREDENTIALS_KEY"
  @version "v1"
  @iv_bytes 12
  @tag_bytes 16
  @aad "symphony.credentials"

  @doc "Encrypts plaintext into a self-describing, base64 blob."
  @spec encrypt(String.t()) :: String.t()
  def encrypt(plaintext) when is_binary(plaintext) do
    iv = :crypto.strong_rand_bytes(@iv_bytes)
    {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_256_gcm, key(), iv, plaintext, @aad, true)
    @version <> ":" <> Base.encode64(iv <> tag <> ciphertext)
  end

  @doc "Decrypts a blob produced by `encrypt/1`. Returns `:error` on tamper/mismatch."
  @spec decrypt(String.t()) :: {:ok, String.t()} | :error
  def decrypt(@version <> ":" <> encoded) when is_binary(encoded) do
    with {:ok, binary} <- Base.decode64(encoded),
         <<iv::binary-size(@iv_bytes), tag::binary-size(@tag_bytes), ciphertext::binary>> <- binary,
         plaintext when is_binary(plaintext) <-
           :crypto.crypto_one_time_aead(:aes_256_gcm, key(), iv, ciphertext, @aad, tag, false) do
      {:ok, plaintext}
    else
      _ -> :error
    end
  rescue
    _ -> :error
  end

  def decrypt(_blob), do: :error

  defp key do
    case System.get_env(@key_env) do
      value when is_binary(value) and value != "" -> resolve_env_key(value)
      _ -> derived_key()
    end
  end

  defp resolve_env_key(value) do
    case Base.decode64(String.trim(value)) do
      {:ok, <<key::binary-size(32)>>} -> key
      _ -> derived_key()
    end
  end

  defp derived_key do
    secret =
      :symphony_elixir
      |> Application.get_env(SymphonyElixirWeb.Endpoint, [])
      |> Keyword.get(:secret_key_base, "")

    :crypto.hash(:sha256, secret)
  end
end
