# Local-First Tracker Sync — Plan 2: Outbox + Merge Core

**Goal:** Build the two pure-ish core modules the sync engine depends on: `Tracker.Sync.Outbox` (durable queue of local writes with coalescing, claiming, and backoff) and `Tracker.Sync.Merge` (field-level last-writer-wins conflict resolution).

**Architecture:** `Merge` is a pure module (no DB) that decides, per field, whether the local pending edit or the remote value wins. `Outbox` wraps `tracker_sync_outbox` (created in Plan 1) with enqueue/coalesce/claim/complete/fail operations using `Ecto`/`Repo`. Both are independently unit-tested with no network.

**Tech Stack:** Elixir, Ecto, `SymphonyElixir.Repo` (SQLite), ExUnit. `Merge` tests are `async: true`; `Outbox` tests use `async: false` with `migrate_repo/0` + `clean_repo/0`.

**Depends on:** Plan 1 (tables/schemas exist).

---

## Task 1: `Tracker.Sync.Merge` — field-level LWW (pure)

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/merge.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/merge_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/merge_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.MergeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.Merge

  defp iso(seconds_from_now), do: DateTime.utc_now() |> DateTime.add(seconds_from_now, :second) |> DateTime.to_iso8601()

  test "untouched fields take the remote value" do
    result =
      Merge.merge_fields(
        %{title: "local", description: "local body"},
        %{},
        %{title: "remote", description: "remote body"},
        DateTime.utc_now(),
        [:title, :description]
      )

    assert result.attrs == %{title: "remote", description: "remote body"}
    assert result.dirty_fields == %{}
    refute result.conflict?
  end

  test "a local edit newer than the remote keeps the local value" do
    remote_updated = DateTime.utc_now()
    dirty = %{"title" => iso(60)}

    result =
      Merge.merge_fields(%{title: "local-new"}, dirty, %{title: "remote-old"}, remote_updated, [:title])

    refute Map.has_key?(result.attrs, :title)
    assert result.dirty_fields == dirty
    refute result.conflict?
  end

  test "a remote change newer than the local edit wins and flags conflict" do
    remote_updated = DateTime.utc_now()
    dirty = %{"title" => iso(-60)}

    result =
      Merge.merge_fields(%{title: "local-old"}, dirty, %{title: "remote-new"}, remote_updated, [:title])

    assert result.attrs == %{title: "remote-new"}
    assert result.dirty_fields == %{}
    assert result.conflict?
  end

  test "ignores remote keys not in the syncable list" do
    result =
      Merge.merge_fields(%{title: "local"}, %{}, %{title: "remote", url: "x"}, DateTime.utc_now(), [:title])

    assert result.attrs == %{title: "remote"}
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/merge_test.exs`
Expected: FAIL — module `Merge` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/merge.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.Merge do
  @moduledoc """
  Field-level last-writer-wins conflict resolution for tracker sync.

  Given a local record's current values, its `dirty_fields` map
  (`field_string => ISO8601 changed_at`), the freshly-pulled remote values,
  and the remote's `updated_at`, returns the attrs to apply locally, the
  remaining dirty fields, and whether any real conflict was resolved in favor
  of the remote.

  Rules per field:

  - Not dirty locally -> take the remote value.
  - Dirty locally and local change is newer-or-equal to remote -> keep local
    (do not include the field in `attrs`; keep it dirty for the next push).
  - Dirty locally but remote changed later -> remote wins; drop the dirty field
    and flag a conflict.
  """

  @type merge_result :: %{attrs: map(), dirty_fields: map(), conflict?: boolean()}

  @spec merge_fields(map(), map(), map(), DateTime.t(), [atom()]) :: merge_result()
  def merge_fields(_local, dirty_fields, remote, %DateTime{} = remote_updated_at, syncable_fields)
      when is_map(dirty_fields) and is_map(remote) and is_list(syncable_fields) do
    Enum.reduce(syncable_fields, %{attrs: %{}, dirty_fields: dirty_fields, conflict?: false}, fn field, acc ->
      reduce_field(field, remote, remote_updated_at, acc)
    end)
  end

  defp reduce_field(field, remote, remote_updated_at, acc) do
    if Map.has_key?(remote, field) do
      apply_field(field, Map.fetch!(remote, field), remote_updated_at, acc)
    else
      acc
    end
  end

  defp apply_field(field, remote_value, remote_updated_at, acc) do
    case Map.fetch(acc.dirty_fields, Atom.to_string(field)) do
      {:ok, changed_at_iso} ->
        resolve_dirty(field, remote_value, remote_updated_at, changed_at_iso, acc)

      :error ->
        %{acc | attrs: Map.put(acc.attrs, field, remote_value)}
    end
  end

  defp resolve_dirty(field, remote_value, remote_updated_at, changed_at_iso, acc) do
    case parse_iso(changed_at_iso) do
      %DateTime{} = local_changed_at ->
        if DateTime.compare(local_changed_at, remote_updated_at) in [:gt, :eq] do
          acc
        else
          %{
            acc
            | attrs: Map.put(acc.attrs, field, remote_value),
              dirty_fields: Map.delete(acc.dirty_fields, Atom.to_string(field)),
              conflict?: true
          }
        end

      _ ->
        %{acc | attrs: Map.put(acc.attrs, field, remote_value), dirty_fields: Map.delete(acc.dirty_fields, Atom.to_string(field))}
    end
  end

  defp parse_iso(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} -> dt
      _ -> nil
    end
  end

  defp parse_iso(_value), do: nil
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/merge_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/merge.ex test/symphony_elixir/tracker/sync/merge_test.exs
git commit -m "feat(tracker): add field-level LWW merge for sync"
```

