defmodule SymphonyElixir.Tracker.Sync.OutboxTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Outbox, OutboxEntry}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "enqueue inserts a pending entry", %{project: project} do
    assert {:ok, entry} =
             Outbox.enqueue(%{
               project_id: project.id,
               entity_type: "state",
               operation: "move",
               payload: %{"state" => "Done"},
               dedup_key: "state:move:issue-1"
             })

    assert entry.status == "pending"
    assert Repo.aggregate(OutboxEntry, :count) == 1
  end

  test "enqueue coalesces a repeated dedup_key by merging payload", %{project: project} do
    base = %{project_id: project.id, entity_type: "state", operation: "move", dedup_key: "state:move:issue-1"}

    {:ok, first} = Outbox.enqueue(Map.put(base, :payload, %{"state" => "Todo"}))
    {:ok, second} = Outbox.enqueue(Map.put(base, :payload, %{"state" => "Done"}))

    assert first.id == second.id
    assert second.payload == %{"state" => "Done"}
    assert Repo.aggregate(OutboxEntry, :count) == 1
  end

  test "pending_count counts only pending entries", %{project: project} do
    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{}, dedup_key: "c1"})
    assert Outbox.pending_count(project.id) == 1
  end

  test "claim_pending marks entries in_flight oldest-first", %{project: project} do
    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{"n" => 1}, dedup_key: "a"})
    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{"n" => 2}, dedup_key: "b"})

    claimed = Outbox.claim_pending(project.id, 10)

    assert length(claimed) == 2
    assert Enum.all?(claimed, &(&1.status == "in_flight"))
    assert Outbox.pending_count(project.id) == 0
  end

  test "mark_done closes an entry and stores remote_id", %{project: project} do
    {:ok, _entry} = Outbox.enqueue(%{project_id: project.id, entity_type: "issue", operation: "create", payload: %{}, dedup_key: "i"})
    [claimed] = Outbox.claim_pending(project.id, 10)
    assert {:ok, done} = Outbox.mark_done(claimed, "I_remote")
    assert done.status == "done"
    assert done.remote_id == "I_remote"
  end

  test "mark_failed re-queues until max attempts then fails", %{project: project} do
    {:ok, _entry} = Outbox.enqueue(%{project_id: project.id, entity_type: "state", operation: "move", payload: %{}, dedup_key: "s"})
    [claimed] = Outbox.claim_pending(project.id, 10)

    assert {:ok, requeued} = Outbox.mark_failed(claimed, "boom", 2)
    assert requeued.status == "pending"
    assert requeued.attempts == 1

    [claimed2] = Outbox.claim_pending(project.id, 10)
    assert {:ok, failed} = Outbox.mark_failed(claimed2, "boom again", 2)
    assert failed.status == "failed"
    assert failed.attempts == 2
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_sync_outbox")
    Repo.query!("delete from local_tracker_projects")
  end
end
