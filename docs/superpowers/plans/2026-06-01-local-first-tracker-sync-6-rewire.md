# Local-First Tracker Sync — Plan 6: Rewire Reads/Writes to Local-First

**Goal:** Make remote-backed projects (GitHub/Linear) serve all UI and orchestrator reads from the local store and route all writes through the local store + outbox, behind a `tracker.sync_enabled` flag. Wire the reconciler to read locally-mirrored pull requests, perform an initial backfill, and add sync observability.

**Architecture:** Reads and writes for remote trackers go through a single wrapper, `Tracker.Sync.LocalFirstAdapter`, which implements the existing `Tracker.IssueAdapter` behaviour: reads delegate to `LocalTracker.IssueAdapter` (local DB); writes persist locally, mark the touched fields dirty (for LWW), and enqueue an `Outbox` entry that the engine pushes. `Tracker.IssueAdapter.for/1` returns this wrapper for `github`/`linear` projects when the flag is on; the orchestrator's `SymphonyElixir.Tracker.adapter/0` similarly routes to the local tracker. The flag defaults OFF so the change ships dark and is enabled deliberately.

**Tech Stack:** Elixir, Ecto, existing adapters, `Config`. Tests stub the local adapter and assert outbox enqueue.

**Depends on:** Plans 1–5 (schemas, outbox, local store, engine, drivers).

---

## Task 1: `Config.tracker_sync_enabled?/0` flag

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Test: `elixir/test/symphony_elixir/config_sync_flag_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/config_sync_flag_test.exs`:

```elixir
defmodule SymphonyElixir.ConfigSyncFlagTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Config

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)
    on_exit(fn -> restore(:tracker, original) end)
    :ok
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)

  test "defaults to false" do
    Application.delete_env(:symphony_elixir, :tracker)
    refute Config.tracker_sync_enabled?()
  end

  test "reads true from the :tracker config" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Config.tracker_sync_enabled?()
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/config_sync_flag_test.exs`
Expected: FAIL — `tracker_sync_enabled?/0` undefined.

- [ ] **Step 3: Add the getter to `config.ex`**

