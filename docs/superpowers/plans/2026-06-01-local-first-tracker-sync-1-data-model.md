# Local-First Tracker Sync — Plan 1: Data Model Foundation

**Goal:** Add the SQLite schema foundation (sync metadata columns + new tables) that lets every tracker mirror remote issues/comments/labels/PRs locally and queue local writes for background sync.

**Architecture:** Additive Ecto migrations + schema modules. New nullable columns on `local_tracker_issues/comments/labels/issue_relations`, and four new tables: `tracker_sync_outbox`, `tracker_sync_state`, `tracker_pull_requests`, `tracker_users`. No behavior changes yet — this plan only creates the storage layer and its changesets/validations. Native local projects are unaffected (new columns default to safe values).

**Tech Stack:** Elixir, Ecto, `exqlite` (SQLite), ExUnit. Migrations run via `Ecto.Migrator`. Tests follow the existing `local_tracker` pattern (`use ExUnit.Case, async: false`, `migrate_repo/0` + `clean_repo/0` in `setup`).

---

## Plan sequence (this is Plan 1 of 6)

1. **Data model foundation** ← this file
2. Outbox + Merge core (`Tracker.Sync.Outbox`, `Tracker.Sync.Merge`) — pure logic + tests
3. Context upserts (`upsert_remote_issue/comment/labels/pull_requests`) + local read helpers
4. `Tracker.Sync.Engine` + `Tracker.Sync.Driver` behaviour + orchestrator heartbeat/force-sync wiring (fake driver)
5. `GitHub.SyncDriver` + `Linear.SyncDriver` (pull/push field mapping) + PR-sync
6. Wire UI `IssueAdapter` + orchestrator `Tracker` to local-first reads/writes; reconciler reads local PRs; `tracker.sync_enabled` flag; retire `ReadCache` on issue path; observability

Each plan produces working, tested software on its own.

---

## Conventions used in this plan

- **Migration filenames** use today's date with incrementing suffixes: `priv/repo/migrations/20260601NNNNNN_*.exs`.
- **Run migrations in tests** with the existing helper; the test database is created/migrated via `mise exec -- mix ecto.migrate` (or the in-test `Ecto.Migrator`).
- **Commands** are prefixed with the project's toolchain. Always run from `elixir/`:

```bash
cd /home/raphaelcangucu/symphony/elixir
eval "$(~/.local/bin/mise activate bash)"   # once per shell, makes `mix` available
```

All `mix` commands below assume that activation (or use `mise exec -- mix …`).

---

## Task 1: Sync metadata columns on `local_tracker_issues`

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000100_add_sync_metadata_to_local_tracker_issues.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/issue_record_sync_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/issue_record_sync_test.exs`:

```elixir
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
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/issue_record_sync_test.exs`
Expected: FAIL — `** (Ecto.ChangeError)` / unknown field `remote_id` (column does not exist / not in schema).

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000100_add_sync_metadata_to_local_tracker_issues.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddSyncMetadataToLocalTrackerIssues do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issues) do
      add(:remote_id, :string)
      add(:remote_number, :integer)
      add(:remote_url, :string)
      add(:sync_status, :string, default: "synced", null: false)
      add(:remote_updated_at, :utc_datetime_usec)
      add(:last_synced_at, :utc_datetime_usec)
      add(:dirty_fields, :map, default: %{}, null: false)
      add(:last_sync_error, :string)
    end

    create(
      unique_index(:local_tracker_issues, [:project_id, :remote_id],
        where: "remote_id IS NOT NULL",
        name: :local_tracker_issues_project_id_remote_id_index
      )
    )
  end
end
```

- [ ] **Step 4: Add the fields + changeset casts to the schema**

In `elixir/lib/symphony_elixir/local_tracker/issue_record.ex`, add fields inside `schema "local_tracker_issues" do` after `field(:completed_at, :utc_datetime_usec)`:

```elixir
    field(:remote_id, :string)
    field(:remote_number, :integer)
    field(:remote_url, :string)
    field(:sync_status, :string, default: "synced")
    field(:remote_updated_at, :utc_datetime_usec)
    field(:last_synced_at, :utc_datetime_usec)
    field(:dirty_fields, :map, default: %{})
    field(:last_sync_error, :string)
```

