defmodule SymphonyElixir.Repo.Migrations.AddArchivedAtToLocalTrackerProjects do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_projects) do
      add(:archived_at, :utc_datetime_usec)
    end

    create(index(:local_tracker_projects, [:archived_at]))
  end
end
