defmodule SymphonyElixir.Repo.Migrations.AddAssigneeRemoteIdToLocalTrackerIssues do
  use Ecto.Migration

  # `assignee_id` holds a human-readable assignee (GitHub login, but a display
  # name for Linear/Jira). `assignee_remote_id` holds the provider's canonical
  # identifier (GitHub login / Linear user id / Jira accountId) so the
  # orchestrator can match "assigned to me" reliably across providers.
  def up do
    alter table(:local_tracker_issues) do
      add(:assignee_remote_id, :string)
    end

    create(index(:local_tracker_issues, [:project_id, :assignee_remote_id]))

    # Backfill providers where the stored display assignee already IS the
    # canonical id (GitHub login / local login). Linear/Jira rows repopulate on
    # their next sync once the adapters emit the canonical id.
    execute("""
    UPDATE local_tracker_issues
    SET assignee_remote_id = assignee_id
    WHERE assignee_id IS NOT NULL
      AND project_id IN (
        SELECT id FROM local_tracker_projects WHERE tracker_kind IN ('github', 'local')
      )
    """)
  end

  def down do
    drop(index(:local_tracker_issues, [:project_id, :assignee_remote_id]))

    alter table(:local_tracker_issues) do
      remove(:assignee_remote_id)
    end
  end
end