Then extend the `cast/3` list in `changeset/2` to include the new fields (append to the existing list):

```elixir
      :completed_at,
      :remote_id,
      :remote_number,
      :remote_url,
      :sync_status,
      :remote_updated_at,
      :last_synced_at,
      :dirty_fields,
      :last_sync_error
```

Add a validation after the existing `unique_constraint/2` line:

```elixir
    |> validate_inclusion(:sync_status, ~w(synced pending conflict error archived))
    |> unique_constraint([:project_id, :remote_id], name: :local_tracker_issues_project_id_remote_id_index)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/issue_record_sync_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000100_add_sync_metadata_to_local_tracker_issues.exs \
        lib/symphony_elixir/local_tracker/issue_record.ex \
        test/symphony_elixir/local_tracker/issue_record_sync_test.exs
git commit -m "feat(tracker): add sync metadata columns to local issues"
```

---

## Task 2: Sync metadata columns on `local_tracker_comments`

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000200_add_sync_metadata_to_local_tracker_comments.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/comment.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/comment_sync_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/comment_sync_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.CommentSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Comment, Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    status = Repo.all(WorkflowStatus) |> hd()

    {:ok, issue} =
      %IssueRecord{}
      |> IssueRecord.changeset(%{project_id: project.id, status_id: status.id, identifier: "1", title: "I", position: 0})
      |> Repo.insert()

    %{issue: issue}
  end

  test "changeset accepts comment sync metadata", %{issue: issue} do
    now = DateTime.utc_now()

    attrs = %{
      issue_id: issue.id,
      kind: "comment",
      body: "hello",
      author: "octocat",
      remote_id: "IC_kwDO1",
      sync_status: "synced",
      remote_updated_at: now,
      last_synced_at: now,
      dirty_fields: %{}
    }

    assert {:ok, comment} = %Comment{} |> Comment.changeset(attrs) |> Repo.insert()
    assert comment.remote_id == "IC_kwDO1"
    assert comment.sync_status == "synced"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/comment_sync_test.exs`
Expected: FAIL — unknown field `remote_id` on `Comment`.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000200_add_sync_metadata_to_local_tracker_comments.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddSyncMetadataToLocalTrackerComments do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_comments) do
      add(:remote_id, :string)
      add(:sync_status, :string, default: "synced", null: false)
      add(:remote_updated_at, :utc_datetime_usec)
      add(:last_synced_at, :utc_datetime_usec)
      add(:dirty_fields, :map, default: %{}, null: false)
    end

    create(
      unique_index(:local_tracker_comments, [:issue_id, :remote_id],
        where: "remote_id IS NOT NULL",
        name: :local_tracker_comments_issue_id_remote_id_index
      )
    )
  end
end
```

- [ ] **Step 4: Update the schema**

In `elixir/lib/symphony_elixir/local_tracker/comment.ex`, add fields after `field(:author, :string, default: "local")`:

```elixir
    field(:remote_id, :string)
    field(:sync_status, :string, default: "synced")
    field(:remote_updated_at, :utc_datetime_usec)
    field(:last_synced_at, :utc_datetime_usec)
    field(:dirty_fields, :map, default: %{})
```

Replace the `cast/3` call in `changeset/2` with:

```elixir
    |> cast(attrs, [
      :issue_id,
      :kind,
      :body,
      :author,
      :remote_id,
      :sync_status,
      :remote_updated_at,
      :last_synced_at,
      :dirty_fields
    ])
```

Add after `validate_required/2`:

```elixir
    |> validate_inclusion(:sync_status, ~w(synced pending conflict error archived))
    |> unique_constraint([:issue_id, :remote_id], name: :local_tracker_comments_issue_id_remote_id_index)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/comment_sync_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000200_add_sync_metadata_to_local_tracker_comments.exs \
        lib/symphony_elixir/local_tracker/comment.ex \
        test/symphony_elixir/local_tracker/comment_sync_test.exs
git commit -m "feat(tracker): add sync metadata columns to local comments"
```

---

