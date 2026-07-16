defmodule SymphonyElixir.Repo.Migrations.CreatePreviewRuntimeContracts do
  use Ecto.Migration

  def change do
    create table(:local_tracker_preview_runtime_contracts) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :issue_identifier, :string, null: false
      add :server_slug, :string, null: false
      add :contract_id, :string, null: false
      add :revision, :integer, null: false, default: 1
      add :source, :string, null: false
      add :preferred_port, :integer, null: false
      add :allowed_ports, {:array, :integer}, null: false, default: []
      add :report_path, :string, null: false
      add :ready_probe, :string, null: false, default: "tcp"
      add :ready_path, :string, null: false, default: "/"
      add :url_path, :string, null: false, default: "/"
      add :port_env, :string, null: false
      add :expires_at, :utc_datetime_usec, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_preview_runtime_contracts, [:project_id])

    create unique_index(:local_tracker_preview_runtime_contracts, [
             :project_id,
             :issue_identifier,
             :server_slug
           ])

    create unique_index(:local_tracker_preview_runtime_contracts, [:contract_id])
  end
end
