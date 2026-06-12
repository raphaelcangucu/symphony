defmodule SymphonyElixir.Repo.Migrations.CreatePushSubscriptions do
  use Ecto.Migration

  def change do
    create table(:push_subscriptions) do
      add(:endpoint, :string, null: false)
      add(:p256dh, :string, null: false)
      add(:auth, :string, null: false)
      add(:user_agent, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:push_subscriptions, [:endpoint]))
  end
end