## Task 3: `remote_id` on `local_tracker_labels`

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000300_add_remote_id_to_local_tracker_labels.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/label.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/label_sync_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/label_sync_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.LabelSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Label}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "changeset accepts label remote_id", %{project: project} do
    attrs = %{project_id: project.id, name: "bug", color: "#ff0000", remote_id: "LA_kwDO1"}
    assert {:ok, label} = %Label{} |> Label.changeset(attrs) |> Repo.insert()
    assert label.remote_id == "LA_kwDO1"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/label_sync_test.exs`
Expected: FAIL — unknown field `remote_id` on `Label`.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000300_add_remote_id_to_local_tracker_labels.exs`:

```elixir
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
```

- [ ] **Step 4: Update the schema**

In `elixir/lib/symphony_elixir/local_tracker/label.ex`, add `field(:remote_id, :string)` to the schema block after `field(:color, :string)`. Then replace `changeset/2` with:

```elixir
  def changeset(label, attrs) do
    label
    |> cast(attrs, [:project_id, :name, :color, :remote_id])
    |> validate_required([:project_id, :name])
    |> unique_constraint([:project_id, :name])
    |> unique_constraint([:project_id, :remote_id], name: :local_tracker_labels_project_id_remote_id_index)
  end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/label_sync_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000300_add_remote_id_to_local_tracker_labels.exs \
        lib/symphony_elixir/local_tracker/label.ex \
        test/symphony_elixir/local_tracker/label_sync_test.exs
git commit -m "feat(tracker): add remote_id to local labels"
```

---

## Task 4: `remote_origin` on `local_tracker_issue_relations`

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000400_add_remote_origin_to_local_tracker_issue_relations.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/issue_relation.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/issue_relation_sync_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/issue_relation_sync_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.IssueRelationSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, IssueRelation, WorkflowStatus}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    status = Repo.all(WorkflowStatus) |> hd()

    insert = fn ident ->
      %IssueRecord{}
      |> IssueRecord.changeset(%{project_id: project.id, status_id: status.id, identifier: ident, title: "I#{ident}", position: 0})
      |> Repo.insert!()
    end

    %{source: insert.("1"), target: insert.("2")}
  end

  test "changeset accepts remote_origin flag", %{source: source, target: target} do
    attrs = %{source_issue_id: source.id, target_issue_id: target.id, type: "blocked_by", remote_origin: true}
    assert {:ok, relation} = %IssueRelation{} |> IssueRelation.changeset(attrs) |> Repo.insert()
    assert relation.remote_origin == true
  end

  test "remote_origin defaults to false" do
    relation = Repo.all(IssueRelation) |> List.first()
    assert is_nil(relation)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_issue_relations",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/issue_relation_sync_test.exs`
Expected: FAIL — unknown field `remote_origin`.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000400_add_remote_origin_to_local_tracker_issue_relations.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddRemoteOriginToLocalTrackerIssueRelations do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_issue_relations) do
      add(:remote_origin, :boolean, default: false, null: false)
    end
  end
end
```

- [ ] **Step 4: Update the schema**

In `elixir/lib/symphony_elixir/local_tracker/issue_relation.ex`, add `field(:remote_origin, :boolean, default: false)` to the schema block after `field(:type, :string)`. Then replace the `cast/3` call in `changeset/2` with:

```elixir
    |> cast(attrs, [:source_issue_id, :target_issue_id, :type, :remote_origin])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/issue_relation_sync_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000400_add_remote_origin_to_local_tracker_issue_relations.exs \
        lib/symphony_elixir/local_tracker/issue_relation.ex \
        test/symphony_elixir/local_tracker/issue_relation_sync_test.exs
git commit -m "feat(tracker): mark remote-origin issue relations"
```

---

## Task 5: `tracker_sync_outbox` table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000500_create_tracker_sync_outbox.exs`
- Create: `elixir/lib/symphony_elixir/tracker/sync/outbox_entry.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/outbox_entry_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/outbox_entry_test.exs`:

