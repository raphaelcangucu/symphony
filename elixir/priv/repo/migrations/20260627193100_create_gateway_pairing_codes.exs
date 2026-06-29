defmodule SymphonyElixir.Repo.Migrations.CreateGatewayPairingCodes do
  use Ecto.Migration

  def change do
    create table(:gateway_pairing_codes) do
      add(:code, :string, null: false)
      add(:purpose, :string, null: false)
      add(:payload, :map, null: false, default: %{})
      add(:expires_at, :utc_datetime_usec, null: false)
      add(:consumed_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:gateway_pairing_codes, [:code], name: :gateway_pairing_codes_code_index))
    create(index(:gateway_pairing_codes, [:purpose, :expires_at], name: :gateway_pairing_codes_purpose_expiry_index))
  end
end
