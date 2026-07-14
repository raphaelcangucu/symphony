defmodule SymphonyElixir.Repo.Migrations.CreateWorkspaceDisplayNames do
  use Ecto.Migration

  def change do
    create table(:workspace_display_names) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:project_slug, :string, null: false)
      add(:workspace_path, :text, null: false)
      add(:display_name, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:workspace_display_names, [:project_id, :workspace_path]))
    create(index(:workspace_display_names, [:project_slug]))
  end
end
