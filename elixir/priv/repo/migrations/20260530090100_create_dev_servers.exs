defmodule SymphonyElixir.Repo.Migrations.CreateDevServers do
  use Ecto.Migration

  def change do
    create table(:local_tracker_dev_servers) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :issue_identifier, :string, null: false
      add :working_dir, :string
      add :slug, :string, null: false
      add :port, :integer
      add :url, :string
      add :status, :string, null: false, default: "stopped"
      add :primary, :boolean, null: false, default: false
      add :session_name, :string
      add :started_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_servers, [:project_id])
    create unique_index(:local_tracker_dev_servers, [:project_id, :issue_identifier, :slug])
  end
end