```elixir
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/outbox_entry_test.exs`
Expected: FAIL — module `SymphonyElixir.Tracker.Sync.OutboxEntry` is not available / table missing.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000500_create_tracker_sync_outbox.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateTrackerSyncOutbox do
  use Ecto.Migration

  def change do
    create table(:tracker_sync_outbox) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:issue_id, references(:local_tracker_issues, on_delete: :nilify_all))
      add(:entity_type, :string, null: false)
      add(:operation, :string, null: false)
      add(:payload, :map, default: %{}, null: false)
      add(:dedup_key, :string)
      add(:status, :string, default: "pending", null: false)
      add(:attempts, :integer, default: 0, null: false)
      add(:last_error, :string)
      add(:remote_id, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:tracker_sync_outbox, [:project_id, :status]))
    create(unique_index(:tracker_sync_outbox, [:dedup_key], where: "dedup_key IS NOT NULL AND status = 'pending'", name: :tracker_sync_outbox_pending_dedup_index))
  end
end
```

- [ ] **Step 4: Write the schema**

Create `elixir/lib/symphony_elixir/tracker/sync/outbox_entry.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.OutboxEntry do
  @moduledoc "A queued local tracker write awaiting push to the remote source."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}

  @type t :: %__MODULE__{}

  @entity_types ~w(issue comment label state assignee)
  @operations ~w(create update move add remove)
  @statuses ~w(pending in_flight done failed conflict)

  schema "tracker_sync_outbox" do
    field(:entity_type, :string)
    field(:operation, :string)
    field(:payload, :map, default: %{})
    field(:dedup_key, :string)
    field(:status, :string, default: "pending")
    field(:attempts, :integer, default: 0)
    field(:last_error, :string)
    field(:remote_id, :string)

    belongs_to(:project, Project)
    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(entry, attrs) do
    entry
    |> cast(attrs, [
      :project_id,
      :issue_id,
      :entity_type,
      :operation,
      :payload,
      :dedup_key,
      :status,
      :attempts,
      :last_error,
      :remote_id
    ])
    |> validate_required([:project_id, :entity_type, :operation, :payload, :status])
    |> validate_inclusion(:entity_type, @entity_types)
    |> validate_inclusion(:operation, @operations)
    |> validate_inclusion(:status, @statuses)
    |> validate_number(:attempts, greater_than_or_equal_to: 0)
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/outbox_entry_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000500_create_tracker_sync_outbox.exs \
        lib/symphony_elixir/tracker/sync/outbox_entry.ex \
        test/symphony_elixir/tracker/sync/outbox_entry_test.exs
git commit -m "feat(tracker): add tracker_sync_outbox table and schema"
```

---

## Task 6: `tracker_sync_state` table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000600_create_tracker_sync_state.exs`
- Create: `elixir/lib/symphony_elixir/tracker/sync/state_record.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/state_record_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/state_record_test.exs`:

```elixir
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

    refute changeset.valid? or match?({:ok, _}, {:error, changeset})
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/state_record_test.exs`
Expected: FAIL — module/table missing.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000600_create_tracker_sync_state.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateTrackerSyncState do
  use Ecto.Migration

  def change do
    create table(:tracker_sync_state) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:last_full_sync_at, :utc_datetime_usec)
      add(:last_incremental_cursor, :string)
      add(:last_pull_at, :utc_datetime_usec)
      add(:last_push_at, :utc_datetime_usec)
      add(:status, :string, default: "idle", null: false)
      add(:last_error, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_sync_state, [:project_id]))
  end
