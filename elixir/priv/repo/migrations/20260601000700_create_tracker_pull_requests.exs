defmodule SymphonyElixir.Repo.Migrations.CreateTrackerPullRequests do
  use Ecto.Migration

  def change do
    create table(:tracker_pull_requests) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:remote_id, :string, null: false)
      add(:number, :integer)
      add(:url, :string)
      add(:title, :string)
      add(:state, :string, null: false)
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_pull_requests, [:issue_id, :remote_id]))
  end
end
