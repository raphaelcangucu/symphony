defmodule SymphonyElixir.Tracker.Sync.OutboxEntryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "inserts a pending outbox entry with required fields", %{project: project} do
    attrs = %{
      project_id: project.id,
      entity_type: "comment",
      operation: "create",
      payload: %{"body" => "hi"},
      dedup_key: "comment:create:issue-1:abc"
    }

    assert {:ok, entry} = %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()
    assert entry.status == "pending"
    assert entry.attempts == 0
    assert entry.payload == %{"body" => "hi"}
  end

  test "rejects an invalid entity_type", %{project: project} do
    attrs = %{project_id: project.id, entity_type: "bogus", operation: "create", payload: %{}}
    assert {:error, changeset} = %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()
    assert "is invalid" in errors_on(changeset).entity_type
  end

  test "rejects a second pending entry for the same dedup_key as a changeset error (not a raise)", %{
    project: project
  } do
    attrs = %{
      project_id: project.id,
      entity_type: "state",
      operation: "move",
      payload: %{},
      dedup_key: "state:move:#{project.id}:MM-1"
    }

    assert {:ok, _first} = %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()

    # Without `unique_constraint(:dedup_key)` this raised `Ecto.ConstraintError`
    # (HTTP 500). It must surface as a recoverable changeset error instead.
    assert {:error, changeset} = %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()
    assert "has already been taken" in errors_on(changeset).dedup_key
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key -> opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string() end)
    end)
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