---

## Task 2: `Tracker.Sync.Outbox` — enqueue + coalesce

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/outbox.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/outbox_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/outbox_test.exs`:

```elixir
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

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_sync_outbox")
    Repo.query!("delete from local_tracker_projects")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/outbox_test.exs`
Expected: FAIL — `Outbox` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/outbox.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.Outbox do
  @moduledoc """
  Durable queue of local tracker writes awaiting push to the remote source.

  - `enqueue/1` inserts a pending entry, coalescing by `dedup_key`: if a
    pending entry with the same key exists, its payload is merged and reused
    instead of inserting a duplicate.
  - `claim_pending/2` returns the oldest pending entries for a project and marks
    them `in_flight` so a single sync pass owns them.
  - `mark_done/2` / `mark_failed/3` close out an entry.
  - `pending_count/1` powers force-sync decisions and observability.
  """

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  @spec enqueue(map()) :: {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def enqueue(%{dedup_key: key} = attrs) when is_binary(key) do
    case pending_by_dedup(attrs.project_id, key) do
      %OutboxEntry{} = existing ->
        existing
        |> OutboxEntry.changeset(%{payload: Map.merge(existing.payload, Map.get(attrs, :payload, %{})), status: "pending"})
        |> Repo.update()

      nil ->
        insert_entry(attrs)
    end
  end

  def enqueue(attrs), do: insert_entry(attrs)

  @spec claim_pending(integer(), pos_integer()) :: [OutboxEntry.t()]
  def claim_pending(project_id, limit \\ 50) when is_integer(limit) and limit > 0 do
    Repo.transaction(fn ->
      entries =
        OutboxEntry
        |> where([e], e.project_id == ^project_id and e.status == "pending")
        |> order_by([e], asc: e.inserted_at, asc: e.id)
        |> limit(^limit)
        |> Repo.all()

      Enum.map(entries, fn entry ->
        {:ok, claimed} = entry |> OutboxEntry.changeset(%{status: "in_flight"}) |> Repo.update()
        claimed
      end)
    end)
    |> case do
      {:ok, claimed} -> claimed
      {:error, _} -> []
    end
  end

  @spec mark_done(OutboxEntry.t(), String.t() | nil) :: {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def mark_done(%OutboxEntry{} = entry, remote_id \\ nil) do
    entry |> OutboxEntry.changeset(%{status: "done", remote_id: remote_id}) |> Repo.update()
  end

  @spec mark_failed(OutboxEntry.t(), String.t(), pos_integer()) ::
          {:ok, OutboxEntry.t()} | {:error, Ecto.Changeset.t()}
  def mark_failed(%OutboxEntry{} = entry, error, max_attempts) when is_integer(max_attempts) do
    attempts = entry.attempts + 1
    status = if attempts >= max_attempts, do: "failed", else: "pending"
    entry |> OutboxEntry.changeset(%{status: status, attempts: attempts, last_error: error}) |> Repo.update()
  end

  @spec pending_count(integer()) :: non_neg_integer()
  def pending_count(project_id) do
    OutboxEntry
    |> where([e], e.project_id == ^project_id and e.status == "pending")
    |> Repo.aggregate(:count)
  end

  defp pending_by_dedup(project_id, key) do
    OutboxEntry
    |> where([e], e.project_id == ^project_id and e.dedup_key == ^key and e.status == "pending")
    |> limit(1)
    |> Repo.one()
  end

  defp insert_entry(attrs) do
    %OutboxEntry{} |> OutboxEntry.changeset(attrs) |> Repo.insert()
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/outbox_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/outbox.ex test/symphony_elixir/tracker/sync/outbox_test.exs
git commit -m "feat(tracker): add outbox enqueue/coalesce"
```

