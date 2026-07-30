defmodule SymphonyElixir.MobileRpc.HostIdentity do
  @moduledoc """
  Persistent static X25519 identity for one Symphony host.

  The public key is part of pairing offers. The private key is encrypted at
  rest and is only decrypted while establishing an application-encrypted RPC
  session.
  """

  use Ecto.Schema

  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Vault

  @singleton_key "default"
  @type t :: %__MODULE__{}

  schema "mobile_rpc_host_identities" do
    field(:singleton_key, :string, default: @singleton_key)
    field(:host_id, :string)
    field(:name, :string)
    field(:public_key, :binary)
    field(:private_key_ciphertext, :string, redact: true)

    timestamps(type: :utc_datetime_usec)
  end

  @spec get_or_create(String.t()) :: {:ok, t()} | {:error, Ecto.Changeset.t() | term()}
  def get_or_create(name) when is_binary(name) do
    normalized_name = String.trim(name)

    if normalized_name == "" do
      {:error, :invalid_host_name}
    else
      Repo.transaction(fn ->
        case Repo.one(from(identity in __MODULE__, limit: 1)) do
          %__MODULE__{} = identity ->
            identity

          nil ->
            {public_key, private_key} = :crypto.generate_key(:ecdh, :x25519)

            attrs = %{
              singleton_key: @singleton_key,
              host_id: random_id("host_", 18),
              name: normalized_name,
              public_key: public_key,
              private_key_ciphertext: Vault.encrypt(Base.encode64(private_key))
            }

            %__MODULE__{}
            |> changeset(attrs)
            |> Repo.insert!(
              on_conflict: :nothing,
              conflict_target: :singleton_key
            )

            Repo.get_by!(__MODULE__, singleton_key: @singleton_key)
        end
      end)
    end
  end

  @spec private_key(t()) :: {:ok, binary()} | {:error, :invalid_private_key}
  def private_key(%__MODULE__{private_key_ciphertext: ciphertext}) do
    with {:ok, encoded} <- Vault.decrypt(ciphertext),
         {:ok, <<private_key::binary-size(32)>>} <- Base.decode64(encoded) do
      {:ok, private_key}
    else
      _reason -> {:error, :invalid_private_key}
    end
  end

  defp changeset(identity, attrs) do
    identity
    |> cast(attrs, [:singleton_key, :host_id, :name, :public_key, :private_key_ciphertext])
    |> validate_required([:singleton_key, :host_id, :name, :public_key, :private_key_ciphertext])
    |> unique_constraint(:singleton_key)
    |> unique_constraint(:host_id)
  end

  defp random_id(prefix, bytes) do
    prefix <> Base.url_encode64(:crypto.strong_rand_bytes(bytes), padding: false)
  end
end
