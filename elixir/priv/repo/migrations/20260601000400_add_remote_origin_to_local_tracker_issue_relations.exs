defmodule SymphonyElixir.Repo.Migrations.AddRemoteOriginToLocalTrackerIssueRelations do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issue_relations) do
      add(:remote_origin, :boolean, default: false, null: false)
    end
  end
end
