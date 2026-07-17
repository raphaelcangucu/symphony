defmodule SymphonyElixir.Repo.Migrations.AddRunSpecToDevEnvSteps do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_steps) do
      add :run_spec, :map
    end
  end
end
