defmodule SymphonyElixir.Settings.Vault do
  @moduledoc """
  Symmetric encryption for operator secrets stored in the local SQLite settings
  table (provider tokens edited via the UI).

  Uses AES-256-GCM with a purpose-derived key from the stable per-instance
  secret. `SYMPHONY_CREDENTIALS_KEY` may provide that root explicitly;
  otherwise it is persisted beside the local tracker database.

  Encrypting at rest means a stolen `tracker.sqlite3` alone cannot reveal tokens
  without also knowing the instance secret.
  """

  @version "v1"
  @iv_bytes 12
  @tag_bytes 16
  @aad "symphony.credentials"

  alias SymphonyElixir.InstanceSecret

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
         <<iv::binary-size(@iv_bytes), tag::binary-size(@tag_bytes), ciphertext::binary>> <- binary do
      decrypt_with_candidates(iv, tag, ciphertext)
    else
      _ -> :error
    end
  rescue
    _ -> :error
  end

  def decrypt(_blob), do: :error

  defp key do
    InstanceSecret.derive("settings.vault.v1")
  end

  defp decrypt_with_candidates(iv, tag, ciphertext) do
    [key(), legacy_key()]
    |> Enum.uniq()
    |> Enum.find_value(:error, fn candidate ->
      case :crypto.crypto_one_time_aead(
             :aes_256_gcm,
             candidate,
             iv,
             ciphertext,
             @aad,
             tag,
             false
           ) do
        plaintext when is_binary(plaintext) -> {:ok, plaintext}
        _ -> false
      end
    end)
  end

  defp legacy_key do
    case System.get_env("SYMPHONY_CREDENTIALS_KEY") do
      value when is_binary(value) and value != "" ->
        case Base.decode64(String.trim(value)) do
          {:ok, <<key::binary-size(32)>>} -> key
          _ -> key()
        end

      _ ->
        secret =
          :symphony_elixir
          |> Application.get_env(SymphonyElixirWeb.Endpoint, [])
          |> Keyword.get(:secret_key_base, "")

        :crypto.hash(:sha256, secret)
    end
  end
end
