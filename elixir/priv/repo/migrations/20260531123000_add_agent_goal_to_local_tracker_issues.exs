defmodule SymphonyElixir.Repo.Migrations.AddAgentGoalToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:agent_goal, :text)
    end
  end
end
