defmodule SymphonyElixir.Repo.Migrations.AddDevEnvWarmUp do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_runs) do
      add(:kind, :string, null: false, default: "run")
    end

    alter table(:local_tracker_projects) do
      add(:warmed_at, :utc_datetime_usec)
      add(:warm_up_status, :string, null: false, default: "never")
      add(:last_warm_up_run_id, :integer)
    end
  end
end
