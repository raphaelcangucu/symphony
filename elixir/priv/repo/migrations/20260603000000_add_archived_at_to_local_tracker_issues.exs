defmodule SymphonyElixir.Repo.Migrations.AddArchivedAtToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:archived_at, :utc_datetime_usec)
    end

    create(index(:local_tracker_issues, [:archived_at]))
  end
end
