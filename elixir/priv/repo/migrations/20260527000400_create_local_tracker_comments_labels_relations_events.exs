defmodule SymphonyElixir.Repo.Migrations.CreateLocalTrackerCommentsLabelsRelationsEvents do
  use Ecto.Migration

  def change do
    create table(:local_tracker_comments) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:kind, :string, null: false, default: "comment")
      add(:body, :text, null: false)
      add(:author, :string, null: false, default: "local")

      timestamps(type: :utc_datetime_usec)
    end

    create table(:local_tracker_labels) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:name, :string, null: false)
      add(:color, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create table(:local_tracker_issue_labels, primary_key: false) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:label_id, references(:local_tracker_labels, on_delete: :delete_all), null: false)
    end

    create table(:local_tracker_issue_relations) do
      add(:source_issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:target_issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:type, :string, null: false)

      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create table(:local_tracker_activity_events) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:event_type, :string, null: false)
      add(:metadata, :map, null: false, default: %{})

      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create(index(:local_tracker_comments, [:issue_id, :inserted_at]))
    create(unique_index(:local_tracker_labels, [:project_id, :name]))
    create(unique_index(:local_tracker_issue_labels, [:issue_id, :label_id]))
    create(unique_index(:local_tracker_issue_relations, [:source_issue_id, :target_issue_id, :type]))
    create(index(:local_tracker_activity_events, [:issue_id, :inserted_at]))
  end
end
