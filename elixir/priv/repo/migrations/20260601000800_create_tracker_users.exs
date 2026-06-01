defmodule SymphonyElixir.Repo.Migrations.CreateTrackerUsers do
  use Ecto.Migration

  def change do
    create table(:tracker_users) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:remote_id, :string)
      add(:login, :string, null: false)
      add(:name, :string)
      add(:avatar_url, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_users, [:project_id, :login]))
  end
end
