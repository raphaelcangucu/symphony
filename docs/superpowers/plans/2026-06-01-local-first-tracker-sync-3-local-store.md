# Local-First Tracker Sync — Plan 3: Local Store (remote → local upserts)

**Goal:** Persist remote tracker data into the local SQLite store: a `Tracker.Sync.LocalStore` module that upserts a remote issue (with its comments and labels) by `(project_id, remote_id)` using the `Merge` LWW rules from Plan 2, and upserts linked pull requests.

**Architecture:** A focused module under `tracker/sync/` so the existing `LocalTracker.Context` does not grow unwieldy. `LocalStore` talks to `Repo` directly and reuses `Tracker.Sync.Merge`. It maps a remote issue's workflow-state name to a local `WorkflowStatus` row, associates labels (creating them by name/remote_id), and replaces remote-origin comments. All operations are idempotent (running twice yields the same state).

**Tech Stack:** Elixir, Ecto, `SymphonyElixir.Repo`. Tests `async: false` with `migrate_repo/0` + `clean_repo/0`.

**Depends on:** Plan 1 (columns/tables) and Plan 2 (`Merge`).

---

## Data shape: the normalized remote issue

The sync drivers (Plan 5) translate GitHub/Linear payloads into this normalized map, which `LocalStore.upsert_remote_issue/2` consumes:

```elixir
%{
  remote_id: "I_kwDO...",          # required
  remote_number: 507,               # integer | nil
  identifier: "507",                # human id (issue number / Linear identifier)
  title: "…",
  description: "…",
  state: "Human Review",            # workflow status NAME (already mapped to local vocab)
  priority: 2,                       # integer | nil
  assignee_id: "octocat",           # login/id | nil
  branch_name: "feature/x" | nil,
  remote_url: "https://…",
  creator: "octocat" | nil,
  position: 0 | nil,
  remote_updated_at: ~U[...],        # DateTime, required
  labels: [%{remote_id: "LA_…", name: "bug", color: "ff0000"}],
  comments: [%{remote_id: "IC_…", body: "…", author: "octocat", remote_updated_at: ~U[...]}]
}
```

---

## Task 1: `LocalStore.upsert_remote_issue/2` — insert path

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_store_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/local_store_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.LocalStoreTest do
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

  defp remote_issue(overrides) do
    Map.merge(
      %{
        remote_id: "I_1",
        remote_number: 507,
        identifier: "507",
        title: "Remote title",
        description: "Remote body",
        state: "Todo",
        priority: nil,
        assignee_id: "octocat",
        branch_name: nil,
        remote_url: "https://github.com/o/r/issues/507",
        creator: "octocat",
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      },
      overrides
    )
  end

  test "inserts a new remote issue mapped to a local status", %{project: project} do
    assert {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    assert issue.remote_id == "I_1"
    assert issue.identifier == "507"
    assert issue.title == "Remote title"
    assert issue.sync_status == "synced"
    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:status)
    assert loaded.status.name == "Todo"
  end

  test "upsert is idempotent on remote_id", %{project: project} do
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "Renamed remotely"}))

    issues = Repo.all(IssueRecord)
    assert length(issues) == 1
    assert hd(issues).title == "Renamed remotely"
  end

  test "associates labels by name and remote_id", %{project: project} do
    labels = [%{remote_id: "LA_1", name: "bug", color: "ff0000"}]
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{labels: labels}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:labels)
    assert Enum.map(loaded.labels, & &1.name) == ["bug"]
    assert Enum.map(loaded.labels, & &1.remote_id) == ["LA_1"]
  end

  test "mirrors remote comments", %{project: project} do
    comments = [%{remote_id: "IC_1", body: "hello", author: "octocat", remote_updated_at: DateTime.utc_now()}]
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{comments: comments}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:comments)
    assert Enum.map(loaded.comments, & &1.body) == ["hello"]
    assert Enum.map(loaded.comments, & &1.remote_id) == ["IC_1"]
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "tracker_pull_requests",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
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

