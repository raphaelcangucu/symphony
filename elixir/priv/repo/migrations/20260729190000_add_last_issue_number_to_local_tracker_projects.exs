defmodule SymphonyElixir.Repo.Migrations.AddLastIssueNumberToLocalTrackerProjects do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_projects) do
      add(:last_issue_number, :integer, null: false, default: 0)
    end
  end
end
