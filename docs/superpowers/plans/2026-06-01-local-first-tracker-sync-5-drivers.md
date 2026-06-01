# Local-First Tracker Sync — Plan 5: GitHub + Linear Sync Drivers

**Goal:** Implement `Tracker.Sync.Driver` for GitHub and Linear by delegating to the existing remote `IssueAdapter`s, normalizing their `IssueDTO`s into the `LocalStore` shape, translating outbox entries into remote writes, and (GitHub only, for every project) pulling linked pull requests.

**Architecture:** Each driver wraps the matching remote `IssueAdapter` (`GitHub.IssueAdapter` / `Linear.IssueAdapter`). The adapter module is injected via application env so tests can substitute a stub (no network). `pull/2` lists issues + comments + labels and converts each to a normalized map. `push/2` pattern-matches the outbox entry's `{entity_type, operation}` and calls the adapter's `move_issue` / `add_comment` / `create_issue`. GitHub's `pull_pull_requests/2` uses the existing `GitHub.PullRequests` module; Linear's returns `{:ok, []}` (GitHub source control handles PRs — see Plan 6).

**Tech Stack:** Elixir, existing `IssueAdapter`/`IssueDTO`/`GitHub.PullRequests`, ExUnit with stub adapters.

**Depends on:** Plans 1–4. The remote adapters already exist: `GitHub.IssueAdapter` (`list_issues/2`, `get_issue/2`, `list_labels/1`, `list_comments/2`, `add_comment/4`, `move_issue/3`, `create_issue/2`) and `Linear.IssueAdapter` (same contract; comments unsupported).

---

## Task 1: Normalizer — `IssueDTO` → LocalStore map

**Files:**
- Create: `elixir/lib/symphony_elixir/tracker/sync/normalize.ex`
- Test: `elixir/test/symphony_elixir/tracker/sync/normalize_test.exs`

