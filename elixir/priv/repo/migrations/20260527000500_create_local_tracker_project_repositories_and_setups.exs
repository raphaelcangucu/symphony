defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerProjectRepositoriesAndSetups do
  use Ecto.Migration

  def change do
    create table(:local_tracker_repositories) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:github_full_name, :string, null: false)
      add(:clone_url, :string)
      add(:default_branch, :string)
      add(:selected_branch, :string)
      add(:local_path, :string)
      add(:workspace_path, :string, null: false)
      add(:role, :string, null: false)
      add(:scan_summary, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create table(:local_tracker_project_setups) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:workflow_config, :map, null: false, default: %{})
      add(:after_create_hook, :text)
      add(:prompt_template, :text)
      add(:validation_commands, :map, null: false, default: %{"commands" => []})
      add(:scan_summary, :map, null: false, default: %{})

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_repositories, [:project_id, :workspace_path]))
    create(index(:local_tracker_repositories, [:project_id, :role]))
    create(unique_index(:local_tracker_project_setups, [:project_id]))
  end
end
