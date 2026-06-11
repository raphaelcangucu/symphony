defmodule SymphonyElixir.Repo.Migrations.CreatePullRequestMonitorStates do
  use Ecto.Migration

  def change do
    create table(:pull_request_monitor_states) do
      add(:project_slug, :string, null: false)
      add(:identifier, :string, null: false)
      add(:pr_url, :string, null: false)
      add(:last_head_sha, :string)
      add(:last_checks_fingerprint, :string)
      add(:last_review_marker, :string)
      add(:auto_rework_count, :integer, null: false, default: 0)
      add(:last_classification, :map, null: false, default: %{})
      add(:last_action, :string)
      add(:last_action_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:pull_request_monitor_states, [:project_slug, :identifier, :pr_url]))
    create(index(:pull_request_monitor_states, [:project_slug, :identifier]))
  end
end