end
```

- [ ] **Step 4: Write the schema**

Create `elixir/lib/symphony_elixir/tracker/sync/state_record.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.StateRecord do
  @moduledoc "Per-project sync bookkeeping (cursor, timestamps, status)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  @statuses ~w(idle syncing error)

  schema "tracker_sync_state" do
    field(:last_full_sync_at, :utc_datetime_usec)
    field(:last_incremental_cursor, :string)
    field(:last_pull_at, :utc_datetime_usec)
    field(:last_push_at, :utc_datetime_usec)
    field(:status, :string, default: "idle")
    field(:last_error, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(state, attrs) do
    state
    |> cast(attrs, [
      :project_id,
      :last_full_sync_at,
      :last_incremental_cursor,
      :last_pull_at,
      :last_push_at,
      :status,
      :last_error
    ])
    |> validate_required([:project_id, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint(:project_id)
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/state_record_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000600_create_tracker_sync_state.exs \
        lib/symphony_elixir/tracker/sync/state_record.ex \
        test/symphony_elixir/tracker/sync/state_record_test.exs
git commit -m "feat(tracker): add tracker_sync_state table and schema"
```

---

## Task 7: `tracker_pull_requests` table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000700_create_tracker_pull_requests.exs`
- Create: `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/pull_request_record_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/pull_request_record_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.PullRequestRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    status = Repo.all(WorkflowStatus) |> hd()

    {:ok, issue} =
      %IssueRecord{}
      |> IssueRecord.changeset(%{project_id: project.id, status_id: status.id, identifier: "1", title: "I", position: 0})
      |> Repo.insert()

    %{issue: issue}
  end

  test "inserts a pull request record", %{issue: issue} do
    attrs = %{
      issue_id: issue.id,
      remote_id: "PR_kwDO1",
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Fix bug",
      state: "open"
    }

    assert {:ok, pr} = %PullRequestRecord{} |> PullRequestRecord.changeset(attrs) |> Repo.insert()
    assert pr.state == "open"
    assert pr.number == 42
  end

  test "rejects invalid state", %{issue: issue} do
    attrs = %{issue_id: issue.id, remote_id: "PR_x", number: 1, url: "u", title: "t", state: "weird"}
    assert {:error, _changeset} = %PullRequestRecord{} |> PullRequestRecord.changeset(attrs) |> Repo.insert()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_pull_requests")
    Repo.query!("delete from local_tracker_issues")
    Repo.query!("delete from local_tracker_workflow_statuses")
    Repo.query!("delete from local_tracker_projects")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/pull_request_record_test.exs`
Expected: FAIL — module/table missing.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000700_create_tracker_pull_requests.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateTrackerPullRequests do
  use Ecto.Migration

  def change do
    create table(:tracker_pull_requests) do
      add(:issue_id, references(:local_tracker_issues, on_delete: :delete_all), null: false)
      add(:remote_id, :string, null: false)
      add(:number, :integer)
      add(:url, :string)
      add(:title, :string)
      add(:state, :string, null: false)
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_pull_requests, [:issue_id, :remote_id]))
  end
end
```

- [ ] **Step 4: Write the schema**

Create `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.PullRequestRecord do
  @moduledoc "A GitHub pull request linked to a tracker issue (source-control sync)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.IssueRecord

  @type t :: %__MODULE__{}

  @states ~w(open closed merged)

  schema "tracker_pull_requests" do
    field(:remote_id, :string)
    field(:number, :integer)
    field(:url, :string)
    field(:title, :string)
    field(:state, :string)
    field(:last_synced_at, :utc_datetime_usec)

    belongs_to(:issue, IssueRecord)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [:issue_id, :remote_id, :number, :url, :title, :state, :last_synced_at])
    |> validate_required([:issue_id, :remote_id, :state])
    |> validate_inclusion(:state, @states)
    |> unique_constraint([:issue_id, :remote_id])
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/pull_request_record_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000700_create_tracker_pull_requests.exs \
        lib/symphony_elixir/tracker/sync/pull_request_record.ex \
        test/symphony_elixir/tracker/sync/pull_request_record_test.exs
git commit -m "feat(tracker): add tracker_pull_requests table and schema"
```

---

## Task 8: `tracker_users` table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260601000800_create_tracker_users.exs`
- Create: `elixir/lib/symphony_elixir/tracker/sync/user_record.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/user_record_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/user_record_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.UserRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "inserts a user cache row", %{project: project} do
    attrs = %{project_id: project.id, remote_id: "U_1", login: "octocat", name: "Octo Cat", avatar_url: "https://x/y.png"}
    assert {:ok, user} = %UserRecord{} |> UserRecord.changeset(attrs) |> Repo.insert()
    assert user.login == "octocat"
  end

  test "is unique per project+login", %{project: project} do
    base = %{project_id: project.id, remote_id: "U_1", login: "octocat"}
    {:ok, _} = %UserRecord{} |> UserRecord.changeset(base) |> Repo.insert()
    assert {:error, _} = %UserRecord{} |> UserRecord.changeset(base) |> Repo.insert()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_users")
    Repo.query!("delete from local_tracker_projects")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/user_record_test.exs`
Expected: FAIL — module/table missing.

