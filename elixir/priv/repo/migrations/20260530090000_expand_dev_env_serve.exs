defmodule SymphonyElixir.Repo.Migrations.ExpandDevEnvServe do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_steps) do
      add :role, :string, null: false, default: "setup"
      add :port_env, :string
      add :url_path, :string, null: false, default: "/"
      add :ready_probe, :string, null: false, default: "tcp"
      add :ready_path, :string, null: false, default: "/"
      add :primary, :boolean, null: false, default: false
    end
  end
end
