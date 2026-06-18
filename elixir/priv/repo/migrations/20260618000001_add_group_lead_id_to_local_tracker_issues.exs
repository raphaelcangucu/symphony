defmodule SymphonyElixir.Repo.Migrations.AddGroupLeadIdToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:group_lead_id, references(:local_tracker_issues, on_delete: :nilify_all))
    end

    create(index(:local_tracker_issues, [:group_lead_id]))
  end
end
