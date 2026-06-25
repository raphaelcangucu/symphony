defmodule SymphonyElixir.Repo.Migrations.AddMergeConflictTrackingToPullRequestMonitorStates do
  use Ecto.Migration

  def change do
    alter table(:pull_request_monitor_states) do
      add(:last_merge_conflict_head_sha, :string)
    end
  end
end
