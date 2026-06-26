defmodule SymphonyElixir.Repo.Migrations.CreateKbSyncStates do
  use Ecto.Migration

  def change do
    create table(:kb_sync_states) do
      add(:project_slug, :string, null: false)
      add(:repo_slug, :string, null: false)
      add(:status, :string, null: false, default: "idle")
      add(:pr_number, :integer)
      add(:pr_url, :string)
      add(:last_error, :string)
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:kb_sync_states, [:project_slug, :repo_slug]))
  end
end
