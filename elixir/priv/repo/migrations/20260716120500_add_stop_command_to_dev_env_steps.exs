defmodule SymphonyElixir.Repo.Migrations.AddStopCommandToDevEnvSteps do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_steps) do
      add :stop_command, :string
    end
  end
end