The remote adapters return `%SymphonyElixir.Tracker.IssueDTO{}` (fields: `id, identifier, title, description, priority, position, status: %{name: …}, labels: [String], assignee, creator, url, updated_at`). `LocalStore.upsert_remote_issue/2` expects the normalized map from Plan 3.

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/tracker/sync/normalize_test.exs`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.NormalizeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.Normalize

  test "maps an IssueDTO into the local-store shape" do
    dto =
      IssueDTO.build(%{
        id: "I_kwDO1",
        identifier: "507",
        title: "Title",
        description: "Body",
        priority: 2,
        position: 3,
        status: %{name: "Human Review", category: "review", position: nil, is_terminal: false},
        labels: ["bug", "p1"],
        assignee: "octocat",
        creator: "octocat",
        url: "https://github.com/o/r/issues/507",
        updated_at: "2026-06-01T12:00:00Z"
      })

    norm = Normalize.issue(dto, comments: [%{remote_id: "IC_1", body: "hi", author: "octo", remote_updated_at: ~U[2026-06-01 12:00:00Z]}])

    assert norm.remote_id == "I_kwDO1"
    assert norm.identifier == "507"
    assert norm.remote_number == 507
    assert norm.state == "Human Review"
    assert norm.assignee_id == "octocat"
    assert norm.remote_url == "https://github.com/o/r/issues/507"
    assert %DateTime{} = norm.remote_updated_at
    assert Enum.map(norm.labels, & &1.name) == ["bug", "p1"]
    assert Enum.map(norm.comments, & &1.remote_id) == ["IC_1"]
  end

  test "tolerates a missing updated_at by using now" do
    dto = IssueDTO.build(%{id: "I_2", identifier: "1", title: "t", status: %{name: "Todo"}})
    norm = Normalize.issue(dto, [])
    assert %DateTime{} = norm.remote_updated_at
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/normalize_test.exs`
Expected: FAIL — `Normalize` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/tracker/sync/normalize.ex`:

```elixir
defmodule SymphonyElixir.Tracker.Sync.Normalize do
  @moduledoc """
  Converts a remote `Tracker.IssueDTO` into the normalized map consumed by
  `Tracker.Sync.LocalStore.upsert_remote_issue/2`.
  """

  alias SymphonyElixir.Tracker.IssueDTO

  @spec issue(IssueDTO.t(), keyword()) :: map()
  def issue(%IssueDTO{} = dto, opts) when is_list(opts) do
    %{
      remote_id: dto.id || dto.identifier,
      remote_number: parse_int(dto.identifier),
      identifier: to_string(dto.identifier),
      title: dto.title,
      description: dto.description,
      state: status_name(dto.status),
      priority: dto.priority,
      assignee_id: dto.assignee,
      branch_name: nil,
      remote_url: dto.url,
      creator: dto.creator,
      position: dto.position,
      remote_updated_at: parse_dt(dto.updated_at),
      labels: Enum.map(List.wrap(dto.labels), &label/1),
      comments: Keyword.get(opts, :comments, [])
    }
  end

  defp label(name) when is_binary(name), do: %{name: name}
  defp label(%{} = label), do: Map.take(label, [:name, :color, :remote_id])

  defp status_name(%{name: name}) when is_binary(name), do: name
  defp status_name(_), do: nil

  defp parse_int(value) when is_integer(value), do: value

  defp parse_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, _rest} -> int
      :error -> nil
    end
  end

  defp parse_int(_value), do: nil

  defp parse_dt(%DateTime{} = dt), do: dt

  defp parse_dt(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _offset} -> dt
      _ -> DateTime.utc_now()
    end
  end

  defp parse_dt(_value), do: DateTime.utc_now()
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/normalize_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/normalize.ex test/symphony_elixir/tracker/sync/normalize_test.exs
git commit -m "feat(tracker): normalize remote DTOs for the local store"
```

---

## Task 2: `GitHub.SyncDriver` — pull

**Files:**
- Create: `elixir/lib/symphony_elixir/github/sync_driver.ex`
- Test: `elixir/test/symphony_elixir/github/sync_driver_test.exs`

- [ ] **Step 1: Write the failing test (with a stub adapter)**

Create `elixir/test/symphony_elixir/github/sync_driver_test.exs`:

```elixir
defmodule SymphonyElixir.GitHub.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.SyncDriver
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok,
       [
         IssueDTO.build(%{
           id: "I_1",
           identifier: "1",
           title: "Issue one",
           status: %{name: "Todo"},
           labels: ["bug"],
           updated_at: "2026-06-01T00:00:00Z"
         })
       ]}
    end

    def list_comments(_project, "1"), do: {:ok, [%{remote_id: "IC_1", body: "hi", author: "octo", remote_updated_at: ~U[2026-06-01 00:00:00Z]}]}
    def list_comments(_project, _id), do: {:ok, []}

    def move_issue(_project, _id, %{"status" => state}), do: {:ok, IssueDTO.build(%{id: "I_1", identifier: "1", title: state, status: %{name: state}})}
    def add_comment(_project, _id, _body, _attrs), do: {:ok, %{remote_id: "IC_new"}}
    def create_issue(_project, _attrs), do: {:ok, IssueDTO.build(%{id: "I_new", identifier: "9", title: "new", status: %{name: "Todo"}})}
  end

  setup do
    Application.put_env(:symphony_elixir, :github_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_sync_adapter) end)
    %{project: %Project{id: 1, slug: "mm", tracker_config: %{}}}
  end

  test "pull returns normalized issues with their comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "I_1"
    assert issue.state == "Todo"
    assert Enum.map(issue.comments, & &1.remote_id) == ["IC_1"]
    assert Enum.map(issue.labels, & &1.name) == ["bug"]
  end

  test "push of a state move calls move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "1", "state" => "Done"}}
    assert {:ok, _remote_id} = SyncDriver.push(project, entry)
  end

  test "push of a comment create calls add_comment", %{project: project} do
    entry = %OutboxEntry{entity_type: "comment", operation: "create", payload: %{"identifier" => "1", "body" => "hello"}}
    assert {:ok, "IC_new"} = SyncDriver.push(project, entry)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/sync_driver_test.exs`
Expected: FAIL — `SyncDriver` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/github/sync_driver.ex`:

```elixir
defmodule SymphonyElixir.GitHub.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for GitHub Projects. Delegates to `GitHub.IssueAdapter`
  for remote reads/writes and to `GitHub.PullRequests` for linked PRs (GitHub is
  the standard source control for every tracker — see `pull_pull_requests/2`).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  require Logger

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.{Normalize, OutboxEntry}

  @impl true
  def pull(%Project{} = project, _opts) do
    with {:ok, dtos} <- adapter().list_issues(project, []) do
      issues =
        Enum.map(dtos, fn dto ->
          comments = fetch_comments(project, dto.identifier)
          Normalize.issue(dto, comments: comments)
        end)

      {:ok, issues}
    end
  end

  @impl true
  def push(%Project{} = project, %OutboxEntry{entity_type: "state", operation: "move", payload: payload}) do
    case adapter().move_issue(project, payload["identifier"], %{"status" => payload["state"]}) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "comment", operation: "create", payload: payload}) do
    case adapter().add_comment(project, payload["identifier"], payload["body"], %{}) do
      {:ok, %{remote_id: remote_id}} -> {:ok, remote_id}
      {:ok, _other} -> {:ok, nil}
      error -> error
    end
  end

  def push(%Project{} = project, %OutboxEntry{entity_type: "issue", operation: "create", payload: payload}) do
    case adapter().create_issue(project, payload) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}) do
    {:error, {:unsupported_push, type, op}}
  end

  @impl true
  def pull_pull_requests(%Project{} = project, %IssueRecord{} = issue) do
    pull_requests_module().for_issue(project, issue)
  rescue
    error ->
      Logger.warning("PR pull failed for #{issue.identifier}: #{inspect(error)}")
      {:ok, []}
  end

  defp fetch_comments(project, identifier) do
    case adapter().list_comments(project, identifier) do
      {:ok, comments} -> comments
      {:error, _reason} -> []
    end
  end

  defp adapter, do: Application.get_env(:symphony_elixir, :github_sync_adapter, SymphonyElixir.GitHub.IssueAdapter)

  defp pull_requests_module, do: Application.get_env(:symphony_elixir, :github_pr_module, SymphonyElixir.GitHub.PullRequests)
end
```