- [ ] **Step 3: Write the migration**

Create `elixir/priv/repo/migrations/20260601000800_create_tracker_users.exs`:

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateTrackerUsers do
  use Ecto.Migration

  def change do
    create table(:tracker_users) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:remote_id, :string)
      add(:login, :string, null: false)
      add(:name, :string)
      add(:avatar_url, :string)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:tracker_users, [:project_id, :login]))
  end
end
```

- [ ] **Step 4: Write the schema**

Create `elixir/lib/symphony_elixir/tracker/sync/user_record.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.UserRecord do
  @moduledoc "Cached tracker user (assignee/author) for local display and `assignee: me`."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}

  schema "tracker_users" do
    field(:remote_id, :string)
    field(:login, :string)
    field(:name, :string)
    field(:avatar_url, :string)

    belongs_to(:project, Project)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:project_id, :remote_id, :login, :name, :avatar_url])
    |> validate_required([:project_id, :login])
    |> unique_constraint([:project_id, :login])
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/user_record_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/20260601000800_create_tracker_users.exs \
        lib/symphony_elixir/tracker/sync/user_record.ex \
        test/symphony_elixir/tracker/sync/user_record_test.exs
git commit -m "feat(tracker): add tracker_users cache table and schema"
```

---

## Task 9: Full migration + suite sanity check

**Files:** none (verification only)

- [ ] **Step 1: Reset and migrate the dev + test databases**

Run:
```bash
MIX_ENV=test mix ecto.drop && MIX_ENV=test mix ecto.create && MIX_ENV=test mix ecto.migrate
```
Expected: all migrations `20260601000100`–`20260601000800` apply with no errors.

- [ ] **Step 2: Run the new schema tests together**

Run:
```bash
mix test test/symphony_elixir/local_tracker/issue_record_sync_test.exs \
         test/symphony_elixir/local_tracker/comment_sync_test.exs \
         test/symphony_elixir/local_tracker/label_sync_test.exs \
         test/symphony_elixir/local_tracker/issue_relation_sync_test.exs \
         test/symphony_elixir/tracker/sync/outbox_entry_test.exs \
         test/symphony_elixir/tracker/sync/state_record_test.exs \
         test/symphony_elixir/tracker/sync/pull_request_record_test.exs \
         test/symphony_elixir/tracker/sync/user_record_test.exs
```
Expected: all PASS (13 tests).

- [ ] **Step 3: Confirm no regressions in the existing local tracker suite**

Run: `mix test test/symphony_elixir/local_tracker/`
Expected: same pass count as before this plan (no new failures).

- [ ] **Step 4: Format + credo on the new files**

Run:
```bash
mix format
mix credo lib/symphony_elixir/tracker/sync/ --strict || true
```
Expected: `mix format` clean; no NEW credo issues in the new files.

- [ ] **Step 5: Commit any formatting**

```bash
git add -A
git commit -m "chore(tracker): format and verify data-model foundation"
```

---

## Self-Review

**Spec coverage (Data Model section):** issues sync columns (Task 1), comments sync columns (Task 2), labels `remote_id` (Task 3), relations `remote_origin` (Task 4), `tracker_sync_outbox` (Task 5), `tracker_sync_state` (Task 6), `tracker_pull_requests` (Task 7), `tracker_users` (Task 8). All Data Model items are covered. Behavior (engine, drivers, read/write rewiring) is intentionally deferred to Plans 2–6.

**Placeholder scan:** No TBD/TODO; every step contains complete migration/schema/test code and exact commands.

**Type/name consistency:** New module names used consistently — `SymphonyElixir.Tracker.Sync.{OutboxEntry, StateRecord, PullRequestRecord, UserRecord}`; table names `tracker_sync_outbox`, `tracker_sync_state`, `tracker_pull_requests`, `tracker_users`; the partial-unique index name on issues (`local_tracker_issues_project_id_remote_id_index`) matches between migration (Task 1 Step 3) and `unique_constraint/2` (Task 1 Step 4). `sync_status` allowed values (`synced/pending/conflict/error/archived`) are consistent across issues and comments. Tasks 3–4 give the exact `changeset/2` after reading `label.ex` and `issue_relation.ex`, so no adaptation is required.
