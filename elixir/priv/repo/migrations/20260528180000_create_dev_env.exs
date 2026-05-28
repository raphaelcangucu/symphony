defmodule SymphonyElixir.Repo.Migrations.CreateDevEnv do
  use Ecto.Migration

  def change do
    create table(:local_tracker_dev_env_steps) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :description, :string, null: false
      add :command, :text, null: false
      add :working_dir, :string
      add :position, :integer, null: false, default: 0
      add :source, :string, null: false, default: "manual"
      add :optional, :boolean, null: false, default: false
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_steps, [:project_id])

    create table(:local_tracker_dev_env_runs) do
      add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
      add :status, :string, null: false, default: "pending"
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_runs, [:project_id])

    create table(:local_tracker_dev_env_step_runs) do
      add :run_id, references(:local_tracker_dev_env_runs, on_delete: :delete_all), null: false
      add :step_id, references(:local_tracker_dev_env_steps, on_delete: :nilify_all)
      add :description, :string, null: false
      add :command, :text, null: false
      add :status, :string, null: false, default: "pending"
      add :exit_code, :integer
      add :output, :text
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:local_tracker_dev_env_step_runs, [:run_id])
  end
end
