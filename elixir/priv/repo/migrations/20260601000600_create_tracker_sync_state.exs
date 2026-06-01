defmodule SymphonyElixir.Repo.Migrations.CreateTrackerSyncState do
  use Ecto.Migration

  def change do
    create table(:tracker_sync_state) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:last_full_sync_at, :utc_datetime_usec)
      add(:last_incremental_cursor, :string)
      add(:last_pull_at, :utc_datetime_usec)
      add(:last_push_at, :utc_datetime_usec)
      add(:status, :string, default: "idle", null: false)
      add(:last_error, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_sync_state, [:project_id]))
  end
end