> **Executor note:** `GitHub.PullRequests.for_issue/2` may not exist with that exact arity. Inspect `lib/symphony_elixir/github/pull_requests.ex`; if the lookup is by repo + issue number, adapt `pull_pull_requests/2` to derive `repo` from the project's `tracker_config` and the issue's `remote_number`, returning a list of `%{remote_id, number, url, title, state}` maps. The contract this plan requires is: given a project + local issue, return `{:ok, [pr_map]}`. The PR maps must match `PullRequestRecord` fields (Plan 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/github/sync_driver_test.exs`
Expected: PASS (3 tests). (PR pulling is covered indirectly; its stub returns `{:ok, []}`.)

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/github/sync_driver.ex test/symphony_elixir/github/sync_driver_test.exs
git commit -m "feat(github): add sync driver (pull/push/PRs)"
```

---

## Task 3: `Linear.SyncDriver`

**Files:**
- Create: `elixir/lib/symphony_elixir/linear/sync_driver.ex`
- Test: `elixir/test/symphony_elixir/linear/sync_driver_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/linear/sync_driver_test.exs`:

```elixir
defmodule SymphonyElixir.Linear.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Linear.SyncDriver
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok, [IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: "t", status: %{name: "Todo"}, updated_at: "2026-06-01T00:00:00Z"})]}
    end

    def move_issue(_project, _id, %{"status" => state}), do: {:ok, IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: state, status: %{name: state}})}
  end

  setup do
    Application.put_env(:symphony_elixir, :linear_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :linear_sync_adapter) end)
    %{project: %Project{id: 1, slug: "mm", tracker_config: %{}}}
  end

  test "pull normalizes issues with no comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "LIN_1"
    assert issue.comments == []
  end

  test "pull_pull_requests is empty (GitHub owns source control)", %{project: project} do
    assert {:ok, []} = SyncDriver.pull_pull_requests(project, %IssueRecord{identifier: "MM-12"})
  end

  test "push state move delegates to move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "MM-12", "state" => "Done"}}
    assert {:ok, "LIN_1"} = SyncDriver.push(project, entry)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/linear/sync_driver_test.exs`
Expected: FAIL — `SyncDriver` not available.

- [ ] **Step 3: Write the implementation**

Create `elixir/lib/symphony_elixir/linear/sync_driver.ex`:

```elixir
defmodule SymphonyElixir.Linear.SyncDriver do
  @moduledoc """
  `Tracker.Sync.Driver` for Linear. Delegates reads/writes to `Linear.IssueAdapter`.
  Linear comments are not yet exposed by the adapter, so `pull/2` mirrors issues
  without comments. Pull requests are owned by GitHub source control, so
  `pull_pull_requests/2` returns an empty list here (the engine pulls PRs via the
  GitHub driver in Plan 6's reconciler wiring).
  """

  @behaviour SymphonyElixir.Tracker.Sync.Driver

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.{Normalize, OutboxEntry}

  @impl true
  def pull(%Project{} = project, _opts) do
    with {:ok, dtos} <- adapter().list_issues(project, []) do
      {:ok, Enum.map(dtos, &Normalize.issue(&1, comments: []))}
    end
  end

  @impl true
  def push(%Project{} = project, %OutboxEntry{entity_type: "state", operation: "move", payload: payload}) do
    case adapter().move_issue(project, payload["identifier"], %{"status" => payload["state"]}) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  def push(%Project{}, %OutboxEntry{entity_type: type, operation: op}), do: {:error, {:unsupported_push, type, op}}

  @impl true
  def pull_pull_requests(%Project{}, %IssueRecord{}), do: {:ok, []}

  defp adapter, do: Application.get_env(:symphony_elixir, :linear_sync_adapter, SymphonyElixir.Linear.IssueAdapter)
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/linear/sync_driver_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/linear/sync_driver.ex test/symphony_elixir/linear/sync_driver_test.exs
git commit -m "feat(linear): add sync driver (pull/push)"
```

---

## Task 4: Engine pulls PRs after issues (GitHub for every project)

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/engine.ex` (`pull_remote/2`)
- Modify: `elixir/test/symphony_elixir/tracker/sync/engine_test.exs` (extend FakeDriver + add a case)

Per the spec, GitHub is the standard source control regardless of tracker kind, so after upserting each issue the engine pulls its PRs via a **PR driver** (always the GitHub driver) and stores them with `LocalStore.upsert_pull_requests/2`.

- [ ] **Step 1: Add a failing test**

In `engine_test.exs`, extend `FakeDriver.pull_pull_requests/2` to return a PR, and add a test:

Replace the FakeDriver's `pull_pull_requests/2` with:

```elixir
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, [%{remote_id: "PR_1", number: 7, url: "u", title: "t", state: "open"}]}
```

Add this test:

```elixir
  test "sync_project stores pull requests for pulled issues", %{project: project} do
    assert {:ok, _summary} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert Enum.map(prs, & &1.remote_id) == ["PR_1"]
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/tracker/sync/engine_test.exs`
Expected: FAIL — PRs are not yet stored (`prs == []`).

- [ ] **Step 3: Update `pull_remote/2` in `engine.ex`**

Change `sync_project/2` to thread a `:pr_driver` (defaults to the GitHub driver) and update `pull_remote`:

In `sync_project/2`, capture the pr driver:

```elixir
  def sync_project(project, opts \\ []) do
    driver = Keyword.fetch!(opts, :driver)
    pr_driver = Keyword.get(opts, :pr_driver, SymphonyElixir.GitHub.SyncDriver)
    max_attempts = Keyword.get(opts, :max_attempts, @default_max_attempts)

    mark_state(project, %{status: "syncing"})

    with {:ok, push_summary} <- push_outbox(project, driver, max_attempts),
         {:ok, pulled} <- pull_remote(project, driver, pr_driver) do
