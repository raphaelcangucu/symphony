defmodule SymphonyElixir.Tracker.Sync.LocalStoreDirtyTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.LocalStore

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "mark_dirty records changed fields and sets pending", %{project: project} do
    {:ok, issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_1",
        remote_number: 1,
        identifier: "1",
        title: "t",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "u",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    assert {:ok, dirty} = LocalStore.mark_dirty(issue.identifier, project.slug, [:title, :state])

    assert dirty.sync_status == "pending"
    assert Map.has_key?(dirty.dirty_fields, "title")
    assert Map.has_key?(dirty.dirty_fields, "state")
    reloaded = Repo.get(IssueRecord, issue.id)
    assert reloaded.sync_status == "pending"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- ["tracker_sync_outbox", "local_tracker_issues", "local_tracker_workflow_statuses", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end
  end
end
