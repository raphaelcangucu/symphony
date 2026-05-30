defmodule SymphonyElixir.Repo.Migrations.AddAgentSessionIdToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:agent_session_id, :string)
    end
  end
end
