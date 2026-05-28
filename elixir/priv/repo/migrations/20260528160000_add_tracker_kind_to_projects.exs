defmodule SymphonyElixir.Repo.Migrations.AddTrackerKindToProjects do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_projects) do
      add :tracker_kind, :string, null: false, default: "local"
      add :tracker_config, :map, null: false, default: %{}
    end

    create index(:local_tracker_projects, [:tracker_kind])
  end
end