Add this function to `SymphonyElixir.Config` (near the other tracker getters; match the module's existing style for reading `Application.get_env/3`):

```elixir
  @spec tracker_sync_enabled?() :: boolean()
  def tracker_sync_enabled? do
    :symphony_elixir
    |> Application.get_env(:tracker, [])
    |> Keyword.get(:sync_enabled, false)
    |> normalize_bool()
  end

  defp normalize_bool(true), do: true
  defp normalize_bool("true"), do: true
  defp normalize_bool("1"), do: true
  defp normalize_bool(_other), do: false
```

> **Executor note:** If `Config` already defines a `normalize_bool/1` (or equivalent boolean coercion) helper, reuse it instead of adding a duplicate to satisfy credo's no-duplicate rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/config_sync_flag_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/config.ex test/symphony_elixir/config_sync_flag_test.exs
git commit -m "feat(config): add tracker.sync_enabled flag (default off)"
```

---

## Task 2: `LocalStore.mark_dirty/3` — flag local edits for LWW

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_store_dirty_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/local_store_dirty_test.exs`:

```elixir
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
        remote_id: "I_1", remote_number: 1, identifier: "1", title: "t", description: nil,
        state: "Todo", priority: nil, assignee_id: nil, branch_name: nil, remote_url: "u",
        creator: nil, position: 0, remote_updated_at: DateTime.utc_now(), labels: [], comments: []
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_dirty_test.exs`
Expected: FAIL — `mark_dirty/3` undefined.

- [ ] **Step 3: Add `mark_dirty/3` to `local_store.ex`**

Add to `SymphonyElixir.Tracker.Sync.LocalStore` (add `Context` to the existing aliases if not present):

```elixir
  @doc """
  Marks `fields` as locally-edited on an issue (so a later remote pull respects
  LWW) and flips its `sync_status` to `pending`.
  """
  @spec mark_dirty(String.t(), String.t(), [atom()]) :: {:ok, IssueRecord.t()} | {:error, term()}
  def mark_dirty(identifier, project_slug, fields) when is_list(fields) do
    with {:ok, issue} <- SymphonyElixir.LocalTracker.Context.get_issue(project_slug, identifier) do
      now_iso = DateTime.to_iso8601(DateTime.utc_now())
      dirty = Enum.reduce(fields, issue.dirty_fields || %{}, fn field, acc -> Map.put(acc, Atom.to_string(field), now_iso) end)

      issue
      |> IssueRecord.changeset(%{dirty_fields: dirty, sync_status: "pending"})
      |> Repo.update()
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/local_store_dirty_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/local_store.ex test/symphony_elixir/tracker/sync/local_store_dirty_test.exs
git commit -m "feat(tracker): mark local edits dirty for LWW"
```

---

## Task 3: `Tracker.Sync.LocalFirstAdapter` — read local, write local + enqueue

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`:

```elixir
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
        remote_id: "I_1", remote_number: 1, identifier: "1", title: "t", description: nil,
        state: "Todo", priority: nil, assignee_id: nil, branch_name: nil, remote_url: "u",
        creator: nil, position: 0, remote_updated_at: DateTime.utc_now(), labels: [], comments: []
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
    for table <- [
          "tracker_sync_outbox",
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

Run: `mix test test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`
Expected: FAIL — `LocalFirstAdapter` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/local_first_adapter.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.LocalFirstAdapter do
  @moduledoc """
  `Tracker.IssueAdapter` wrapper for remote-backed projects when local-first sync
  is enabled. Reads are served from the local store via `LocalTracker.IssueAdapter`.
  Writes persist locally, mark touched fields dirty for LWW, and enqueue an
  `Outbox` entry the sync engine pushes to the remote.
  """

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.LocalTracker.{IssueAdapter, Project}
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox}

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, filters), do: IssueAdapter.list_issues(project, filters)

  @impl true
  def get_issue(%Project{} = project, identifier), do: IssueAdapter.get_issue(project, identifier)

  @impl true
  def list_statuses(%Project{} = project), do: IssueAdapter.list_statuses(project)

  @impl true
  def list_labels(%Project{} = project), do: IssueAdapter.list_labels(project)

  @impl true
  def list_assignable_users(%Project{} = project), do: IssueAdapter.list_assignable_users(project)

  @impl true
  def list_comments(%Project{} = project, identifier), do: IssueAdapter.list_comments(project, identifier)

  @impl true
  def create_issue(%Project{} = project, attrs) do
    with {:ok, dto} <- IssueAdapter.create_issue(project, attrs) do
      enqueue(project, dto.identifier, "issue", "create", attrs, "issue:create:#{project.id}:#{dto.identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def update_issue(%Project{} = project, identifier, attrs) do
    with {:ok, dto} <- IssueAdapter.update_issue(project, identifier, attrs) do
      LocalStore.mark_dirty(identifier, project.slug, dirty_fields(attrs))
      enqueue(project, identifier, "issue", "update", attrs, "issue:update:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    with {:ok, dto} <- IssueAdapter.move_issue(project, identifier, attrs) do
      LocalStore.mark_dirty(identifier, project.slug, [:state])
      state = attrs["status"] || attrs["state"] || attrs[:status]
      enqueue(project, identifier, "state", "move", %{"identifier" => identifier, "state" => state}, "state:move:#{project.id}:#{identifier}")
      {:ok, dto}
    end
  end

  @impl true
  def add_comment(%Project{} = project, identifier, body, attrs) do
    with {:ok, comment} <- IssueAdapter.add_comment(project, identifier, body, attrs) do
      enqueue(project, identifier, "comment", "create", %{"identifier" => identifier, "body" => body}, nil)
      {:ok, comment}
    end
  end

  defp enqueue(project, identifier, entity_type, operation, payload, dedup_key) do
    issue_id =
      case SymphonyElixir.LocalTracker.Context.get_issue(project.slug, identifier) do
        {:ok, issue} -> issue.id
        _ -> nil
      end

    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue_id,
      entity_type: entity_type,
      operation: operation,
      payload: stringify(payload),
      dedup_key: dedup_key
    })
  end

  defp dirty_fields(attrs) do
    attrs
    |> Map.keys()
    |> Enum.map(&to_dirty_field/1)
    |> Enum.reject(&is_nil/1)
  end

  defp to_dirty_field(key) when key in [:title, "title"], do: :title
  defp to_dirty_field(key) when key in [:description, "description"], do: :description
  defp to_dirty_field(key) when key in [:priority, "priority"], do: :priority
  defp to_dirty_field(key) when key in [:assignee_id, "assignee_id", :assignee, "assignee"], do: :assignee_id
  defp to_dirty_field(_key), do: nil

  defp stringify(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/local_first_adapter_test.exs`
Expected: PASS (3 tests).

> If `LocalTracker.IssueAdapter.move_issue/3` expects local statuses that exist for the project (they do — default statuses are seeded by `ensure_project`), `"Done"` resolves. If the local adapter's write functions take different arg shapes than the remote ones, adapt the delegations — the local adapter implements the same `Tracker.IssueAdapter` behaviour, so signatures match by contract.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/local_first_adapter.ex test/symphony_elixir/tracker/sync/local_first_adapter_test.exs
git commit -m "feat(tracker): local-first adapter (read local, write local + enqueue)"
```

---

## Task 4: Route remote projects to the local-first adapter when the flag is on

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/issue_adapter.ex:60-65` (`for/1`)
- Test: `elixir/test/symphony_elixir/tracker/issue_adapter_routing_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/issue_adapter_routing_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.IssueAdapterRoutingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.LocalFirstAdapter

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)
    on_exit(fn ->
      if original, do: Application.put_env(:symphony_elixir, :tracker, original), else: Application.delete_env(:symphony_elixir, :tracker)
    end)
    :ok
  end

  test "github project routes to LocalFirstAdapter when sync enabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert IssueAdapter.for(%Project{tracker_kind: "github"}) == LocalFirstAdapter
  end

  test "github project routes to the remote adapter when sync disabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    assert IssueAdapter.for(%Project{tracker_kind: "github"}) == SymphonyElixir.GitHub.IssueAdapter
  end

  test "local project always routes to the local adapter" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert IssueAdapter.for(%Project{tracker_kind: "local"}) == SymphonyElixir.LocalTracker.IssueAdapter
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/issue_adapter_routing_test.exs`
Expected: FAIL — `for/1` still returns `GitHub.IssueAdapter` when sync enabled.

- [ ] **Step 3: Update `for/1`**

Replace `for/1` in `elixir/lib/symphony_elixir/tracker/issue_adapter.ex`:

```elixir
  @spec for(Project.t()) :: module()
  def for(%Project{tracker_kind: kind}) do
    overrides = Application.get_env(:symphony_elixir, :issue_adapters, %{})
    merged = Map.merge(@default_adapters, overrides)
    base = Map.get(merged, kind, SymphonyElixir.LocalTracker.IssueAdapter)

    if SymphonyElixir.Config.tracker_sync_enabled?() and kind in ["github", "linear"] do
      SymphonyElixir.Tracker.Sync.LocalFirstAdapter
    else
      base
    end
  end
