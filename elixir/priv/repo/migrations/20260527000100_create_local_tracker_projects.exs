defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerProjects do
  use Ecto.Migration

  def change do
    create table(:local_tracker_projects) do
      add(:name, :string, null: false)
      add(:slug, :string, null: false)
      add(:description, :text)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_projects, [:slug]))
  end
end
