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

  test "concurrent enqueue of the same dedup_key never raises and coalesces to one pending entry", %{
    project: project
  } do
    attrs = %{
      project_id: project.id,
      entity_type: "state",
      operation: "move",
      payload: %{"state" => "Done"},
      dedup_key: "state:move:#{project.id}:MM-1"
    }

    # Hammer the check-then-insert path harder than the connection pool so the
    # lookup-then-insert window overlaps a concurrent insert. Before the fix this
    # raised `Ecto.ConstraintError` in a worker (surfacing the move endpoint 500).
    results =
      1..24
      |> Task.async_stream(fn _ -> Outbox.enqueue(attrs) end,
        max_concurrency: 24,
        timeout: 15_000,
        on_timeout: :kill_task
      )
      |> Enum.to_list()

    assert Enum.all?(results, &match?({:ok, {:ok, %OutboxEntry{}}}, &1))
    assert Outbox.pending_count(project.id) == 1
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

  test "requeue_failed_issue_creates revives only matching failed creates", %{project: project} do
    {:ok, _matching} =
      Outbox.enqueue(%{
        project_id: project.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Draft"},
        dedup_key: "issue:create:#{project.id}:MM-1"
      })

    {:ok, _other_issue} =
      Outbox.enqueue(%{
        project_id: project.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Other"},
        dedup_key: "issue:create:#{project.id}:MM-2"
      })

    {:ok, _state_move} =
      Outbox.enqueue(%{
        project_id: project.id,
        entity_type: "state",
        operation: "move",
        payload: %{"identifier" => "MM-1"},
        dedup_key: "state:move:#{project.id}:MM-1"
      })

    Outbox.claim_pending(project.id, 10)
    |> Enum.each(fn entry ->
      assert {:ok, _failed} = Outbox.mark_failed(entry, "old credentials", 1)
    end)

    assert Outbox.requeue_failed_issue_creates(project.id, ["MM-1"]) == 1

    revived = Repo.get_by!(OutboxEntry, dedup_key: "issue:create:#{project.id}:MM-1")
    other_issue = Repo.get_by!(OutboxEntry, dedup_key: "issue:create:#{project.id}:MM-2")
    state_move = Repo.get_by!(OutboxEntry, dedup_key: "state:move:#{project.id}:MM-1")

    assert revived.status == "pending"
    assert revived.attempts == 0
    assert is_nil(revived.last_error)
    assert other_issue.status == "failed"
    assert state_move.status == "failed"
  end

  test "requeue_latest_failed_by_dedup_keys revives only the latest failed entry per key", %{project: project} do
    attrs = %{
      project_id: project.id,
      entity_type: "state",
      operation: "move",
      payload: %{"identifier" => "MM-1"},
      dedup_key: "state:move:#{project.id}:MM-1"
    }

    {:ok, _first} = Outbox.enqueue(attrs)
    [claimed_first] = Outbox.claim_pending(project.id, 10)
    assert {:ok, first_failed} = Outbox.mark_failed(claimed_first, "old failure", 1)

    {:ok, _second} = Outbox.enqueue(%{attrs | payload: %{"identifier" => "MM-1", "state" => "Done"}})
    [claimed_second] = Outbox.claim_pending(project.id, 10)
    assert {:ok, second_failed} = Outbox.mark_failed(claimed_second, "new failure", 1)

    assert Outbox.requeue_latest_failed_by_dedup_keys(project.id, [attrs.dedup_key]) == 1

    assert Repo.get!(OutboxEntry, first_failed.id).status == "failed"
    revived = Repo.get!(OutboxEntry, second_failed.id)
    assert revived.status == "pending"
    assert revived.attempts == 0
    assert is_nil(revived.last_error)
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
