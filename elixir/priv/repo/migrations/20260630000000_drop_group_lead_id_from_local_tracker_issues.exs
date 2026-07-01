defmodule SymphonyElixir.Repo.Migrations.DropGroupLeadIdFromLocalTrackerIssues do
  use Ecto.Migration

  # Grouping is retired in favor of a pure parent/child hierarchy. Convert any
  # existing group members into `sub_issue_of` relations (member -> lead) so no
  # data is lost, then drop the column and its index. `INSERT OR IGNORE` respects
  # the relations' unique (source, target, type) constraint, so a member that is
  # already a sub-issue of its lead is left untouched.
  def up do
    execute("""
    INSERT OR IGNORE INTO local_tracker_issue_relations
      (source_issue_id, target_issue_id, type, remote_origin, inserted_at)
    SELECT id, group_lead_id, 'sub_issue_of', 0, CURRENT_TIMESTAMP
    FROM local_tracker_issues
    WHERE group_lead_id IS NOT NULL
    """)

    drop(index(:local_tracker_issues, [:group_lead_id]))

    alter table(:local_tracker_issues) do
      remove(:group_lead_id)
    end
  end

  def down do
    alter table(:local_tracker_issues) do
      add(:group_lead_id, references(:local_tracker_issues, on_delete: :nilify_all))
    end

    create(index(:local_tracker_issues, [:group_lead_id]))
  end
end
