defmodule SymphonyElixir.Repo.Migrations.CreateMobilePushSubscriptions do
  use Ecto.Migration

  def change do
    create table(:mobile_push_subscriptions) do
      add(:profile_id, :string, null: false)
      add(:device_id, :string, null: false)
      add(:platform, :string, null: false)
      add(:token_ciphertext, :text, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:mobile_push_subscriptions, [:profile_id, :device_id]))
  end
end
