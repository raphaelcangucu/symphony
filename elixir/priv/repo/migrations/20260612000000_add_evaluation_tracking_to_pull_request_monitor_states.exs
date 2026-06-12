defmodule SymphonyElixir.Repo.Migrations.AddEvaluationTrackingToPullRequestMonitorStates do
  use Ecto.Migration

  def change do
    alter table(:pull_request_monitor_states) do
      add(:last_checked_at, :utc_datetime_usec)
      add(:last_event, :string)
    end

    create(index(:pull_request_monitor_states, [:last_checked_at]))
  end
end
