defmodule SymphonyElixir.Repo.Migrations.KeyTrackerPullRequestsByProjectIdentifier do
  use Ecto.Migration

  @moduledoc """
  Decouples PR associations from locally-mirrored issue rows so they work in
  live tracker mode (where `local_tracker_issues` is empty). PRs are keyed by
  `(project_id, issue_identifier)`. `issue_id` is kept (nullable) for the
  local-first sync path. The table is rebuilt because SQLite cannot drop a NOT
  NULL constraint in place; it holds no production data yet.
  """

  def up do
    drop(table(:tracker_pull_requests))

    create table(:tracker_pull_requests) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_identifier, :string, null: false)
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: true)
      add(:remote_id, :string, null: false)
      add(:number, :integer)
      add(:url, :string)
      add(:title, :string)
      add(:state, :string, null: false)
      add(:repo, :string)
      add(:origin, :string, null: false, default: "auto")
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_pull_requests, [:project_id, :issue_identifier, :remote_id]))
    create(index(:tracker_pull_requests, [:issue_id]))
  end

  def down do
    drop(table(:tracker_pull_requests))

    create table(:tracker_pull_requests) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:remote_id, :string, null: false)
      add(:number, :integer)
      add(:url, :string)
      add(:title, :string)
      add(:state, :string, null: false)
      add(:repo, :string)
      add(:origin, :string, null: false, default: "auto")
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_pull_requests, [:issue_id, :remote_id]))
  end
end