Run: `mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: FAIL — `LocalStore` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/local_store.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.LocalStore do
  @moduledoc """
  Upserts remote tracker data (issues, comments, labels, pull requests) into the
  local SQLite store, keyed by `(project_id, remote_id)`.

  Insert path creates a fully mirrored issue. Update path applies field-level
  last-writer-wins via `Tracker.Sync.Merge`, preserving pending local edits
  (`dirty_fields`). All functions are idempotent.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Comment, IssueLabel, IssueRecord, Label, Project, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Merge, PullRequestRecord}

  # Fields subject to LWW merge on update (untouched-locally take remote).
  @syncable_fields ~w(title description priority assignee_id)a

  @spec upsert_remote_issue(Project.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, term()}
  def upsert_remote_issue(%Project{} = project, %{remote_id: remote_id} = remote)
      when is_binary(remote_id) do
    Repo.transaction(fn ->
      status_id = resolve_status_id(project.id, remote[:state])

      issue =
        case existing_issue(project.id, remote_id) do
          nil -> insert_issue!(project, remote, status_id)
          %IssueRecord{} = current -> update_issue!(current, remote, status_id)
        end

      :ok = upsert_labels!(project, issue, Map.get(remote, :labels, []))
      :ok = upsert_comments!(issue, Map.get(remote, :comments, []))

      Repo.preload(issue, [:status, :labels, :comments], force: true)
    end)
  end

  @spec upsert_pull_requests(IssueRecord.t(), [map()]) :: :ok
  def upsert_pull_requests(%IssueRecord{} = issue, prs) when is_list(prs) do
    now = DateTime.utc_now()

    Enum.each(prs, fn pr ->
      attrs = pr |> Map.put(:issue_id, issue.id) |> Map.put(:last_synced_at, now)

      case Repo.get_by(PullRequestRecord, issue_id: issue.id, remote_id: pr.remote_id) do
        nil -> %PullRequestRecord{}
        %PullRequestRecord{} = existing -> existing
      end
      |> PullRequestRecord.changeset(attrs)
      |> Repo.insert_or_update!()
    end)

    :ok
  end

  # -- issue insert/update -----------------------------------------------------

  defp insert_issue!(project, remote, status_id) do
    %IssueRecord{}
    |> IssueRecord.changeset(%{
      project_id: project.id,
      status_id: status_id,
      identifier: to_string(remote[:identifier]),
      title: remote[:title],
      description: remote[:description],
      priority: remote[:priority],
      position: remote[:position] || 0,
      assignee_id: remote[:assignee_id],
      creator: remote[:creator],
      branch_name: remote[:branch_name],
      url: remote[:remote_url],
      remote_id: remote[:remote_id],
      remote_number: remote[:remote_number],
      remote_url: remote[:remote_url],
      sync_status: "synced",
      remote_updated_at: remote[:remote_updated_at],
      last_synced_at: DateTime.utc_now(),
      dirty_fields: %{}
    })
    |> Repo.insert!()
  end

  defp update_issue!(%IssueRecord{} = current, remote, status_id) do
    merged =
      Merge.merge_fields(
        Map.from_struct(current),
        current.dirty_fields || %{},
        Map.take(remote, @syncable_fields),
        remote[:remote_updated_at],
        @syncable_fields
      )

    base = %{
      remote_number: remote[:remote_number],
      url: remote[:remote_url],
      remote_url: remote[:remote_url],
      branch_name: remote[:branch_name],
      remote_updated_at: remote[:remote_updated_at],
      last_synced_at: DateTime.utc_now(),
      dirty_fields: merged.dirty_fields,
      sync_status: if(merged.conflict?, do: "conflict", else: "synced")
    }

    # Only move status when the local `state` is not a pending local edit.
    base = if Map.has_key?(merged.dirty_fields, "state"), do: base, else: Map.put(base, :status_id, status_id)

    current
    |> IssueRecord.changeset(Map.merge(base, merged.attrs))
    |> Repo.update!()
  end

  defp existing_issue(project_id, remote_id) do
    IssueRecord
    |> where([i], i.project_id == ^project_id and i.remote_id == ^remote_id)
    |> Repo.one()
  end

  defp resolve_status_id(project_id, state_name) when is_binary(state_name) do
    case Repo.get_by(WorkflowStatus, project_id: project_id, name: state_name) do
      %WorkflowStatus{id: id} -> id
      nil -> first_status_id(project_id)
    end
  end

  defp resolve_status_id(project_id, _state), do: first_status_id(project_id)

  defp first_status_id(project_id) do
    WorkflowStatus
    |> where([s], s.project_id == ^project_id)
    |> order_by([s], asc: s.position, asc: s.id)
    |> limit(1)
    |> select([s], s.id)
    |> Repo.one()
  end

  # -- labels ------------------------------------------------------------------

  defp upsert_labels!(project, issue, labels) when is_list(labels) do
    label_ids =
      Enum.map(labels, fn label ->
        ensure_label!(project.id, label).id
      end)

    # Replace the remote-origin label set: clear current links, re-link.
    Repo.delete_all(from(il in IssueLabel, where: il.issue_id == ^issue.id))

    Enum.each(label_ids, fn label_id ->
      %IssueLabel{}
      |> IssueLabel.changeset(%{issue_id: issue.id, label_id: label_id})
      |> Repo.insert!(on_conflict: :nothing)
    end)

    :ok
  end

  defp ensure_label!(project_id, %{name: name} = label) do
    found =
      cond do
        is_binary(label[:remote_id]) ->
          Repo.get_by(Label, project_id: project_id, remote_id: label[:remote_id])

        true ->
          nil
      end || Repo.get_by(Label, project_id: project_id, name: name)

    attrs = %{project_id: project_id, name: name, color: label[:color], remote_id: label[:remote_id]}

    (found || %Label{})
    |> Label.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  # -- comments ----------------------------------------------------------------

  defp upsert_comments!(issue, comments) when is_list(comments) do
    Enum.each(comments, fn comment ->
      attrs = %{
        issue_id: issue.id,
        kind: "comment",
        body: comment[:body],
        author: comment[:author] || "remote",
        remote_id: comment[:remote_id],
        remote_updated_at: comment[:remote_updated_at],
        last_synced_at: DateTime.utc_now(),
        sync_status: "synced"
      }

      case Repo.get_by(Comment, issue_id: issue.id, remote_id: comment[:remote_id]) do
        nil -> %Comment{}
        %Comment{} = existing -> existing
      end
      |> Comment.changeset(attrs)
      |> Repo.insert_or_update!()
    end)

    :ok
  end
end
```

