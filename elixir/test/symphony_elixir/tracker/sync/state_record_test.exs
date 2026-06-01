defmodule SymphonyElixir.Tracker.Sync.StateRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.StateRecord

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "inserts a sync state row with defaults", %{project: project} do
    assert {:ok, state} =
             %StateRecord{} |> StateRecord.changeset(%{project_id: project.id}) |> Repo.insert()

    assert state.status == "idle"
    assert is_nil(state.last_full_sync_at)
  end

  test "is unique per project", %{project: project} do
    {:ok, _} = %StateRecord{} |> StateRecord.changeset(%{project_id: project.id}) |> Repo.insert()

    assert {:error, changeset} =
             %StateRecord{} |> StateRecord.changeset(%{project_id: project.id}) |> Repo.insert()

    refute changeset.valid?
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_sync_state")
    Repo.query!("delete from local_tracker_projects")
  end
end
