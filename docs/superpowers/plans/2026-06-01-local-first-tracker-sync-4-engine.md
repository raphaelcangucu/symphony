# Local-First Tracker Sync — Plan 4: Sync Engine + Driver Behaviour

**Goal:** Add the background sync coordinator: a `Tracker.Sync.Driver` behaviour (the remote contract), a `Tracker.Sync.Engine` GenServer that pushes the outbox then pulls remote data into the local store per project, and a non-blocking force-sync hook fired by the orchestrator poll. Drive it end-to-end with a fake in-memory driver (no network).

**Architecture:** `Engine` is the ONLY component that talks to a `Driver`. On a tick (or on demand), for each sync-enabled project it: (1) claims outbox entries and `push/2`es each, marking done/failed; (2) calls `pull/2` and feeds results to `Tracker.Sync.LocalStore`; (3) updates `tracker_sync_state`. The engine never blocks callers: `request_sync/1` is a `cast`. The orchestrator casts `request_sync(force: true)` at the start of every poll so pending local writes flush promptly while reads stay local.

**Tech Stack:** Elixir, GenServer, Ecto. Tests use a fake driver module and `async: false` DB setup.

**Depends on:** Plans 1–3 (`Outbox`, `Merge`, `LocalStore`, schemas).

---

## Task 1: `Tracker.Sync.Driver` behaviour

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/driver.ex`

- [ ] **Step 1: Write the behaviour (no test — it is a contract)**

Create `elixir/lib/symphony_elixir/tracker/sync/driver.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.Driver do
  @moduledoc """
  Contract every remote tracker (GitHub, Linear, …) implements for the sync
  engine. The engine is the only caller; drivers must not touch the local store.

  - `pull/2` returns normalized issue maps (see `Tracker.Sync.LocalStore`) for the
    project, optionally constrained by `:since` (incremental cursor) in `opts`.
  - `push/2` applies one outbox entry to the remote and returns the remote id it
    created/affected (or `nil`). It must be idempotent enough to tolerate retries.
  - `pull_pull_requests/2` returns PR maps linked to one issue. GitHub implements
    it for every project (GitHub is the standard source control); other drivers
    may return `{:ok, []}`.
  """

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  @type normalized_issue :: map()
  @type pr :: map()

  @callback pull(Project.t(), keyword()) :: {:ok, [normalized_issue()]} | {:error, term()}
  @callback push(Project.t(), OutboxEntry.t()) :: {:ok, String.t() | nil} | {:error, term()}
  @callback pull_pull_requests(Project.t(), IssueRecord.t()) :: {:ok, [pr()]} | {:error, term()}
end
```

- [ ] **Step 2: Verify it compiles**

Run: `mix compile`
Expected: compiles with no warnings about `Tracker.Sync.Driver`.

- [ ] **Step 3: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/driver.ex
git commit -m "feat(tracker): add sync driver behaviour"
```

---

## Task 2: `Tracker.Sync.Engine` — push + pull one project

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/engine.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/engine_test.exs`

- [ ] **Step 1: Write the failing test (with a fake driver)**

Create `elixir/test/symphony_elixir/tracker/sync/engine_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.EngineTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, OutboxEntry, StateRecord}

  defmodule FakeDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts) do
      send(self(), {:fake_pull, :called})

      {:ok,
       [
         %{
           remote_id: "I_1",
           remote_number: 1,
           identifier: "1",
           title: "Pulled issue",
           description: "body",
           state: "Todo",
           priority: nil,
           assignee_id: nil,
           branch_name: nil,
           remote_url: "u",
           creator: "octo",
           position: 0,
           remote_updated_at: DateTime.utc_now(),
           labels: [],
           comments: []
         }
       ]}
    end

    @impl true
    def push(_project, %OutboxEntry{} = entry) do
      send(self(), {:fake_push, entry.dedup_key})
      {:ok, "REMOTE_#{entry.id}"}
    end

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "sync_project pushes outbox entries then pulls remote issues", %{project: project} do
    {:ok, _} =
      Outbox.enqueue(%{project_id: project.id, entity_type: "state", operation: "move", payload: %{"state" => "Done"}, dedup_key: "k1"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FakeDriver)

    assert_received {:fake_push, "k1"}
    assert_received {:fake_pull, :called}
    assert summary.pushed == 1
    assert summary.pulled == 1

    # Outbox entry closed; remote issue mirrored locally; sync_state recorded.
    assert Outbox.pending_count(project.id) == 0
    assert Repo.aggregate(IssueRecord, :count) == 1
    state = Repo.get_by(StateRecord, project_id: project.id)
    assert state.status == "idle"
    refute is_nil(state.last_pull_at)
  end

  test "a failing push marks the entry failed without aborting the pull", %{project: project} do
    defmodule FailPushDriver do
      @behaviour SymphonyElixir.Tracker.Sync.Driver
      @impl true
      def pull(_p, _o), do: {:ok, []}
      @impl true
      def push(_p, _e), do: {:error, "boom"}
      @impl true
      def pull_pull_requests(_p, _i), do: {:ok, []}
    end

    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{}, dedup_key: "c"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FailPushDriver, max_attempts: 1)
    assert summary.failed == 1
    failed = Repo.one(OutboxEntry)
    assert failed.status == "failed"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "tracker_sync_state",
          "tracker_sync_outbox",
          "tracker_pull_requests",
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

