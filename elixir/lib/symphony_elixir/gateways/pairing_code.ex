defmodule SymphonyElixir.Gateways.PairingCode do
  @moduledoc "Short-lived one-time code for gateway setup and project-topic pairing."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  @purposes ~w(setup project_topic)

  schema "gateway_pairing_codes" do
    field(:code, :string)
    field(:purpose, :string)
    field(:payload, :map, default: %{})
    field(:expires_at, :utc_datetime_usec)
    field(:consumed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(pairing_code, attrs) when is_map(attrs) do
    pairing_code
    |> cast(attrs, [:code, :purpose, :payload, :expires_at, :consumed_at])
    |> normalize_string(:code)
    |> normalize_string(:purpose)
    |> validate_required([:code, :purpose, :payload, :expires_at])
    |> validate_inclusion(:purpose, @purposes)
    |> unique_constraint(:code, name: :gateway_pairing_codes_code_index)
  end

  defp normalize_string(changeset, field) do
    case get_change(changeset, field) do
      value when is_binary(value) ->
        put_change(changeset, field, String.trim(value))

      _other ->
        changeset
    end
  end
end
