defmodule SymphonyElixir.Repo.Migrations.CreateIssueAgentSettings do
  use Ecto.Migration

  def change do
    create table(:local_tracker_issue_agent_settings) do
      add(:project_slug, :string, null: false)
      add(:identifier, :string, null: false)
      add(:agent_kind, :string)
      add(:model, :string)
      add(:effort, :string)
      add(:mode, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_issue_agent_settings, [:project_slug, :identifier]))
  end
end