```

(Add `alias SymphonyElixir.Config` at the top if you prefer; fully-qualified is fine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/issue_adapter_routing_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/issue_adapter.ex test/symphony_elixir/tracker/issue_adapter_routing_test.exs
git commit -m "feat(tracker): route remote projects through local-first adapter behind flag"
```

---

## Task 5: Route the orchestrator's tracker to local when sync is enabled

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker.ex:62-70` (`adapter/0`)
- Test: `elixir/test/symphony_elixir/tracker_adapter_routing_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker_adapter_routing_test.exs`:

```elixir
defmodule SymphonyElixir.TrackerAdapterRoutingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Tracker

  setup do
    tracker = Application.get_env(:symphony_elixir, :tracker)
    kind = Application.get_env(:symphony_elixir, :tracker_kind)

    on_exit(fn ->
      reset(:tracker, tracker)
      reset(:tracker_kind, kind)
    end)

    :ok
  end

  defp reset(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp reset(key, value), do: Application.put_env(:symphony_elixir, key, value)

  test "github tracker reads locally when sync is enabled" do
    Application.put_env(:symphony_elixir, :tracker_kind, "github")
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Tracker.adapter() == SymphonyElixir.LocalTracker.Tracker
  end

  test "github tracker reads remotely when sync is disabled" do
    Application.put_env(:symphony_elixir, :tracker_kind, "github")
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    assert Tracker.adapter() == SymphonyElixir.GitHub.Tracker
  end
end
```

> **Executor note:** `Config.tracker_kind()` may read a different env key than `:tracker_kind`. Inspect `Config.tracker_kind/0` and set the env key it actually reads in this test's `setup`. The behavioral assertion (github + sync_enabled → `LocalTracker.Tracker`) is the requirement.

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker_adapter_routing_test.exs`
Expected: FAIL — still returns `GitHub.Tracker`.

- [ ] **Step 3: Update `adapter/0`**

Replace `adapter/0` in `elixir/lib/symphony_elixir/tracker.ex`:

```elixir
  @spec adapter() :: module()
  def adapter do
    kind = Config.tracker_kind()

    cond do
      kind == "local" -> SymphonyElixir.LocalTracker.Tracker
      kind == "memory" -> SymphonyElixir.Memory.Tracker
      Config.tracker_sync_enabled?() and kind in ["github", "linear"] -> SymphonyElixir.LocalTracker.Tracker
      kind == "linear" -> SymphonyElixir.Linear.Tracker
      true -> SymphonyElixir.GitHub.Tracker
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker_adapter_routing_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker.ex test/symphony_elixir/tracker_adapter_routing_test.exs
git commit -m "feat(tracker): orchestrator reads local when sync enabled"
```

---

## Task 6: Reconciler reads locally-mirrored pull requests

**Files:**
- Read first: `elixir/lib/symphony_elixir/dev_server/reconciler.ex` (or wherever PRs are fetched for the merging flow — locate with the search below)
- Create: `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex` (local PR reader)
- Test: `elixir/test/symphony_elixir/tracker/sync/pull_requests_reader_test.exs`

- [ ] **Step 1: Locate the current PR read path**

Run: `rg -n "PullRequests|pull_request|for_issue" lib/symphony_elixir/dev_server lib/symphony_elixir/github/pull_requests.ex`
Use the output to identify where the merging/reconciler flow asks GitHub for PRs.

- [ ] **Step 2: Write the failing test for a local PR reader**

Create `elixir/test/symphony_elixir/tracker/sync/pull_requests_reader_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.PullRequestsReaderTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, PullRequests}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})

    {:ok, issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_1", remote_number: 1, identifier: "1", title: "t", description: nil,
        state: "Todo", priority: nil, assignee_id: nil, branch_name: nil, remote_url: "u",
        creator: nil, position: 0, remote_updated_at: DateTime.utc_now(), labels: [], comments: []
      })

    :ok = LocalStore.upsert_pull_requests(issue, [%{remote_id: "PR_1", number: 7, url: "u", title: "t", state: "open"}])
    %{project: project}
  end

  test "for_issue returns locally-mirrored PRs", %{project: project} do
    assert [pr] = PullRequests.for_issue(project.slug, "1")
    assert pr.number == 7
    assert pr.state == "open"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- ["tracker_pull_requests", "local_tracker_issues", "local_tracker_workflow_statuses", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end
  end
end
```

- [ ] **Step 3: Write the local PR reader**

Create `elixir/lib/symphony_elixir/tracker/sync/pull_requests.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.PullRequests do
  @moduledoc "Reads locally-mirrored pull requests for an issue (no network)."

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  @spec for_issue(String.t(), String.t()) :: [PullRequestRecord.t()]
  def for_issue(project_slug, identifier) do
    case Context.get_issue(project_slug, identifier) do
      {:ok, %IssueRecord{id: issue_id}} ->
        PullRequestRecord
        |> where([pr], pr.issue_id == ^issue_id)
        |> order_by([pr], asc: pr.number)
        |> Repo.all()

      _ ->
        []
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/pull_requests_reader_test.exs`
Expected: PASS.

- [ ] **Step 5: Wire the reconciler/merging flow to the local reader when sync is enabled**

Using the file located in Step 1, replace the direct GitHub PR fetch with `SymphonyElixir.Tracker.Sync.PullRequests.for_issue/2` guarded by `Config.tracker_sync_enabled?()` (fall back to the existing remote fetch when the flag is off). Keep the existing function's return contract; map `PullRequestRecord` fields to whatever shape the caller expects (`number`, `url`, `state`, `title`).

> **Executor note:** This step's exact edit depends on the located call site. The required behavior: when sync is enabled, the merging/reconciler flow must obtain PR status from `tracker_pull_requests` (local), not a live GitHub call. Add/adjust a focused test in the reconciler's existing test file asserting it reads local PRs under the flag.

- [ ] **Step 6: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/pull_requests.ex test/symphony_elixir/tracker/sync/pull_requests_reader_test.exs lib/symphony_elixir/dev_server/
git commit -m "feat(tracker): read pull requests from local mirror when sync enabled"
```

---

## Task 7: Initial backfill on first sync

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/engine.ex` (set `last_full_sync_at` once)
- Test: `elixir/test/symphony_elixir/tracker/sync/engine_backfill_test.exs`

The engine's `pull/2` already returns the full issue set each pass, so the first successful sync IS the backfill. This task records it so observability/UX can show "initial sync complete".

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/engine_backfill_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.EngineBackfillTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, StateRecord}

  defmodule EmptyDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_p, _o), do: {:ok, []}
    @impl true
    def push(_p, _e), do: {:ok, nil}
    @impl true
    def pull_pull_requests(_p, _i), do: {:ok, []}
  end

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn r -> Ecto.Migrator.run(r, :up, all: true) end)
    for t <- ["tracker_sync_state", "tracker_sync_outbox", "local_tracker_projects"], do: Repo.query!("delete from #{t}")
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "first successful sync stamps last_full_sync_at", %{project: project} do
    assert {:ok, _} = Engine.sync_project(project, driver: EmptyDriver, pr_driver: EmptyDriver)
    state = Repo.get_by(StateRecord, project_id: project.id)
    refute is_nil(state.last_full_sync_at)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/engine_backfill_test.exs`
Expected: FAIL — `last_full_sync_at` is nil.

- [ ] **Step 3: Stamp `last_full_sync_at` on success in `sync_project/2`**

In `engine.ex`, change the success branch's `mark_state` call to include `last_full_sync_at` only when it is not already set:

```elixir
    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts),
         {:ok, pulled} <- pull_remote(project, driver, pr_driver) do
      mark_state(project, success_attrs(project))
      {:ok, Map.put(push_summary, :pulled, pulled)}
    else
