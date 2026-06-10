defmodule SymphonyElixir.Repo.Migrations.CreateIssueEvidence do
  use Ecto.Migration

  def change do
    create table(:issue_evidence) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_identifier, :string, null: false)
      add(:run_id, :string, null: false)
      add(:session_id, :string)
      add(:status, :string, null: false, default: "passed")
      add(:ui_change, :boolean, null: false, default: false)
      add(:manifest, :map, null: false, default: %{})
      add(:artifact_dir, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:issue_evidence, [:project_id, :issue_identifier, :run_id]))
    create(index(:issue_evidence, [:project_id, :issue_identifier]))
  end
end
