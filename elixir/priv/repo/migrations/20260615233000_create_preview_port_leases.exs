defmodule SymphonyElixir.Repo.Migrations.CreatePreviewPortLeases do
  use Ecto.Migration

  def change do
    create table(:local_tracker_preview_bands) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :band_index, :integer, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_preview_bands, [:project_id])
    create unique_index(:local_tracker_preview_bands, [:band_index])

    create table(:local_tracker_preview_issue_slots) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :issue_identifier, :string, null: false
      add :slot_index, :integer, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_preview_issue_slots, [:project_id, :issue_identifier])
    create unique_index(:local_tracker_preview_issue_slots, [:project_id, :slot_index])
  end
end
