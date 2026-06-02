defmodule SymphonyElixir.Tracker.Sync.LocalFirstAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalFirstAdapter, LocalStore, Outbox}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    project = %{project | tracker_kind: "github"}

    {:ok, _issue} =
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

    %{project: project}
  end

  test "list_issues reads from the local store", %{project: project} do
    assert {:ok, [dto]} = LocalFirstAdapter.list_issues(project, [])
    assert dto.identifier == "1"
  end

  test "move_issue updates locally and enqueues an outbox entry", %{project: project} do
    assert {:ok, _dto} = LocalFirstAdapter.move_issue(project, "1", %{"status" => "Done"})

    reloaded = Repo.get_by(IssueRecord, project_id: project.id, identifier: "1")
    assert reloaded.sync_status == "pending"
    assert Outbox.pending_count(project.id) == 1
  end

  test "add_comment stores locally and enqueues", %{project: project} do
    assert {:ok, _comment} = LocalFirstAdapter.add_comment(project, "1", "hello", %{})
    assert Outbox.pending_count(project.id) == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