```

Add helper:

```elixir
  defp success_attrs(project) do
    base = %{status: "idle", last_pull_at: now(), last_push_at: now(), last_error: nil}

    case Repo.get_by(StateRecord, project_id: project.id) do
      %StateRecord{last_full_sync_at: %DateTime{}} -> base
      _ -> Map.put(base, :last_full_sync_at, now())
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/engine_backfill_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/engine.ex test/symphony_elixir/tracker/sync/engine_backfill_test.exs
git commit -m "feat(tracker): record initial backfill timestamp"
```

---

## Task 8: Observability — log sync summaries

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/engine.ex` (`handle_cast`)

- [ ] **Step 1: Add a structured info log after each project sync**

In `handle_cast({:sync_all, opts}, state)`, replace the success branch with a log:

```elixir
        case sync_project(project, Keyword.put(opts, :driver, driver)) do
          {:ok, summary} ->
            Logger.info("tracker_sync project=#{project.slug} pushed=#{summary.pushed} failed=#{summary.failed} pulled=#{summary.pulled}")

          {:error, reason} ->
            Logger.warning("Tracker sync failed for #{project.slug}: #{inspect(reason)}")
        end
```

- [ ] **Step 2: Verify compile + engine tests**

Run: `mix test test/symphony_elixir/tracker/sync/engine_test.exs`
Expected: PASS (no behavior change; logging only).

