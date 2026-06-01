defmodule SymphonyElixir.Repo.Migrations.AddRemoteIdToLocalTrackerLabels do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_labels) do
      add(:remote_id, :string)
    end

    create(
      unique_index(:local_tracker_labels, [:project_id, :remote_id],
        where: "remote_id IS NOT NULL",
        name: :local_tracker_labels_project_id_remote_id_index
      )
    )
  end
end