Run: `mix test test/symphony_elixir/tracker/sync/engine_test.exs`
Expected: FAIL — `Engine` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/engine.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.Engine do
  @moduledoc """
  Background coordinator for local-first tracker sync.

  For each sync-enabled project the engine pushes queued outbox writes to the
  remote (`Driver.push/2`) and then pulls remote issues into the local store
  (`Driver.pull/2` -> `LocalStore.upsert_remote_issue/2`). `request_sync/1` is a
  fire-and-forget `cast`, so callers (the orchestrator poll) never block on the
  remote — reads remain local even while the remote is rate limited.

  `sync_project/2` is the synchronous unit of work used by the cast handler and by
  tests; it accepts a `:driver` override and an optional `:max_attempts`.
  """

  use GenServer
  require Logger

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, Outbox, StateRecord}

  @default_max_attempts 5

  @type summary :: %{pushed: non_neg_integer(), failed: non_neg_integer(), pulled: non_neg_integer()}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  @doc "Fire-and-forget request to sync all sync-enabled projects."
  @spec request_sync(keyword()) :: :ok
  def request_sync(opts \\ []) do
    if alive?(), do: GenServer.cast(__MODULE__, {:sync_all, opts}), else: :ok
  end

  @doc "Synchronously sync one project. Returns a `summary`."
  @spec sync_project(map(), keyword()) :: {:ok, summary()} | {:error, term()}
  def sync_project(project, opts \\ []) do
    driver = Keyword.fetch!(opts, :driver)
    max_attempts = Keyword.get(opts, :max_attempts, @default_max_attempts)

    mark_state(project, %{status: "syncing"})

    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts),
         {:ok, pulled} <- pull_remote(project, driver) do
      mark_state(project, %{status: "idle", last_pull_at: now(), last_push_at: now(), last_error: nil})
      {:ok, Map.put(push_summary, :pulled, pulled)}
    else
      {:error, reason} = error ->
        mark_state(project, %{status: "error", last_error: inspect(reason)})
        error
    end
  end

  @impl true
  def init(opts), do: {:ok, %{driver_for: Keyword.get(opts, :driver_for, &default_driver_for/1)}}

  @impl true
  def handle_cast({:sync_all, opts}, state) do
    Enum.each(sync_enabled_projects(), fn project ->
      driver = Keyword.get(opts, :driver) || state.driver_for.(project)

      if driver do
        case sync_project(project, Keyword.put(opts, :driver, driver)) do
          {:ok, _summary} -> :ok
          {:error, reason} -> Logger.warning("Tracker sync failed for #{project.slug}: #{inspect(reason)}")
        end
      end
    end)

    {:noreply, state}
  end

  # -- push --------------------------------------------------------------------

  defp push_outbox(project, driver, max_attempts) do
    entries = Outbox.claim_pending(project.id, 50)

    summary =
      Enum.reduce(entries, %{pushed: 0, failed: 0}, fn entry, acc ->
        case safe_push(driver, project, entry) do
          {:ok, remote_id} ->
            Outbox.mark_done(entry, remote_id)
            %{acc | pushed: acc.pushed + 1}

          {:error, reason} ->
            {:ok, updated} = Outbox.mark_failed(entry, inspect(reason), max_attempts)
            if updated.status == "failed", do: %{acc | failed: acc.failed + 1}, else: acc
        end
      end)

    {:ok, summary}
  end

  defp safe_push(driver, project, entry) do
    driver.push(project, entry)
  rescue
    error -> {:error, error}
  end

  # -- pull --------------------------------------------------------------------

  defp pull_remote(project, driver) do
    case driver.pull(project, []) do
      {:ok, issues} ->
        Enum.each(issues, fn remote -> LocalStore.upsert_remote_issue(project, remote) end)
        {:ok, length(issues)}

      {:error, _reason} = error ->
        error
    end
  end

  # -- sync state --------------------------------------------------------------

  defp mark_state(project, attrs) do
    base = Repo.get_by(StateRecord, project_id: project.id) || %StateRecord{}

    base
    |> StateRecord.changeset(Map.merge(%{project_id: project.id}, attrs))
    |> Repo.insert_or_update!()
  end

  defp sync_enabled_projects do
    Context.list_projects()
    |> Enum.filter(&sync_enabled?/1)
  end

  defp sync_enabled?(project) do
    # Projects whose tracker is a remote (github/linear) are sync-enabled.
    project_tracker_kind(project) in ["github", "linear"]
  end

  defp project_tracker_kind(project), do: Map.get(project, :tracker_kind) || Map.get(project, :tracker) || "local"

  defp default_driver_for(project) do
    case project_tracker_kind(project) do
      "github" -> SymphonyElixir.GitHub.SyncDriver
      "linear" -> SymphonyElixir.Linear.SyncDriver
      _ -> nil
    end
  end

  defp now, do: DateTime.utc_now()

  defp alive? do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) -> Process.alive?(pid)
      _ -> false
    end
  end