- [ ] **Step 3: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/engine.ex
git commit -m "chore(tracker): log sync summaries per project"
```

---

## Task 9: Full verification + docs

**Files:**
- Modify: `elixir/README.md` (document the local-first sync + flag)

- [ ] **Step 1: Document the feature in `README.md`**

Add a "Local-first tracker sync" subsection near the GitHub gateway docs describing: the flag `config :symphony_elixir, :tracker, sync_enabled: true`, that reads are served from SQLite, writes enqueue to the outbox, the engine pushes-then-pulls on each orchestrator poll, and GitHub is the source control for PRs regardless of tracker kind.

- [ ] **Step 2: Run the whole sync suite + format + credo + the broader local tracker suite**

Run:
```bash
mix test test/symphony_elixir/tracker/ test/symphony_elixir/github/sync_driver_test.exs test/symphony_elixir/linear/sync_driver_test.exs test/symphony_elixir/local_tracker/
mix format
mix credo lib/symphony_elixir/tracker/sync/ --strict || true
```
Expected: all PASS; format clean; no new credo issues.

- [ ] **Step 3: Manual smoke (flag on) — optional but recommended**

Set `sync_enabled: true` in dev config, run `make stop && make serve`, log in, open the board for a GitHub-backed project, and confirm: the board loads from local data quickly, moving a card updates immediately, and within one poll cycle the outbox drains (check `tracker_sync_outbox` is empty) and the remote reflects the change.

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md
git commit -m "docs(tracker): document local-first sync and flag"
```

