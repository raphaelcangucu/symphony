defmodule SymphonyElixir.Repo.Migrations.AddSyncMetadataToLocalTrackerComments do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_comments) do
      add(:remote_id, :string)
      add(:sync_status, :string, default: "synced", null: false)
      add(:remote_updated_at, :utc_datetime_usec)
      add(:last_synced_at, :utc_datetime_usec)
      add(:dirty_fields, :map, default: %{}, null: false)
    end

    create(
      unique_index(:local_tracker_comments, [:issue_id, :remote_id],
        where: "remote_id IS NOT NULL",
        name: :local_tracker_comments_issue_id_remote_id_index
      )
    )
  end
end
