defmodule SymphonyElixir.Repo.Migrations.CreateTrackerDismissedPullRequests do
  use Ecto.Migration

  def change do
    create table(:tracker_dismissed_pull_requests) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_identifier, :string, null: false)
      add(:url, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(
      unique_index(:tracker_dismissed_pull_requests, [:project_id, :issue_identifier, :url],
        name: :tracker_dismissed_pull_requests_project_issue_url_index
      )
    )
  end
end