---

## Self-Review

**Spec coverage:** Implements the spec's read-path change (UI + orchestrator read local for remote trackers — Tasks 4–5), write-path change (local write + dirty marking + outbox enqueue — Tasks 2–3), PR reads from local mirror (Task 6), initial backfill bookkeeping (Task 7), observability (Task 8), and a safe rollout flag defaulting OFF (Task 1). Together with Plans 1–5 this completes the local-first design end-to-end.

**Placeholder scan:** Tasks 1–5, 7, 8 contain complete code, tests, and exact edit locations. Task 6 contains a complete local reader + test; its single integration step is anchored by a concrete `rg` locator and a precise behavioral requirement (executor notes are concrete, not TBDs) because the exact reconciler call site must be confirmed at execution time.

**Type/name consistency:** `LocalFirstAdapter` implements every `Tracker.IssueAdapter` callback (Plan-read behaviour) and emits outbox entries whose `{entity_type, operation}` (`issue/create`, `issue/update`, `state/move`, `comment/create`) match `OutboxEntry` validations (Plan 1) and the driver `push/2` clauses (Plan 5). `Config.tracker_sync_enabled?/0` (Task 1) gates both `IssueAdapter.for/1` (Task 4) and `Tracker.adapter/0` (Task 5). `LocalStore.mark_dirty/3` (Task 2) writes the `dirty_fields`/`sync_status` consumed by `Merge` (Plan 2) during pull. `PullRequests.for_issue/2` returns `PullRequestRecord` rows from the `tracker_pull_requests` table (Plan 1) populated by the engine (Plan 5).
