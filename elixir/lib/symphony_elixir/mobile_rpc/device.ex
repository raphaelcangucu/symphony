defmodule SymphonyElixir.MobileRpc.Device do
  @moduledoc "One independently revocable mobile device credential."

  use Ecto.Schema

  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "mobile_rpc_devices" do
    field(:device_id, :string)
    field(:name, :string)
    field(:token_digest, :binary, redact: true)
    field(:scope, :string, default: "mobile")
    field(:paired_at, :utc_datetime_usec)
    field(:last_seen_at, :utc_datetime_usec)
    field(:revoked_at, :utc_datetime_usec)
    field(:protocol_version, :integer)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(device, attrs) do
    device
    |> cast(attrs, [
      :device_id,
      :name,
      :token_digest,
      :scope,
      :paired_at,
      :last_seen_at,
      :revoked_at,
      :protocol_version
    ])
    |> update_change(:name, &String.trim/1)
    |> validate_required([:device_id, :name, :token_digest, :scope])
    |> validate_inclusion(:scope, ["mobile"])
    |> validate_number(:protocol_version, equal_to: 1)
    |> unique_constraint(:device_id)
    |> unique_constraint(:token_digest)
  end
end