---

## Task 3: `Outbox` claim + complete + fail lifecycle

**Files:**
- Modify: `elixir/test/symphony_elixir/tracker/sync/outbox_test.exs` (add cases)

The implementation already exists from Task 2; this task locks in the lifecycle with tests.

- [ ] **Step 1: Add failing tests**

Append these tests inside the `describe`-less module body in `outbox_test.exs` (before the private helpers):

```elixir
  test "claim_pending marks entries in_flight oldest-first", %{project: project} do
    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{"n" => 1}, dedup_key: "a"})
    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{"n" => 2}, dedup_key: "b"})

    claimed = Outbox.claim_pending(project.id, 10)

    assert length(claimed) == 2
    assert Enum.all?(claimed, &(&1.status == "in_flight"))
    assert Outbox.pending_count(project.id) == 0
  end

  test "mark_done closes an entry and stores remote_id", %{project: project} do
    {:ok, entry} = Outbox.enqueue(%{project_id: project.id, entity_type: "issue", operation: "create", payload: %{}, dedup_key: "i"})
    [claimed] = Outbox.claim_pending(project.id, 10)
    assert {:ok, done} = Outbox.mark_done(claimed, "I_remote")
    assert done.status == "done"
    assert done.remote_id == "I_remote"
  end

  test "mark_failed re-queues until max attempts then fails", %{project: project} do
    {:ok, entry} = Outbox.enqueue(%{project_id: project.id, entity_type: "state", operation: "move", payload: %{}, dedup_key: "s"})
    [claimed] = Outbox.claim_pending(project.id, 10)

    assert {:ok, requeued} = Outbox.mark_failed(claimed, "boom", 2)
    assert requeued.status == "pending"
    assert requeued.attempts == 1

    [claimed2] = Outbox.claim_pending(project.id, 10)
    assert {:ok, failed} = Outbox.mark_failed(claimed2, "boom again", 2)
    assert failed.status == "failed"
    assert failed.attempts == 2
  end
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/tracker/sync/outbox_test.exs`
Expected: PASS (6 tests total). If `claim_pending` ordering is flaky because both rows share an `inserted_at`, the secondary `asc: e.id` ordering (already in the implementation) keeps it deterministic.

- [ ] **Step 3: Commit**

```bash
git add test/symphony_elixir/tracker/sync/outbox_test.exs
git commit -m "test(tracker): cover outbox claim/done/fail lifecycle"
```

---

## Task 4: Verification

- [ ] **Step 1: Run both core suites + format + credo**

Run:
```bash
mix test test/symphony_elixir/tracker/sync/merge_test.exs test/symphony_elixir/tracker/sync/outbox_test.exs
mix format
mix credo lib/symphony_elixir/tracker/sync/ --strict || true
```
Expected: all tests PASS; `mix format` clean; no new credo issues.

- [ ] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore(tracker): format outbox/merge core" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:** `Sync.Merge` implements the field-level LWW rule from the spec's "Conflict resolution" section (local newer-or-equal keeps local; remote newer wins + conflict flag; untouched fields take remote). `Sync.Outbox` implements enqueue/coalesce (spec "Push" + `dedup_key`), claim (in_flight), and backoff via `mark_failed` (attempts → failed). These are the core primitives Plans 4–5 consume.

**Placeholder scan:** None. Full module and test code provided; exact commands with expected results.

**Type/name consistency:** `Merge.merge_fields/5` returns `%{attrs, dirty_fields, conflict?}` and is consumed that way in later plans (Plan 3 `Context.upsert_remote_issue/2` and Plan 4 engine). `Outbox` public API — `enqueue/1`, `claim_pending/2`, `mark_done/2`, `mark_failed/3`, `pending_count/1` — matches the calls in Plan 4 (`Sync.Engine`) and Plan 6 (adapter writes). `dirty_fields` keys are strings (field names) with ISO8601 timestamps, consistent with the `dirty_fields` column added in Plan 1.
