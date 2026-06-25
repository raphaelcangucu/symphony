defmodule SymphonyElixir.Repo.Migrations.AddIdentityKeysToPushSubscriptions do
  use Ecto.Migration

  def change do
    alter table(:push_subscriptions) do
      add(:identity_keys, {:array, :string}, default: [])
    end
  end
end