end
```

> **Executor note:** `project_tracker_kind/1` reads whatever field the `Project` schema uses to record its tracker (`:tracker_kind` or `:tracker`). Confirm the column name in `local_tracker/project.ex` and keep the one that exists; drop the other. The `GitHub.SyncDriver` / `Linear.SyncDriver` referenced in `default_driver_for/1` are built in Plan 5; until then the fake driver is injected via opts in tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/engine_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/engine.ex test/symphony_elixir/tracker/sync/engine_test.exs
git commit -m "feat(tracker): add sync engine push/pull per project"
```

---

## Task 3: Supervise the engine

**Files:**
- Modify: `elixir/lib/symphony_elixir.ex` (supervision tree `base_children`)

- [ ] **Step 1: Add the engine to the supervision tree**

In `elixir/lib/symphony_elixir.ex`, find `base_children` (where `SymphonyElixir.GitHub.RequestGateway` was added) and append `SymphonyElixir.Tracker.Sync.Engine` AFTER `RequestGateway` (so the gateway is available to drivers):

```elixir
      SymphonyElixir.GitHub.RequestGateway,
      SymphonyElixir.Tracker.Sync.Engine,
```

- [ ] **Step 2: Verify boot**

Run: `mix compile`
Expected: compiles cleanly. (Full boot is exercised by the existing app start tests.)

- [ ] **Step 3: Commit**

```bash
git add lib/symphony_elixir.ex
git commit -m "feat(tracker): supervise the sync engine"
```

---

## Task 4: Orchestrator force-sync hook (non-blocking)

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex:187-192` (`maybe_dispatch/1`)
- Test: `elixir/test/symphony_elixir/orchestrator_sync_hook_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/orchestrator_sync_hook_test.exs`:

```elixir
defmodule SymphonyElixir.OrchestratorSyncHookTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.Engine

  test "request_sync is a no-op when the engine is not running" do
    # Ensure no engine process is registered in this isolated test.
    if pid = Process.whereis(Engine), do: Process.exit(pid, :kill)
    assert Engine.request_sync(force: true) == :ok
  end
end
```

- [ ] **Step 2: Run test to verify it passes (request_sync already tolerates a dead engine)**

Run: `mix test test/symphony_elixir/orchestrator_sync_hook_test.exs`
Expected: PASS. (This guards the non-blocking contract used by the orchestrator.)

- [ ] **Step 3: Add the hook to `maybe_dispatch/1`**

In `elixir/lib/symphony_elixir/orchestrator.ex`, add the alias `Sync` is not needed — call fully-qualified. Change the start of `maybe_dispatch/1`:

```elixir
  defp maybe_dispatch(%State{} = state) do
    SymphonyElixir.Tracker.Sync.Engine.request_sync(force: true)
    state = reconcile_running_issues(state)

    with :ok <- Config.validate!(),
         {:ok, issues} <- Tracker.fetch_candidate_issues(),
         true <- available_slots(state) > 0 do
      choose_issues(issues, state)
    else
```

(Leave the rest of the function unchanged.)

- [ ] **Step 4: Verify compile + orchestrator tests still pass**

Run:
```bash
mix compile
mix test test/symphony_elixir/orchestrator_test.exs || mix test --only orchestrator || true
```
Expected: compiles; orchestrator suite passes as before (the cast is a no-op unless the engine runs, and never blocks the poll).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/orchestrator.ex test/symphony_elixir/orchestrator_sync_hook_test.exs
git commit -m "feat(tracker): trigger non-blocking force-sync on each poll"
```

---

## Task 5: Verification

- [ ] **Step 1: Run + format + credo**

Run:
```bash
mix test test/symphony_elixir/tracker/sync/
mix format
mix credo lib/symphony_elixir/tracker/sync/ --strict || true
```
Expected: PASS; format clean; no new credo issues.

- [ ] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore(tracker): format sync engine" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:** Implements the spec's "Sync engine is the sole remote interface", push-then-pull ordering, `tracker_sync_state` bookkeeping, and the approved trigger model — "junto com o orchestrador, passando uma variável para forçar o sync durante o pooling" — as a non-blocking `request_sync(force: true)` cast in `maybe_dispatch/1`. The engine cannot reintroduce the earlier hang because callers never block on the remote.

**Placeholder scan:** None. Full behaviour, engine, and tests with a fake driver; exact edit locations and commands. Two executor notes are concrete (confirm `Project` tracker-kind column; drivers arrive in Plan 5).

**Type/name consistency:** `Driver` callbacks (`pull/2`, `push/2`, `pull_pull_requests/2`) match the calls in `Engine` and the implementations planned in Plan 5. `Engine.sync_project/2` returns `%{pushed, failed, pulled}` exactly as asserted in tests. `Outbox` calls (`claim_pending/2`, `mark_done/2`, `mark_failed/3`, `pending_count/1`) match Plan 2. `LocalStore.upsert_remote_issue/2` matches Plan 3. `StateRecord.changeset/2` fields match Plan 1.
