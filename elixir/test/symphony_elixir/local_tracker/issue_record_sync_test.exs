defmodule SymphonyElixir.LocalTracker.IssueRecordSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    status = Repo.all(SymphonyElixir.LocalTracker.WorkflowStatus) |> hd()
    %{project: project, status: status}
  end

  test "changeset accepts sync metadata fields", %{project: project, status: status} do
    now = DateTime.utc_now()

    attrs = %{
      project_id: project.id,
      status_id: status.id,
      identifier: "507",
      title: "Synced issue",
      position: 0,
      remote_id: "I_kwDO123",
      remote_number: 507,
      remote_url: "https://github.com/o/r/issues/507",
      sync_status: "synced",
      remote_updated_at: now,
      last_synced_at: now,
      dirty_fields: %{"title" => DateTime.to_iso8601(now)},
      last_sync_error: nil
    }

    assert {:ok, record} =
             %IssueRecord{} |> IssueRecord.changeset(attrs) |> Repo.insert()

    assert record.remote_id == "I_kwDO123"
    assert record.remote_number == 507
    assert record.sync_status == "synced"
    assert record.dirty_fields == %{"title" => DateTime.to_iso8601(now)}
  end

  test "sync_status defaults to synced when omitted", %{project: project, status: status} do
    attrs = %{project_id: project.id, status_id: status.id, identifier: "1", title: "Local", position: 0}
    assert {:ok, record} = %IssueRecord{} |> IssueRecord.changeset(attrs) |> Repo.insert()
    assert record.sync_status == "synced"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