```

Replace `pull_remote/2` with `pull_remote/3`:

```elixir
  defp pull_remote(project, driver, pr_driver) do
    case driver.pull(project, []) do
      {:ok, issues} ->
        Enum.each(issues, fn remote ->
          case LocalStore.upsert_remote_issue(project, remote) do
            {:ok, issue} -> sync_pull_requests(project, issue, pr_driver)
            {:error, _reason} -> :ok
          end
        end)

        {:ok, length(issues)}

      {:error, _reason} = error ->
        error
    end
  end

  defp sync_pull_requests(project, issue, pr_driver) do
    case pr_driver.pull_pull_requests(project, issue) do
      {:ok, prs} -> LocalStore.upsert_pull_requests(issue, prs)
      {:error, _reason} -> :ok
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/tracker/sync/engine_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/tracker/sync/engine.ex test/symphony_elixir/tracker/sync/engine_test.exs
git commit -m "feat(tracker): pull linked pull requests during sync"
```

---

## Task 5: Verification

- [ ] **Step 1: Run + format + credo**

Run:
```bash
mix test test/symphony_elixir/tracker/sync/ test/symphony_elixir/github/sync_driver_test.exs test/symphony_elixir/linear/sync_driver_test.exs
mix format
mix credo lib/symphony_elixir/github/sync_driver.ex lib/symphony_elixir/linear/sync_driver.ex lib/symphony_elixir/tracker/sync/ --strict || true
```
Expected: all PASS; format clean; no new credo issues.

- [ ] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore(tracker): format sync drivers" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:** Implements the spec's per-tracker drivers (pull = list issues + comments + labels normalized; push = state move / comment create / issue create), and "GitHub is standard source control" by always pulling PRs via the GitHub driver in the engine (Task 4) and storing them per issue. Linear comments deferral matches the adapter's current `:not_supported_on_remote`.

**Placeholder scan:** None except one concrete executor note (verify `GitHub.PullRequests.for_issue/2` arity and adapt). Full driver + normalizer + test code provided.

**Type/name consistency:** `pull/2`/`push/2`/`pull_pull_requests/2` match the `Driver` behaviour (Plan 4). `Normalize.issue/2` output matches `LocalStore.upsert_remote_issue/2`'s contract (Plan 3). Outbox `{entity_type, operation}` keys (`state/move`, `comment/create`, `issue/create`) match `OutboxEntry`'s validated values (Plan 1) and the enqueue calls in Plan 6. PR maps (`remote_id, number, url, title, state`) match `PullRequestRecord` (Plan 1) and `LocalStore.upsert_pull_requests/2` (Plan 3). The engine's new `:pr_driver` option defaults to `GitHub.SyncDriver`.
