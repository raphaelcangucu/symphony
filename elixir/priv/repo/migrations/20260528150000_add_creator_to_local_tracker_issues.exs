defmodule SymphonyElixir.Repo.Migrations.AddCreatorToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:creator, :string)
    end
  end
end
