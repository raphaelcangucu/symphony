defmodule SymphonyElixir.Repo.Migrations.AddSyncMetadataToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:remote_id, :string)
      add(:remote_number, :integer)
      add(:remote_url, :string)
      add(:sync_status, :string, default: "synced", null: false)
      add(:remote_updated_at, :utc_datetime_usec)
      add(:last_synced_at, :utc_datetime_usec)
      add(:dirty_fields, :map, default: %{}, null: false)
      add(:last_sync_error, :string)
    end

    create(
      unique_index(:local_tracker_issues, [:project_id, :remote_id],
        where: "remote_id IS NOT NULL",
        name: :local_tracker_issues_project_id_remote_id_index
      )
    )
  end
end