> **Executor note:** `IssueLabel.changeset/2` must accept `issue_id`/`label_id`. If the existing `IssueLabel` schema (Plan 1 report: composite PK, no `id`) lacks a `changeset/2`, add a minimal one:
> ```elixir
> def changeset(il, attrs), do: il |> cast(attrs, [:issue_id, :label_id]) |> validate_required([:issue_id, :label_id])
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/local_store.ex test/symphony_elixir/tracker/sync/local_store_test.exs
git commit -m "feat(tracker): upsert remote issues/labels/comments into local store"
```

---

## Task 2: LWW merge on update path

**Files:**
- Modify: `elixir/test/symphony_elixir/tracker/sync/local_store_test.exs` (add cases)

- [ ] **Step 1: Add failing tests**

Add inside the test module (before the private helpers):

```elixir
  test "remote update overwrites fields with no pending local edit", %{project: project} do
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "v1"}))
    {:ok, updated} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "v2", remote_updated_at: DateTime.utc_now()}))
    assert updated.title == "v2"
    assert updated.sync_status == "synced"
  end

  test "a newer pending local edit survives a remote pull", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "remote-v1"}))

    # Simulate a pending local edit newer than the next remote update.
    future = DateTime.utc_now() |> DateTime.add(120, :second) |> DateTime.to_iso8601()
    Repo.get!(IssueRecord, issue.id)
    |> Ecto.Changeset.change(%{title: "local-edit", dirty_fields: %{"title" => future}})
    |> Repo.update!()

    {:ok, after_pull} =
      LocalStore.upsert_remote_issue(project, remote_issue(%{title: "remote-v2", remote_updated_at: DateTime.utc_now()}))

    assert after_pull.title == "local-edit"
    assert Map.has_key?(after_pull.dirty_fields, "title")
  end
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: PASS (6 tests). The merge logic comes from `update_issue!/3` + `Merge`.

- [ ] **Step 3: Commit**

```bash
git add test/symphony_elixir/tracker/sync/local_store_test.exs
git commit -m "test(tracker): cover LWW merge in local store"
```

---

## Task 3: `upsert_pull_requests/2`

**Files:**
- Modify: `elixir/test/symphony_elixir/tracker/sync/local_store_test.exs` (add case)

(The implementation was added in Task 1.)

- [ ] **Step 1: Add failing test**

```elixir
  test "upsert_pull_requests links and updates PR state", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    :ok = LocalStore.upsert_pull_requests(issue, [%{remote_id: "PR_1", number: 9, url: "u", title: "t", state: "open"}])
    :ok = LocalStore.upsert_pull_requests(issue, [%{remote_id: "PR_1", number: 9, url: "u", title: "t", state: "merged"}])

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert length(prs) == 1
    assert hd(prs).state == "merged"
  end
```

- [ ] **Step 2: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add test/symphony_elixir/tracker/sync/local_store_test.exs
git commit -m "test(tracker): cover pull request upsert in local store"
```

---

## Task 4: Verification

- [ ] **Step 1: Run + format + credo**

Run:
```bash
mix test test/symphony_elixir/tracker/sync/local_store_test.exs
mix format
mix credo lib/symphony_elixir/tracker/sync/local_store.ex --strict || true
```
Expected: PASS; format clean; no new credo issues.

- [ ] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore(tracker): format local store" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:** Implements the spec's "Pull (remote → local)" upsert (insert full mirror; update via field-level merge), label association (spec "Labels"), comment mirroring (spec "Comments"), and `tracker_pull_requests` upsert (spec "Pull Requests"). State-name → local status mapping covers the spec's "Workflow statuses" reading. The `state`-is-dirty guard implements "locally-created/edited fields are not clobbered by pull".

**Placeholder scan:** None. Complete module + tests + commands. The single executor note (IssueLabel changeset) is a concrete, copy-pasteable snippet, not a placeholder.

**Type/name consistency:** Consumes `Merge.merge_fields/5` exactly as defined in Plan 2 (`%{attrs, dirty_fields, conflict?}`). Uses `PullRequestRecord`, `Comment`, `Label`, `IssueLabel`, `WorkflowStatus`, `IssueRecord` schemas/fields defined in Plan 1. The normalized remote-issue map shape declared here is the contract the Plan 5 drivers must produce.
