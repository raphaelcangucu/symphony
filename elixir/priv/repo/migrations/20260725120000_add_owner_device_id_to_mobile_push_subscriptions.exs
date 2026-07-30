defmodule SymphonyElixir.Repo.Migrations.AddOwnerDeviceIdToMobilePushSubscriptions do
  use Ecto.Migration

  def change do
    alter table(:mobile_push_subscriptions) do
      add(:owner_device_id, :string)
    end

    create(index(:mobile_push_subscriptions, [:profile_id, :owner_device_id]))
  end
end
