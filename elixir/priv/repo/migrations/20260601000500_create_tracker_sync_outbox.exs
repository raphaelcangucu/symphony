defmodule SymphonyElixir.Repo.Migrations.CreateTrackerSyncOutbox do
  use Ecto.Migration

  def change do
    create table(:tracker_sync_outbox) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_id, references(:local_tracker_issues, on_delete: :nilify_all))
      add(:entity_type, :string, null: false)
      add(:operation, :string, null: false)
      add(:payload, :map, default: %{}, null: false)
      add(:dedup_key, :string)
      add(:status, :string, default: "pending", null: false)
      add(:attempts, :integer, default: 0, null: false)
      add(:last_error, :string)
      add(:remote_id, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:tracker_sync_outbox, [:project_id, :status]))

    create(
      unique_index(:tracker_sync_outbox, [:dedup_key],
        where: "dedup_key IS NOT NULL AND status = 'pending'",
        name: :tracker_sync_outbox_pending_dedup_index
      )
    )
  end
end
