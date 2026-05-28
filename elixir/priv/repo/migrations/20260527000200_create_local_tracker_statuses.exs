defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerStatuses do
  use Ecto.Migration

  def change do
    create table(:local_tracker_workflow_statuses) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:name, :string, null: false)
      add(:category, :string, null: false, default: "active")
      add(:position, :integer, null: false)
      add(:is_terminal, :boolean, null: false, default: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_workflow_statuses, [:project_id, :name]))
    create(index(:local_tracker_workflow_statuses, [:project_id, :position]))
  end
end
