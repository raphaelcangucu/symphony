defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerIssues do
  use Ecto.Migration

  def change do
    create table(:local_tracker_issues) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:status_id, references(:local_tracker_workflow_statuses, on_delete: :restrict), null: false)
      add(:identifier, :string, null: false)
      add(:title, :string, null: false)
      add(:description, :text)
      add(:priority, :integer)
      add(:position, :integer, null: false, default: 0)
      add(:assignee_id, :string)
      add(:worker_id, :string)
      add(:branch_name, :string)
      add(:url, :string)
      add(:started_at, :utc_datetime_usec)
      add(:completed_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_issues, [:project_id, :identifier]))
    create(index(:local_tracker_issues, [:project_id, :status_id, :position]))
    create(index(:local_tracker_issues, [:updated_at]))
  end
end
