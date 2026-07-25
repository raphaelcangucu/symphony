defmodule SymphonyElixir.Repo.Migrations.CreateMobileRpcIdentityAndDevices do
  use Ecto.Migration

  def change do
    create table(:mobile_rpc_host_identities) do
      add(:singleton_key, :string, null: false, default: "default")
      add(:host_id, :string, null: false)
      add(:name, :string, null: false)
      add(:public_key, :binary, null: false)
      add(:private_key_ciphertext, :text, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:mobile_rpc_host_identities, [:singleton_key]))
    create(unique_index(:mobile_rpc_host_identities, [:host_id]))

    create table(:mobile_rpc_devices) do
      add(:device_id, :string, null: false)
      add(:name, :string, null: false)
      add(:token_digest, :binary, null: false)
      add(:scope, :string, null: false, default: "mobile")
      add(:paired_at, :utc_datetime_usec)
      add(:last_seen_at, :utc_datetime_usec)
      add(:revoked_at, :utc_datetime_usec)
      add(:protocol_version, :integer)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:mobile_rpc_devices, [:device_id]))
    create(unique_index(:mobile_rpc_devices, [:token_digest]))
    create(index(:mobile_rpc_devices, [:scope, :revoked_at, :paired_at]))
  end
end
