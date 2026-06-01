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
