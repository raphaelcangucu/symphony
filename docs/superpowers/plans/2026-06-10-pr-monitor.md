# PR Follow-up Monitor Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools (Elixir: `mix test` from `elixir/`; frontend: `npm test` from `tracker/`).

**Goal:** A background reconciler that follows PRs of issues in wait states and automatically moves them to `Rework` (CI broken by the PR / fixable review findings), `Done` (PR merged), or keeps them in `Human Review` with a "Re-run failed jobs" suggestion — judgment by a one-shot LLM turn triggered from the orchestrator's polling cycle.

**Architecture:** New `SymphonyElixir.PullRequestMonitor` core (pure event detection + verdict→action mapping) driven by a `PullRequestMonitor.Reconciler` GenServer under `OrchestratorSupervisor` (mirrors `DevServer.Reconciler`). Event dedupe persisted in a new `pull_request_monitor_states` SQLite table. LLM classification via the existing `SymphonyElixir.CodingAgent` one-shot session plumbing. Transitions through `Tracker.IssueAdapter.dispatch/3` (local-first → outbox → GitHub), same as `PullRequestFix`.

**Tech Stack:** Elixir/Phoenix (GenServer, Ecto/SQLite), GitHub GraphQL + REST via `SymphonyElixir.GitHub.Client`, React/TypeScript tracker UI (vitest).

**Spec:** `docs/superpowers/specs/2026-06-10-pr-monitor-design.md`

---

## File map

**Create (Elixir):**

| Path | Owns |
|---|---|
| `elixir/priv/repo/migrations/20260610120000_create_pull_request_monitor_states.exs` | table |
| `elixir/lib/symphony_elixir/pull_request_monitor/monitor_state.ex` | Ecto schema + persistence context + `attach/3` for API payloads |
| `elixir/lib/symphony_elixir/pull_request_monitor/events.ex` | pure event detection + fingerprints |
| `elixir/lib/symphony_elixir/pull_request_monitor/classifier.ex` | prompt build, one-shot LLM run, strict JSON parse |
| `elixir/lib/symphony_elixir/pull_request_monitor.ex` | per-issue processing, `decide/4`, comment builders, transitions |
| `elixir/lib/symphony_elixir/pull_request_monitor/reconciler.ex` | GenServer tick loop |
| `elixir/lib/symphony_elixir/github/workflow_runs.ex` | `rerun_failed_jobs/3`, run-id parsing |
| `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller.ex` | rerun endpoint |
| `elixir/test/symphony_elixir/pull_request_monitor/*_test.exs` | tests (one per module) |
| `elixir/test/symphony_elixir/github/workflow_runs_test.exs` | tests |
| `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller_test.exs` | tests |

**Modify (Elixir):**

| Path | Change |
|---|---|
| `elixir/lib/symphony_elixir/github/pull_requests.ex` | expose `head_sha` in `parse_pr_node/1` |
| `elixir/lib/symphony_elixir/pull_request_fix.ex` | make failing-entry collection public; `build_comment/2` header option |
| `elixir/lib/symphony_elixir/project_config.ex` | `pr_monitor` section + helpers |
| `elixir/lib/symphony_elixir/config.ex` | `pr_monitor_interval_ms/0` |
| `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` | add reconciler child |
| `elixir/lib/symphony_elixir_web/router.ex` | rerun route |
| `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex` | attach `monitor` payload |
| `elixir/.env.example`, `elixir/README.md` | docs/config contract |

**Modify (frontend, `tracker/`):**

| Path | Change |
|---|---|
| `src/types/pull-request.ts` | `PullRequestMonitorInfo`, `monitor` field, rerun result type |
| `src/services/pullRequests.ts` | normalize `monitor`; `rerunFailedJobs()` |
| `src/components/issues/issue-detail/PullRequestTab.tsx` | monitor banner + Re-run failed jobs button |
| `src/services/__tests__/pullRequests.test.ts` | service tests (create if missing) |

All Elixir public `def`s in `lib/` need adjacent `@spec` (`mix specs.check`). All Elixir commands run from `elixir/`, frontend commands from `tracker/`.

---

### Task 1: `head_sha` on parsed PRs

**Files:**
- Modify: `elixir/lib/symphony_elixir/github/pull_requests.ex` (`parse_pr_node/1`, around line 397)
- Test: `elixir/test/symphony_elixir/github/pull_requests_test.exs` (existing file — add a case)

- [ ] **Step 1: Write the failing test**

In the existing `parse_pr_node` describe block add:

```elixir
test "exposes head_sha from the last commit oid" do
  node = %{
    "number" => 7,
    "commits" => %{
      "nodes" => [%{"commit" => %{"oid" => "abc123", "statusCheckRollup" => nil}}]
    }
  }

  assert %{head_sha: "abc123"} = PullRequests.parse_pr_node(node)
end

test "head_sha is nil when commits are absent" do
  assert %{head_sha: nil} = PullRequests.parse_pr_node(%{"number" => 7})
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: FAIL — `head_sha` key absent.

- [ ] **Step 3: Implement**

In `parse_pr_node/1`, add to the returned map (next to `:merged`):

```elixir
head_sha: extract_head_sha(node),
```

And add the private helper (near `extract_rollup/1`, which already digs the same path):

```elixir
defp extract_head_sha(node) do
  node
  |> get_in_safe(["commits", "nodes"])
  |> List.wrap()
  |> List.first()
  |> case do
    %{"commit" => %{"oid" => oid}} when is_binary(oid) and oid != "" -> oid
    _ -> nil
  end
end
```

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/github/pull_requests_test.exs`
Expected: PASS (all existing cases too).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_requests.ex elixir/test/symphony_elixir/github/pull_requests_test.exs
git commit -m "feat(github): expose head_sha on parsed pull requests"
```

---

### Task 2: Migration + `MonitorState` schema/context

**Files:**
- Create: `elixir/priv/repo/migrations/20260610120000_create_pull_request_monitor_states.exs`
- Create: `elixir/lib/symphony_elixir/pull_request_monitor/monitor_state.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor/monitor_state_test.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreatePullRequestMonitorStates do
  use Ecto.Migration

  def change do
    create table(:pull_request_monitor_states) do
      add(:project_slug, :string, null: false)
      add(:identifier, :string, null: false)
      add(:pr_url, :string, null: false)
      add(:last_head_sha, :string)
      add(:last_checks_fingerprint, :string)
      add(:last_review_marker, :string)
      add(:auto_rework_count, :integer, null: false, default: 0)
      add(:last_classification, :map, null: false, default: %{})
      add(:last_action, :string)
      add(:last_action_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:pull_request_monitor_states, [:project_slug, :identifier, :pr_url]))
    create(index(:pull_request_monitor_states, [:project_slug, :identifier]))
  end
end
```

Run: `mix ecto.migrate` — Expected: migration applied.

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.MonitorStateTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.PullRequestMonitor.MonitorState

  @key %{project_slug: "proj", identifier: "#42", pr_url: "https://github.com/o/r/pull/7"}

  test "get/3 returns nil when missing, upsert/4 creates then updates" do
    assert MonitorState.get(@key.project_slug, @key.identifier, @key.pr_url) == nil

    assert {:ok, row} =
             MonitorState.upsert(@key.project_slug, @key.identifier, @key.pr_url, %{
               last_head_sha: "abc",
               last_checks_fingerprint: "fp1"
             })

    assert row.auto_rework_count == 0

    assert {:ok, updated} =
             MonitorState.upsert(@key.project_slug, @key.identifier, @key.pr_url, %{
               last_checks_fingerprint: "fp2",
               auto_rework_count: 1
             })

    assert updated.id == row.id
    assert updated.last_checks_fingerprint == "fp2"
    assert MonitorState.max_rework_count(@key.project_slug, @key.identifier) == 1
  end

  test "max_rework_count/2 is 0 with no rows and max across PRs" do
    assert MonitorState.max_rework_count("proj", "#42") == 0

    {:ok, _} = MonitorState.upsert("proj", "#42", "url-a", %{auto_rework_count: 1})
    {:ok, _} = MonitorState.upsert("proj", "#42", "url-b", %{auto_rework_count: 2})

    assert MonitorState.max_rework_count("proj", "#42") == 2
  end

  test "attach/3 merges monitor info into PR maps by url" do
    {:ok, _} =
      MonitorState.upsert("proj", "#42", "url-a", %{
        last_action: "moved_to_rework",
        last_classification: %{"summary" => "test failed in changed file"},
        auto_rework_count: 1,
        last_action_at: DateTime.utc_now()
      })

    [with_monitor, without] =
      MonitorState.attach([%{url: "url-a"}, %{url: "url-b"}], "proj", "#42")

    assert with_monitor.monitor.last_action == "moved_to_rework"
    assert with_monitor.monitor.summary == "test failed in changed file"
    assert with_monitor.monitor.auto_rework_count == 1
    assert without.monitor == nil
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/pull_request_monitor/monitor_state_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 4: Implement**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.MonitorState do
  @moduledoc """
  Per issue+PR bookkeeping for the PR follow-up monitor: which head SHA /
  checks fingerprint / review marker was already evaluated, how many automatic
  Rework transitions happened, and what the monitor last did (for the UI).
  """

  use Ecto.Schema

  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}

  schema "pull_request_monitor_states" do
    field(:project_slug, :string)
    field(:identifier, :string)
    field(:pr_url, :string)
    field(:last_head_sha, :string)
    field(:last_checks_fingerprint, :string)
    field(:last_review_marker, :string)
    field(:auto_rework_count, :integer, default: 0)
    field(:last_classification, :map, default: %{})
    field(:last_action, :string)
    field(:last_action_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @updatable ~w(last_head_sha last_checks_fingerprint last_review_marker auto_rework_count last_classification last_action last_action_at)a

  @spec get(String.t(), String.t(), String.t()) :: t() | nil
  def get(project_slug, identifier, pr_url) do
    Repo.get_by(__MODULE__,
      project_slug: project_slug,
      identifier: identifier,
      pr_url: pr_url
    )
  end

  @spec upsert(String.t(), String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def upsert(project_slug, identifier, pr_url, attrs) when is_map(attrs) do
    base =
      get(project_slug, identifier, pr_url) ||
        %__MODULE__{project_slug: project_slug, identifier: identifier, pr_url: pr_url}

    base
    |> cast(attrs, @updatable)
    |> Repo.insert_or_update()
  end

  @spec max_rework_count(String.t(), String.t()) :: non_neg_integer()
  def max_rework_count(project_slug, identifier) do
    from(s in __MODULE__,
      where: s.project_slug == ^project_slug and s.identifier == ^identifier,
      select: max(s.auto_rework_count)
    )
    |> Repo.one()
    |> case do
      count when is_integer(count) -> count
      _ -> 0
    end
  end

  @spec attach([map()], String.t(), String.t()) :: [map()]
  def attach(prs, project_slug, identifier) when is_list(prs) do
    rows =
      from(s in __MODULE__,
        where: s.project_slug == ^project_slug and s.identifier == ^identifier
      )
      |> Repo.all()
      |> Map.new(&{&1.pr_url, &1})

    Enum.map(prs, fn pr ->
      Map.put(pr, :monitor, monitor_payload(Map.get(rows, Map.get(pr, :url))))
    end)
  end

  defp monitor_payload(nil), do: nil

  defp monitor_payload(%__MODULE__{} = row) do
    %{
      last_action: row.last_action,
      summary: Map.get(row.last_classification || %{}, "summary"),
      auto_rework_count: row.auto_rework_count,
      last_action_at: row.last_action_at
    }
  end
end
```

- [ ] **Step 5: Run tests to verify pass**

Run: `mix test test/symphony_elixir/pull_request_monitor/monitor_state_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260610120000_create_pull_request_monitor_states.exs \
        elixir/lib/symphony_elixir/pull_request_monitor/monitor_state.ex \
        elixir/test/symphony_elixir/pull_request_monitor/monitor_state_test.exs
git commit -m "feat(pr-monitor): persist per-PR monitor state"
```

---

### Task 3: Config — env interval + per-project `pr_monitor` section

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Modify: `elixir/.env.example`
- Test: `elixir/test/symphony_elixir/project_config_test.exs` (existing — add cases), `elixir/test/symphony_elixir/config_test.exs` (existing — add case)

- [ ] **Step 1: Write the failing tests**

In `project_config_test.exs` (follow the file's existing fixture helpers for building a project with `workflow_markdown`):

```elixir
describe "pr_monitor" do
  test "disabled by default" do
    config = ProjectConfig.resolve(project_with_front_matter(%{}))

    refute ProjectConfig.pr_monitor_enabled?(config)
    assert ProjectConfig.pr_monitor_max_auto_rework(config) == 2
    assert ProjectConfig.pr_monitor_done_on_merge?(config)
  end

  test "reads the pr_monitor front-matter section" do
    config =
      ProjectConfig.resolve(
        project_with_front_matter(%{
          "pr_monitor" => %{"enabled" => true, "max_auto_rework" => 3, "done_on_merge" => false}
        })
      )

    assert ProjectConfig.pr_monitor_enabled?(config)
    assert ProjectConfig.pr_monitor_max_auto_rework(config) == 3
    refute ProjectConfig.pr_monitor_done_on_merge?(config)
  end
end
```

In `config_test.exs`:

```elixir
test "pr_monitor_interval_ms falls back to poll interval and honors env" do
  System.delete_env("SYMPHONY_PR_MONITOR_INTERVAL_MS")
  assert Config.pr_monitor_interval_ms() == Config.poll_interval_ms()

  System.put_env("SYMPHONY_PR_MONITOR_INTERVAL_MS", "15000")
  assert Config.pr_monitor_interval_ms() == 15_000
after
  System.delete_env("SYMPHONY_PR_MONITOR_INTERVAL_MS")
end
```

(If `config_test.exs` uses a different env-stub mechanism — e.g. an injectable env reader — follow that file's existing pattern instead of `System.put_env`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/symphony_elixir/project_config_test.exs test/symphony_elixir/config_test.exs`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement**

`config.ex` — follow the existing env accessor pattern in that module (most read via `SymphonyElixir.InstanceConfig`/`System.get_env` with integer parsing; mirror `poll_interval_ms/0`'s style):

```elixir
@spec pr_monitor_interval_ms() :: pos_integer()
def pr_monitor_interval_ms do
  case System.get_env("SYMPHONY_PR_MONITOR_INTERVAL_MS") do
    value when is_binary(value) ->
      case Integer.parse(value) do
        {ms, ""} when ms > 0 -> ms
        _ -> poll_interval_ms()
      end

    _ ->
      poll_interval_ms()
  end
end
```

`project_config.ex`:

1. Add `:pr_monitor` to the `defstruct` list (after `:dev_server`).
2. In `resolve/1`, add `pr_monitor: front_matter_section(project_front_matter, "pr_monitor"),` (same as `dev_server:`).
3. Add helpers:

```elixir
@spec pr_monitor_enabled?(t()) :: boolean()
def pr_monitor_enabled?(%__MODULE__{pr_monitor: %{"enabled" => true}}), do: true
def pr_monitor_enabled?(%__MODULE__{}), do: false

@spec pr_monitor_max_auto_rework(t()) :: pos_integer()
def pr_monitor_max_auto_rework(%__MODULE__{pr_monitor: %{"max_auto_rework" => max}})
    when is_integer(max) and max > 0,
    do: max

def pr_monitor_max_auto_rework(%__MODULE__{}), do: 2

@spec pr_monitor_done_on_merge?(t()) :: boolean()
def pr_monitor_done_on_merge?(%__MODULE__{pr_monitor: %{"done_on_merge" => false}}), do: false
def pr_monitor_done_on_merge?(%__MODULE__{}), do: true
```

`.env.example` — add:

```bash
# PR follow-up monitor tick interval (defaults to SYMPHONY_POLL_INTERVAL_MS)
# SYMPHONY_PR_MONITOR_INTERVAL_MS=60000
```

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/project_config_test.exs test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/lib/symphony_elixir/project_config.ex \
        elixir/.env.example elixir/test/symphony_elixir/project_config_test.exs \
        elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(pr-monitor): pr_monitor project config and tick interval"
```

---

### Task 4: Pure event detection (`Events`)

**Files:**
- Create: `elixir/lib/symphony_elixir/pull_request_monitor/events.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor/events_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.EventsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Events
  alias SymphonyElixir.PullRequestMonitor.MonitorState

  defp pr(overrides) do
    Map.merge(
      %{
        url: "https://github.com/o/r/pull/7",
        state: "open",
        merged: false,
        author: "codex-bot",
        head_sha: "abc",
        checks_state: nil,
        pipelines: [],
        conversation: []
      },
      overrides
    )
  end

  defp failing_pipeline do
    [%{name: "CI", url: "https://github.com/o/r/actions/runs/99", jobs: [
      %{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}
    ]}]
  end

  test "merged PR yields :merged unless already done" do
    assert Events.detect(pr(%{merged: true, state: "merged"}), nil) == :merged

    row = %MonitorState{last_action: "moved_to_done"}
    assert Events.detect(pr(%{merged: true, state: "merged"}), row) == :none
  end

  test "concluded failing checks yield {:ci_failure, fingerprint} once per fingerprint" do
    failing = pr(%{checks_state: "FAILURE", pipelines: failing_pipeline()})

    assert {:ci_failure, fp} = Events.detect(failing, nil)
    assert is_binary(fp)

    seen = %MonitorState{last_checks_fingerprint: fp}
    assert Events.detect(failing, seen) == :none
  end

  test "in-progress jobs suppress ci_failure" do
    running = [%{name: "CI", url: nil, jobs: [
      %{name: "a", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1},
      %{name: "b", status: "IN_PROGRESS", conclusion: nil, url: nil, job_id: 2}
    ]}]

    assert Events.detect(pr(%{checks_state: "FAILURE", pipelines: running}), nil) == :none
  end

  test "new non-author review yields {:review_findings, marker}; symphony headers and author excluded" do
    convo = [
      %{author: "codex-bot", body: "self note", kind: "comment", review_state: nil, created_at: "2026-06-10T10:00:00Z"},
      %{author: "review-bot", body: "## CI failure — automated fix requested\nfoo", kind: "comment", review_state: nil, created_at: "2026-06-10T10:05:00Z"},
      %{author: "review-bot", body: "Blocking: SQL injection in foo.ex", kind: "review", review_state: "CHANGES_REQUESTED", created_at: "2026-06-10T11:00:00Z"}
    ]

    assert {:review_findings, "2026-06-10T11:00:00Z"} = Events.detect(pr(%{conversation: convo}), nil)

    seen = %MonitorState{last_review_marker: "2026-06-10T11:00:00Z"}
    assert Events.detect(pr(%{conversation: convo}), seen) == :none
  end

  test "merged wins over pending review findings" do
    convo = [%{author: "x", body: "y", kind: "review", review_state: nil, created_at: "2026-06-10T11:00:00Z"}]
    assert Events.detect(pr(%{merged: true, state: "merged", conversation: convo}), nil) == :merged
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/pull_request_monitor/events_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.Events do
  @moduledoc """
  Pure detection of actionable PR events against the persisted monitor state.

  Order matters: merged > ci_failure > review_findings > none. Each event is
  identified by a stable fingerprint/marker so it is consumed exactly once.
  """

  alias SymphonyElixir.PullRequestMonitor.MonitorState

  @type event ::
          :merged
          | {:ci_failure, String.t()}
          | {:review_findings, String.t()}
          | :none

  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)
  @failing_rollups ~w(FAILURE ERROR)
  @symphony_headers [
    "## CI failure",
    "## Review feedback",
    "## PR merged",
    "## Codex Workpad",
    "## Evidence"
  ]

  @spec detect(map(), MonitorState.t() | nil) :: event()
  def detect(pr, row) when is_map(pr) do
    cond do
      merged_event?(pr, row) -> :merged
      true -> detect_ci_or_review(pr, row)
    end
  end

  @spec checks_fingerprint(map()) :: String.t() | nil
  def checks_fingerprint(pr) when is_map(pr) do
    case failing_jobs(pr) do
      [] ->
        nil

      jobs ->
        payload =
          [Map.get(pr, :head_sha) || "" | Enum.sort(Enum.map(jobs, &"#{&1[:name]}:#{&1[:conclusion]}"))]
          |> Enum.join("|")

        :crypto.hash(:sha256, payload) |> Base.encode16(case: :lower)
    end
  end

  @spec failing_jobs(map()) :: [map()]
  def failing_jobs(pr) when is_map(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(&Map.get(&1, :jobs, []))
    |> Enum.filter(&failing_job?/1)
  end

  defp detect_ci_or_review(pr, row) do
    case ci_failure_event(pr, row) do
      {:ci_failure, _fp} = event -> event
      :none -> review_event(pr, row)
    end
  end

  defp merged_event?(pr, row) do
    Map.get(pr, :merged) == true and last_action(row) != "moved_to_done"
  end

  defp ci_failure_event(pr, row) do
    with true <- Map.get(pr, :state) in ["open", "draft"],
         true <- rollup_failing?(pr),
         false <- any_job_running?(pr),
         fp when is_binary(fp) <- checks_fingerprint(pr),
         true <- fp != last_fingerprint(row) do
      {:ci_failure, fp}
    else
      _ -> :none
    end
  end

  defp review_event(pr, row) do
    pr
    |> Map.get(:conversation, [])
    |> Enum.filter(&candidate_review_entry?(&1, Map.get(pr, :author)))
    |> Enum.map(& &1[:created_at])
    |> Enum.reject(&is_nil/1)
    |> Enum.max(fn -> nil end)
    |> case do
      nil -> :none
      marker -> if newer?(marker, last_marker(row)), do: {:review_findings, marker}, else: :none
    end
  end

  defp candidate_review_entry?(entry, pr_author) do
    author = entry[:author]
    body = entry[:body] || ""

    author != nil and author != pr_author and
      not Enum.any?(@symphony_headers, &String.starts_with?(body, &1))
  end

  defp newer?(marker, nil), do: is_binary(marker)
  defp newer?(marker, last), do: is_binary(marker) and marker > last

  defp rollup_failing?(pr) do
    rollup = pr |> Map.get(:checks_state) |> to_string() |> String.upcase()
    rollup in @failing_rollups or failing_jobs(pr) != []
  end

  defp any_job_running?(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(&Map.get(&1, :jobs, []))
    |> Enum.any?(fn job ->
      String.upcase(to_string(job[:status] || "")) in ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"]
    end)
  end

  defp failing_job?(job) do
    String.upcase(to_string(job[:conclusion] || "")) in @failure_conclusions
  end

  defp last_action(nil), do: nil
  defp last_action(%MonitorState{last_action: action}), do: action

  defp last_fingerprint(nil), do: nil
  defp last_fingerprint(%MonitorState{last_checks_fingerprint: fp}), do: fp

  defp last_marker(nil), do: nil
  defp last_marker(%MonitorState{last_review_marker: marker}), do: marker
end
```

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/pull_request_monitor/events_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor/events.ex \
        elixir/test/symphony_elixir/pull_request_monitor/events_test.exs
git commit -m "feat(pr-monitor): pure PR event detection with fingerprints"
```

---

### Task 5: LLM classifier

**Files:**
- Create: `elixir/lib/symphony_elixir/pull_request_monitor/classifier.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor/classifier_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.ClassifierTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Classifier

  @ci_context %{
    issue: %{identifier: "#42", title: "Add login", description: "desc"},
    pr: %{number: 7, title: "feat: login", head_ref: "codex/42-login", base_ref: "main", changed_files: ["lib/login.ex"]},
    failing_jobs: [%{name: "test", excerpt: "assertion failed in login_test.exs"}]
  }

  test "parse_verdict accepts the last fenced JSON block" do
    reply = """
    Some reasoning here.

    ```json
    {"kind": "ci_failure", "verdict": "pr_caused", "confidence": 0.9, "summary": "login test broke"}
    ```
    """

    assert {:ok, verdict} = Classifier.parse_verdict(reply)
    assert verdict["verdict"] == "pr_caused"
  end

  test "parse_verdict rejects malformed output" do
    assert {:error, _} = Classifier.parse_verdict("no json here")
    assert {:error, _} = Classifier.parse_verdict("```json\n{\"verdict\": \"sideways\"}\n```")
  end

  test "low-confidence actionable verdicts are downgraded to needs_human" do
    runner = fn _prompt, _opts ->
      {:ok, ~s(```json\n{"kind":"ci_failure","verdict":"pr_caused","confidence":0.3,"summary":"unsure"}\n```)}
    end

    assert {:ok, %{"verdict" => "needs_human"}} =
             Classifier.classify(:ci_failure, @ci_context, runner: runner)
  end

  test "runner errors fall back to needs_human" do
    runner = fn _prompt, _opts -> {:error, :timeout} end

    assert {:ok, %{"verdict" => "needs_human", "summary" => _}} =
             Classifier.classify(:ci_failure, @ci_context, runner: runner)
  end

  test "build_prompt embeds logs for ci and review body for reviews" do
    ci_prompt = Classifier.build_prompt(:ci_failure, @ci_context)
    assert ci_prompt =~ "assertion failed in login_test.exs"
    assert ci_prompt =~ "pr_caused"

    review_context = Map.put(@ci_context, :review, %{author: "bot", body: "Blocking: nil check missing", state: "CHANGES_REQUESTED"})
    review_prompt = Classifier.build_prompt(:review_findings, review_context)
    assert review_prompt =~ "Blocking: nil check missing"
    assert review_prompt =~ "fixable_by_agent"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/pull_request_monitor/classifier_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.Classifier do
  @moduledoc """
  One-shot LLM judgment for PR monitor events.

  Runs a single read-only agent turn (no dynamic tools, scratch workspace) and
  parses a strict JSON verdict. Every failure path degrades to `needs_human`
  so the monitor never moves an issue to Rework on uncertain output.
  """

  alias SymphonyElixir.CodingAgent
  alias SymphonyElixir.Config

  require Logger

  @confidence_floor 0.6
  @actionable_verdicts ~w(pr_caused fixable_by_agent)
  @valid_verdicts ~w(pr_caused unrelated fixable_by_agent needs_human)
  @fallback %{
    "kind" => "unknown",
    "verdict" => "needs_human",
    "confidence" => 0.0,
    "summary" => "Automatic classification unavailable; defaulting to human review."
  }

  @type verdict :: %{String.t() => term()}

  @spec classify(:ci_failure | :review_findings, map(), keyword()) :: {:ok, verdict()}
  def classify(kind, context, opts \\ []) when is_map(context) do
    runner = Keyword.get(opts, :runner, &default_runner/2)
    prompt = build_prompt(kind, context)

    with {:ok, reply} <- safe_run(runner, prompt, opts),
         {:ok, verdict} <- parse_verdict(reply) do
      {:ok, apply_confidence_floor(verdict)}
    else
      {:error, reason} ->
        Logger.debug("PR monitor classification fell back to needs_human reason=#{inspect(reason)}")
        {:ok, @fallback}
    end
  end

  @spec build_prompt(:ci_failure | :review_findings, map()) :: String.t()
  def build_prompt(kind, context) do
    """
    You are a CI/review triage judge for an automated coding agent. Answer with
    your reasoning followed by EXACTLY ONE fenced JSON block:

    ```json
    {"kind": "ci_failure" | "review", "verdict": "...", "confidence": 0.0-1.0, "summary": "1-2 sentences"}
    ```

    Verdict meanings:
    - "pr_caused": the CI failure happens in code/tests touched or directly exercised by this PR's changes.
    - "unrelated": flaky/timeout/infra errors, failures in untouched areas, or pre-existing breakage.
    - "fixable_by_agent": blocking review findings with a clear mechanical fix needing no human decisions.
    - "needs_human": anything requiring human judgment, credentials, or product decisions.

    ## Issue
    #{issue_section(context)}

    ## Pull request
    #{pr_section(context)}

    #{detail_section(kind, context)}
    """
    |> String.trim()
  end

  @spec parse_verdict(String.t()) :: {:ok, verdict()} | {:error, term()}
  def parse_verdict(reply) when is_binary(reply) do
    with [_ | _] = blocks <- Regex.scan(~r/```json\s*(\{.*?\})\s*```/s, reply, capture: :all_but_first),
         [json] <- List.last(blocks),
         {:ok, %{"verdict" => verdict} = decoded} <- Jason.decode(json),
         true <- verdict in @valid_verdicts do
      {:ok, decoded}
    else
      _ -> {:error, :invalid_verdict}
    end
  end

  defp apply_confidence_floor(%{"verdict" => verdict} = decoded) when verdict in @actionable_verdicts do
    case decoded["confidence"] do
      confidence when is_number(confidence) and confidence >= @confidence_floor -> decoded
      _ -> Map.merge(decoded, %{"verdict" => "needs_human", "summary" => low_confidence_summary(decoded)})
    end
  end

  defp apply_confidence_floor(decoded), do: decoded

  defp low_confidence_summary(decoded) do
    "Low-confidence classification (#{inspect(decoded["confidence"])}): #{decoded["summary"]}"
  end

  defp safe_run(runner, prompt, opts) do
    runner.(prompt, opts)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp default_runner(prompt, opts) do
    workspace = scratch_workspace()

    with :ok <- File.mkdir_p(workspace),
         {:ok, session} <- CodingAgent.start_session(workspace, nil, dynamic_tools: [], tool_executor: nil) do
      try do
        issue = %{identifier: "pr-monitor", title: "PR monitor classification"}

        case CodingAgent.run_turn(session, prompt, issue, Keyword.put(opts, :turn_timeout_ms, 120_000)) do
          {:ok, result} -> {:ok, Map.get(result, :assistant_message) || Map.get(result, "assistant_message") || ""}
          {:error, reason} -> {:error, reason}
        end
      after
        CodingAgent.stop_session(session, nil)
      end
    end
  end

  defp scratch_workspace do
    Path.join([Config.workspace_root(), "_pr_monitor", "classifier"])
  end

  defp issue_section(%{issue: issue}) do
    "Identifier: #{issue[:identifier]}\nTitle: #{issue[:title]}\nDescription: #{truncate(issue[:description], 2_000)}"
  end

  defp issue_section(_context), do: "(unknown issue)"

  defp pr_section(%{pr: pr}) do
    files = pr |> Map.get(:changed_files, []) |> Enum.take(50) |> Enum.join("\n- ")

    "##{pr[:number]} — #{pr[:title]}\nBranch: #{pr[:head_ref]} -> #{pr[:base_ref]}\nChanged files:\n- #{files}"
  end

  defp pr_section(_context), do: "(unknown PR)"

  defp detail_section(:ci_failure, %{failing_jobs: jobs}) do
    sections =
      Enum.map_join(jobs, "\n\n", fn job ->
        "### #{job[:name]}\n```log\n#{truncate(job[:excerpt] || "(log unavailable)", 8_192)}\n```"
      end)

    "## Failing CI jobs\n#{sections}"
  end

  defp detail_section(:review_findings, %{review: review}) do
    "## Review findings (state: #{review[:state]}, author: #{review[:author]})\n#{truncate(review[:body], 8_192)}"
  end

  defp detail_section(_kind, _context), do: ""

  defp truncate(nil, _max), do: ""
  defp truncate(text, max) when is_binary(text), do: String.slice(text, 0, max)
end
```

Note: confirm `Config.workspace_root/0` is the actual accessor name in `SymphonyElixir.Config`; if it differs (e.g. `workspaces_root/0`), use the existing one.

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/pull_request_monitor/classifier_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor/classifier.ex \
        elixir/test/symphony_elixir/pull_request_monitor/classifier_test.exs
git commit -m "feat(pr-monitor): one-shot LLM classifier with conservative fallback"
```

---

### Task 6: `PullRequestFix` reuse hooks (public entries + header option)

**Files:**
- Modify: `elixir/lib/symphony_elixir/pull_request_fix.ex`
- Test: `elixir/test/symphony_elixir/pull_request_fix_test.exs` (existing — add cases)

- [ ] **Step 1: Write the failing test**

```elixir
test "failing_entries/2 collects failing jobs with log excerpts" do
  pr = %{number: 7, title: "t", url: "u", pipelines: [%{name: "CI", url: nil, jobs: [
    %{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}
  ]}]}

  entries = PullRequestFix.failing_entries("o/r", [pr], check_logs: fn _repo, _id -> {:ok, "boom"} end)

  assert [%{job: %{name: "test"}, excerpt: "boom"}] = entries
end

test "build_comment/2 accepts a custom header" do
  entries = [%{pr: %{number: 7, title: "t", url: "u"}, job: %{name: "test", conclusion: "FAILURE", url: nil}, excerpt: "boom"}]

  comment = PullRequestFix.build_comment(entries, header: "## CI failure — automated fix requested (attempt 1/2)\n\n")

  assert String.starts_with?(comment, "## CI failure — automated fix requested (attempt 1/2)")
  assert comment =~ "boom"
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/pull_request_fix_test.exs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `pull_request_fix.ex`:

1. New public function (delegating to the existing private helpers, with an injectable log fetcher):

```elixir
@spec failing_entries(String.t(), [map()], keyword()) :: [map()]
def failing_entries(repo, prs, opts \\ []) when is_binary(repo) and is_list(prs) do
  check_logs = Keyword.get(opts, :check_logs, &default_check_logs/2)

  prs
  |> collect_failing()
  |> Enum.map(fn entry -> Map.put(entry, :excerpt, excerpt(check_logs, repo, entry.job)) end)
end

defp default_check_logs(repo, job_id), do: CheckLogs.failing_job_excerpt(repo, job_id)

defp excerpt(check_logs, repo, %{job_id: id}) when is_integer(id) and id > 0 do
  case check_logs.(repo, id) do
    {:ok, text} -> text
    {:error, _reason} -> nil
  end
end

defp excerpt(_check_logs, _repo, _job), do: nil
```

2. Replace the body of the private `enrich_with_logs/2` call inside `request_fix/2` with `failing_entries(repo, prs)` filtered to the already-collected jobs (simplest: change `request_fix/2` to use `failing_entries/3` and `ensure_present/1` on the result; keep `@max_jobs` cap inside `collect_failing/1` unchanged).

3. Add the header option:

```elixir
@spec build_comment([map()], keyword()) :: String.t()
def build_comment(entries, opts \\ []) when is_list(entries) do
  prs = entries |> Enum.map(& &1.pr) |> Enum.uniq_by(& &1.number)

  sections =
    Enum.map(prs, fn pr ->
      pr_entries = Enum.filter(entries, &(&1.pr.number == pr.number))
      pr_section(pr, pr_entries)
    end)

  Keyword.get(opts, :header, header()) <> Enum.join(sections, "\n")
end
```

(The existing `build_comment/1` callers keep working — `opts` defaults to `[]`.)

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/pull_request_fix_test.exs`
Expected: PASS (existing cases included).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_fix.ex elixir/test/symphony_elixir/pull_request_fix_test.exs
git commit -m "refactor(pr-fix): expose failing entries and custom comment header for reuse"
```

---

### Task 7: Core `PullRequestMonitor` (decide + process + comments)

**Files:**
- Create: `elixir/lib/symphony_elixir/pull_request_monitor.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor/pull_request_monitor_test.exs`

- [ ] **Step 1: Write the failing tests for `decide/4` (pure, table-driven)**

```elixir
defmodule SymphonyElixir.PullRequestMonitorTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.PullRequestMonitor

  describe "decide/4" do
    test "verdict table" do
      assert PullRequestMonitor.decide(:merged, nil, 0, 2) == :move_done
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 1, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:ci_failure, "unrelated", 0, 2) == {:stay, :unrelated}
      assert PullRequestMonitor.decide(:ci_failure, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:review_findings, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "unrelated", 0, 2) == {:stay, :needs_human}
    end
  end
end
```

- [ ] **Step 2: Run to verify fail, implement `decide/4` skeleton, verify pass**

Run: `mix test test/symphony_elixir/pull_request_monitor/pull_request_monitor_test.exs`

```elixir
defmodule SymphonyElixir.PullRequestMonitor do
  @moduledoc """
  PR follow-up monitor core: detects PR events for wait-state issues, asks the
  classifier for a verdict, and applies the resulting transition/comment.
  See docs/superpowers/specs/2026-06-10-pr-monitor-design.md.
  """

  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PullRequestFix
  alias SymphonyElixir.PullRequestMonitor.{Classifier, Events, MonitorState}
  alias SymphonyElixir.Tracker.IssueAdapter

  require Logger

  @rework_state "Rework"
  @done_state "Done"

  @type action :: :move_done | :move_rework | {:stay, :limit_reached | :unrelated | :needs_human}

  @spec decide(:merged | :ci_failure | :review_findings, String.t() | nil, non_neg_integer(), pos_integer()) :: action()
  def decide(:merged, _verdict, _count, _max), do: :move_done
  def decide(:ci_failure, "pr_caused", count, max) when count < max, do: :move_rework
  def decide(:ci_failure, "pr_caused", _count, _max), do: {:stay, :limit_reached}
  def decide(:ci_failure, "unrelated", _count, _max), do: {:stay, :unrelated}
  def decide(:ci_failure, _verdict, _count, _max), do: {:stay, :needs_human}
  def decide(:review_findings, "fixable_by_agent", count, max) when count < max, do: :move_rework
  def decide(:review_findings, "fixable_by_agent", _count, _max), do: {:stay, :limit_reached}
  def decide(:review_findings, _verdict, _count, _max), do: {:stay, :needs_human}
end
```

Expected: PASS. Commit:

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor.ex \
        elixir/test/symphony_elixir/pull_request_monitor/pull_request_monitor_test.exs
git commit -m "feat(pr-monitor): verdict-to-action decision table"
```

- [ ] **Step 3: Write the failing tests for `process_issue/3`**

Add to the same test file (the issue fixture must exist in the local tracker DB in a wait state — use the project/issue factory helpers already used by `dev_server` or `local_tracker` tests; the snippet below assumes `insert_project/1` + `insert_issue/2` style helpers, adapt to the real ones):

```elixir
describe "process_issue/3" do
  setup do
    project = insert_project(%{slug: "proj", tracker_kind: "github", tracker_config: %{"repo" => "o/r"}})
    issue = insert_issue(project, %{identifier: "#42", state: "Human Review"})
    %{project: project, issue: issue}
  end

  defp merged_pr, do: %{number: 7, url: "u7", title: "t", state: "merged", merged: true, author: "bot", head_sha: "abc", checks_state: nil, pipelines: [], conversation: []}

  defp failing_pr do
    %{number: 7, url: "u7", title: "t", state: "open", merged: false, author: "bot", head_sha: "abc",
      checks_state: "FAILURE",
      pipelines: [%{name: "CI", url: "https://github.com/o/r/actions/runs/99",
        jobs: [%{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}]}],
      conversation: []}
  end

  defp opts(overrides) do
    Keyword.merge(
      [
        pull_request_reader: fn _project, _identifier, _opts -> {:ok, [merged_pr()]} end,
        classifier: fn _kind, _context, _opts -> {:ok, %{"verdict" => "needs_human", "summary" => "s"}} end,
        check_logs: fn _repo, _id -> {:ok, "boom"} end,
        changed_files: fn _repo, _number -> ["lib/login.ex"]} end,
        issue_dispatch: fn _project, _fun, _args -> {:ok, %{}} end
      ],
      overrides
    )
  end

  test "merged PR moves issue to Done and records action", %{project: project, issue: issue} do
    calls = start_supervised!({Agent, fn -> [] end})
    dispatch = fn _p, fun, args -> Agent.update(calls, &[{fun, args} | &1]); {:ok, %{}} end

    assert :ok = PullRequestMonitor.process_issue(project, issue, opts(issue_dispatch: dispatch))

    recorded = Agent.get(calls, &Enum.reverse/1)
    assert [{:add_comment, _}, {:move_issue, [_, %{"status" => "Done"}]}] = recorded
    assert %{last_action: "moved_to_done"} = MonitorState.get("proj", "#42", "u7")
  end

  test "pr_caused CI failure moves to Rework and increments the counter", %{project: project, issue: issue} do
    calls = start_supervised!({Agent, fn -> [] end})
    dispatch = fn _p, fun, args -> Agent.update(calls, &[{fun, args} | &1]); {:ok, %{}} end

    o = opts(
      pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
      classifier: fn :ci_failure, _ctx, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "broke login"}} end,
      issue_dispatch: dispatch
    )

    assert :ok = PullRequestMonitor.process_issue(project, issue, o)

    assert [{:add_comment, _}, {:move_issue, [_, %{"status" => "Rework"}]}] = Agent.get(calls, &Enum.reverse/1)
    assert %{auto_rework_count: 1, last_action: "moved_to_rework"} = MonitorState.get("proj", "#42", "u7")
  end

  test "rework limit keeps issue and records limit_reached", %{project: project, issue: issue} do
    {:ok, _} = MonitorState.upsert("proj", "#42", "u7", %{auto_rework_count: 2})
    calls = start_supervised!({Agent, fn -> [] end})
    dispatch = fn _p, fun, args -> Agent.update(calls, &[{fun, args} | &1]); {:ok, %{}} end

    o = opts(
      pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
      classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "s"}} end,
      issue_dispatch: dispatch
    )

    assert :ok = PullRequestMonitor.process_issue(project, issue, o)

    assert [{:add_comment, _}] = Agent.get(calls, &Enum.reverse/1)
    assert %{last_action: "limit_reached"} = MonitorState.get("proj", "#42", "u7")
  end

  test "unrelated failure stays with kept_human_review action", %{project: project, issue: issue} do
    o = opts(
      pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
      classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "unrelated", "summary" => "flaky infra"}} end
    )

    assert :ok = PullRequestMonitor.process_issue(project, issue, o)
    assert %{last_action: "kept_human_review"} = MonitorState.get("proj", "#42", "u7")
  end

  test "same fingerprint is not reprocessed", %{project: project, issue: issue} do
    count = start_supervised!({Agent, fn -> 0 end})

    o = opts(
      pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
      classifier: fn _k, _c, _o -> Agent.update(count, &(&1 + 1)); {:ok, %{"verdict" => "unrelated", "summary" => "s"}} end
    )

    assert :ok = PullRequestMonitor.process_issue(project, issue, o)
    assert :ok = PullRequestMonitor.process_issue(project, issue, o)
    assert Agent.get(count, & &1) == 1
  end

  test "issue that left the wait state is not moved", %{project: project, issue: issue} do
    # Move the issue out of the wait state after PR fetch by mutating the DB row first.
    move_issue_to_state(issue, "Done")
    calls = start_supervised!({Agent, fn -> [] end})
    dispatch = fn _p, fun, args -> Agent.update(calls, &[{fun, args} | &1]); {:ok, %{}} end

    o = opts(
      pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
      classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "s"}} end,
      issue_dispatch: dispatch
    )

    assert :ok = PullRequestMonitor.process_issue(project, issue, o)
    assert Agent.get(calls, & &1) == []
  end
end
```

(`move_issue_to_state/2` = whatever the local tracker test helpers use to set an issue's state, e.g. `Context.move_issue/3`.)

- [ ] **Step 4: Run to verify fail**

Run: `mix test test/symphony_elixir/pull_request_monitor/pull_request_monitor_test.exs`
Expected: FAIL — `process_issue/3` undefined.

- [ ] **Step 5: Implement `process_issue/3` + comments**

Add to `pull_request_monitor.ex`:

```elixir
@spec process_issue(Project.t(), map(), keyword()) :: :ok
def process_issue(%Project{} = project, issue, opts \\ []) do
  identifier = Map.get(issue, :identifier) || Map.get(issue, "identifier")
  config = Keyword.get_lazy(opts, :config, fn -> ProjectConfig.resolve(project) end)
  reader = Keyword.get(opts, :pull_request_reader, &default_pull_request_reader/3)

  with true <- ProjectConfig.pr_monitor_enabled?(config),
       {:ok, repo} <- PullRequests.resolve_repo(project),
       {:ok, prs} <- reader.(project, identifier, opts) do
    Enum.each(prs, &process_pr(project, config, repo, identifier, &1, opts))
  else
    false -> :ok
    {:error, reason} ->
      Logger.debug("PR monitor skipped issue=#{identifier} reason=#{inspect(reason)}")
  end

  :ok
end

defp default_pull_request_reader(project, identifier, _opts) do
  PullRequests.for_project_issue(project, identifier)
end

defp process_pr(project, config, repo, identifier, pr, opts) do
  pr_url = Map.get(pr, :url)

  if is_binary(pr_url) do
    row = MonitorState.get(project.slug, identifier, pr_url)

    case Events.detect(pr, row) do
      :none -> :ok
      event -> handle_event(event, project, config, repo, identifier, pr, opts)
    end
  end
end

defp handle_event(:merged, project, config, _repo, identifier, pr, opts) do
  if ProjectConfig.pr_monitor_done_on_merge?(config) do
    apply_transition(project, config, identifier, pr, :move_done, merged_comment(pr), %{}, opts)
  end
end

defp handle_event({:ci_failure, fingerprint}, project, config, repo, identifier, pr, opts) do
  consume = %{last_head_sha: Map.get(pr, :head_sha), last_checks_fingerprint: fingerprint}
  {:ok, _row} = MonitorState.upsert(project.slug, identifier, Map.get(pr, :url), consume)

  classifier = Keyword.get(opts, :classifier, &Classifier.classify/3)
  context = ci_context(repo, identifier, pr, opts)
  {:ok, verdict} = classifier.(:ci_failure, context, opts)

  run_decision(:ci_failure, verdict, project, config, repo, identifier, pr, opts)
end

defp handle_event({:review_findings, marker}, project, config, repo, identifier, pr, opts) do
  {:ok, _row} = MonitorState.upsert(project.slug, identifier, Map.get(pr, :url), %{last_review_marker: marker})

  classifier = Keyword.get(opts, :classifier, &Classifier.classify/3)
  review = latest_review_entry(pr, marker)
  context = review_context(repo, identifier, pr, review, opts)
  {:ok, verdict} = classifier.(:review_findings, context, opts)

  run_decision({:review_findings, review}, verdict, project, config, repo, identifier, pr, opts)
end

defp run_decision(event, verdict, project, config, repo, identifier, pr, opts) do
  kind = event_kind(event)
  count = MonitorState.max_rework_count(project.slug, identifier)
  max = ProjectConfig.pr_monitor_max_auto_rework(config)
  action = decide(kind, verdict["verdict"], count, max)
  comment = comment_for(action, event, verdict, repo, pr, count, max, opts)

  apply_transition(project, config, identifier, pr, action, comment, %{"verdict" => verdict["verdict"], "summary" => verdict["summary"]}, opts)
end

defp event_kind({:review_findings, _review}), do: :review_findings
defp event_kind(kind) when is_atom(kind), do: kind

defp apply_transition(project, config, identifier, pr, action, comment, classification, opts) do
  dispatch = Keyword.get(opts, :issue_dispatch, &IssueAdapter.dispatch/3)
  pr_url = Map.get(pr, :url)

  if issue_still_waiting?(project, identifier, config) do
    {:ok, _} = dispatch.(project, :add_comment, [identifier, comment, %{}])

    {last_action, extra} =
      case action do
        :move_done ->
          {:ok, _} = dispatch.(project, :move_issue, [identifier, %{"status" => @done_state}])
          {"moved_to_done", %{}}

        :move_rework ->
          {:ok, _} = dispatch.(project, :move_issue, [identifier, %{"status" => @rework_state}])
          row = MonitorState.get(project.slug, identifier, pr_url)
          {"moved_to_rework", %{auto_rework_count: (row && row.auto_rework_count || 0) + 1}}

        {:stay, :limit_reached} ->
          {"limit_reached", %{}}

        {:stay, _reason} ->
          {"kept_human_review", %{}}
      end

    attrs =
      Map.merge(extra, %{
        last_action: last_action,
        last_classification: classification,
        last_action_at: DateTime.utc_now()
      })

    {:ok, _} = MonitorState.upsert(project.slug, identifier, pr_url, attrs)
    :ok
  else
    Logger.debug("PR monitor action discarded issue=#{identifier} reason=:left_wait_state")
    :ok
  end
end

defp issue_still_waiting?(project, identifier, config) do
  case SymphonyElixir.LocalTracker.Context.get_issue(project.slug, identifier) do
    {:ok, issue} -> issue_state_name(issue) in (config.wait_states || [])
    _ -> false
  end
end
```

`issue_state_name/1`: read the issue's current status name the same way `Orchestrator`/`LocalFirstTracker` does (check `LocalTracker.Context.get_issue/2` return shape — it preloads `status`; use `issue.status.name`). Adjust during implementation.

Comment builders (same module, all `defp` except none needed public):

```elixir
defp merged_comment(pr) do
  "## PR merged — issue completed\n\nPR ##{pr.number} (#{pr.url}) was merged. Symphony moved this issue to Done."
end

defp comment_for(:move_done, _event, _verdict, _repo, pr, _count, _max, _opts), do: merged_comment(pr)

defp comment_for(:move_rework, :ci_failure, verdict, repo, pr, count, max, opts) do
  check_logs = Keyword.get(opts, :check_logs)
  fix_opts = if is_function(check_logs, 2), do: [check_logs: check_logs], else: []
  entries = PullRequestFix.failing_entries(repo, [pr], fix_opts)

  header =
    "## CI failure — automated fix requested (attempt #{count + 1}/#{max})\n\n" <>
      "Symphony's PR monitor attributed this failure to the PR's changes: #{verdict["summary"]}\n\n"

  PullRequestFix.build_comment(entries, header: header)
end

defp comment_for(:move_rework, {:review_findings, review}, verdict, _repo, pr, count, max, _opts) do
  """
  ## Review feedback — automated fix requested (attempt #{count + 1}/#{max})

  Symphony's PR monitor judged the review findings on PR ##{pr.number} (#{pr.url}) as fixable by the agent: #{verdict["summary"]}

  > #{String.replace(review[:body] || "", "\n", "\n> ")}
  """
end

defp comment_for({:stay, :limit_reached}, _event, verdict, _repo, pr, _count, max, _opts) do
  """
  ## Automatic fix limit reached

  PR ##{pr.number} (#{pr.url}) still has actionable findings (#{verdict && verdict["summary"]}), but the automatic Rework limit (#{max}) was reached. A human needs to review this issue.
  """
end

defp comment_for({:stay, :unrelated}, _event, verdict, _repo, pr, _count, _max, _opts) do
  """
  ## CI failure — likely unrelated to this PR

  #{verdict["summary"]}

  Symphony kept this issue in review. Consider re-running the failed jobs from the PR tab (PR ##{pr.number}: #{pr.url}).
  """
end

defp comment_for({:stay, :needs_human}, _event, verdict, _repo, pr, _count, _max, _opts) do
  """
  ## PR feedback — needs human attention

  #{verdict["summary"]}

  PR ##{pr.number}: #{pr.url}
  """
end
```

Context builders:

```elixir
defp ci_context(repo, identifier, pr, opts) do
  check_logs = Keyword.get(opts, :check_logs, fn r, id -> SymphonyElixir.GitHub.CheckLogs.failing_job_excerpt(r, id) end)

  failing_jobs =
    pr
    |> Events.failing_jobs()
    |> Enum.take(3)
    |> Enum.map(fn job ->
      excerpt =
        case job[:job_id] do
          id when is_integer(id) -> with({:ok, text} <- check_logs.(repo, id), do: text) || nil
          _ -> nil
        end

      %{name: job[:name], excerpt: excerpt}
    end)

  %{issue: issue_summary(identifier), pr: pr_summary(repo, pr, opts), failing_jobs: failing_jobs}
end

defp review_context(repo, identifier, pr, review, opts) do
  %{issue: issue_summary(identifier), pr: pr_summary(repo, pr, opts), review: review}
end

defp latest_review_entry(pr, marker) do
  pr
  |> Map.get(:conversation, [])
  |> Enum.find(%{}, &(&1[:created_at] == marker))
  |> Map.take([:author, :body, :review_state])
  |> Map.new(fn {k, v} -> {if(k == :review_state, do: :state, else: k), v} end)
end

defp pr_summary(repo, pr, opts) do
  changed_files_fun = Keyword.get(opts, :changed_files, &default_changed_files/2)

  %{
    number: pr.number,
    title: pr.title,
    head_ref: pr[:head_ref],
    base_ref: pr[:base_ref],
    changed_files: changed_files_fun.(Map.get(pr, :repo) || repo, pr.number)
  }
end

defp default_changed_files(repo, number) do
  case SymphonyElixir.GitHub.Client.rest_get("/repos/#{repo}/pulls/#{number}/files?per_page=50") do
    {:ok, %{body: files}} when is_list(files) -> Enum.map(files, &Map.get(&1, "filename")) |> Enum.reject(&is_nil/1)
    _ -> []
  end
end

defp issue_summary(identifier), do: %{identifier: identifier, title: nil, description: nil}
```

(For v1 the issue title/description in the classifier context may be filled from `LocalTracker.Context.get_issue/2` when available — do it if trivial, otherwise leave identifier-only; the prompt tolerates nil.)

- [ ] **Step 6: Run tests to verify pass**

Run: `mix test test/symphony_elixir/pull_request_monitor/`
Expected: PASS.

- [ ] **Step 7: Run lints/specs**

Run: `mix specs.check && mix format --check-formatted`
Expected: clean (add missing `@spec`s if flagged).

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor.ex \
        elixir/test/symphony_elixir/pull_request_monitor/pull_request_monitor_test.exs
git commit -m "feat(pr-monitor): per-issue event processing, transitions and comments"
```

---

### Task 8: Reconciler GenServer + supervision

**Files:**
- Create: `elixir/lib/symphony_elixir/pull_request_monitor/reconciler.ex`
- Modify: `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` (insert after `SymphonyElixir.DevServer.Reconciler`)
- Test: `elixir/test/symphony_elixir/pull_request_monitor/reconciler_test.exs`

- [ ] **Step 1: Write the failing test (pure candidate selection)**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Reconciler

  test "candidates/3 keeps wait-state issues of enabled projects, skips in-flight" do
    issues = [
      %{identifier: "#1", project_slug: "enabled"},
      %{identifier: "#2", project_slug: "disabled"},
      %{identifier: "#3", project_slug: "enabled"},
      %{identifier: nil, project_slug: "enabled"}
    ]

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new(["#3"]))

    assert Enum.map(result, & &1.identifier) == ["#1"]
  end

  test "candidates/3 caps the batch size" do
    issues = for n <- 1..30, do: %{identifier: "##{n}", project_slug: "enabled"}

    result = Reconciler.candidates(issues, MapSet.new(["enabled"]), MapSet.new())

    assert length(result) == 10
  end
end
```

- [ ] **Step 2: Run to verify fail**

Run: `mix test test/symphony_elixir/pull_request_monitor/reconciler_test.exs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.PullRequestMonitor.Reconciler do
  @moduledoc """
  Periodically follows PRs of wait-state issues for projects with
  `pr_monitor.enabled: true`, delegating per-issue work (event detection,
  LLM classification, transitions) to `SymphonyElixir.PullRequestMonitor`
  inside supervised tasks so a slow classification never blocks the tick.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.{Config, Repo, Tracker}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.PullRequestMonitor

  @max_issues_per_tick 10
  @fallback_interval_ms 60_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc false
  @spec candidates([map()], MapSet.t(), MapSet.t()) :: [map()]
  def candidates(issues, enabled_slugs, in_flight) do
    issues
    |> Enum.filter(fn issue ->
      identifier = map_value(issue, :identifier)
      slug = map_value(issue, :project_slug)

      is_binary(identifier) and identifier != "" and
        MapSet.member?(enabled_slugs, slug) and
        not MapSet.member?(in_flight, identifier)
    end)
    |> Enum.take(@max_issues_per_tick)
  end

  @impl true
  def init(_opts) do
    schedule_tick()
    {:ok, %{in_flight: %{}}}
  end

  @impl true
  def handle_info(:tick, state) do
    state = run_tick_safely(state)
    schedule_tick()
    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    in_flight = for {id, r} <- state.in_flight, r != ref, into: %{}, do: {id, r}
    {:noreply, %{state | in_flight: in_flight}}
  end

  def handle_info(_message, state), do: {:noreply, state}

  defp run_tick_safely(state) do
    run_cycle(state)
  rescue
    exception ->
      Logger.debug("PR monitor tick skipped reason=#{inspect(exception)}")
      state
  catch
    kind, reason ->
      Logger.debug("PR monitor tick skipped reason=#{inspect({kind, reason})}")
      state
  end

  defp run_cycle(state) do
    configs = enabled_project_configs()

    if configs == %{} do
      state
    else
      issues = fetch_wait_state_issues()
      in_flight_ids = state.in_flight |> Map.keys() |> MapSet.new()

      issues
      |> candidates(MapSet.new(Map.keys(configs)), in_flight_ids)
      |> Enum.reduce(state, fn issue, acc -> start_issue_task(issue, configs, acc) end)
    end
  end

  defp enabled_project_configs do
    Context.list_projects()
    |> Enum.map(fn project -> {project, project |> Repo.preload(:setup) |> ProjectConfig.resolve()} end)
    |> Enum.filter(fn {_project, config} -> ProjectConfig.pr_monitor_enabled?(config) end)
    |> Map.new(fn {project, config} -> {project.slug, {project, config}} end)
  end

  defp fetch_wait_state_issues do
    case Config.wait_states() do
      [] ->
        []

      states ->
        case Tracker.fetch_issues_by_states(states) do
          {:ok, issues} when is_list(issues) -> issues
          _other -> []
        end
    end
  end

  defp start_issue_task(issue, configs, state) do
    identifier = map_value(issue, :identifier)
    slug = map_value(issue, :project_slug)

    case Map.get(configs, slug) do
      {project, config} ->
        task =
          Task.Supervisor.async_nolink(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
            PullRequestMonitor.process_issue(project, issue, config: config)
          end)

        %{state | in_flight: Map.put(state.in_flight, identifier, task.ref)}

      nil ->
        state
    end
  end

  defp schedule_tick do
    Process.send_after(self(), :tick, interval_ms())
  rescue
    _exception -> :ok
  catch
    _kind, _reason -> :ok
  end

  defp interval_ms do
    case Config.pr_monitor_interval_ms() do
      ms when is_integer(ms) and ms > 0 -> ms
      _invalid -> @fallback_interval_ms
    end
  rescue
    _exception -> @fallback_interval_ms
  catch
    _kind, _reason -> @fallback_interval_ms
  end

  defp map_value(value, key) when is_map(value) and is_atom(key) do
    Map.get(value, key) || Map.get(value, Atom.to_string(key))
  end

  defp map_value(_value, _key), do: nil
end
```

Note: `Task.Supervisor.async_nolink` replies arrive as `{ref, result}` messages — add a catch-all clause **before** the generic `handle_info(_message, state)` if needed (it already swallows them; `:DOWN` cleanup handles the in-flight map).

Supervision — in `elixir/lib/symphony_elixir/orchestrator_supervisor.ex` add to `child_specs/0`:

```elixir
SymphonyElixir.PullRequestMonitor.Reconciler,
```

after `SymphonyElixir.DevServer.Reconciler`.

- [ ] **Step 4: Run tests + boot check**

Run: `mix test test/symphony_elixir/pull_request_monitor/reconciler_test.exs && mix test test/symphony_elixir/orchestrator_supervisor_test.exs` (if the supervisor test exists; otherwise `mix compile --warnings-as-errors`)
Expected: PASS / clean compile.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/pull_request_monitor/reconciler.ex \
        elixir/lib/symphony_elixir/orchestrator_supervisor.ex \
        elixir/test/symphony_elixir/pull_request_monitor/reconciler_test.exs
git commit -m "feat(pr-monitor): reconciler tick loop under orchestrator supervision"
```

---

### Task 9: `WorkflowRuns.rerun_failed_jobs` + run-id parsing

**Files:**
- Create: `elixir/lib/symphony_elixir/github/workflow_runs.ex`
- Test: `elixir/test/symphony_elixir/github/workflow_runs_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.WorkflowRunsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.WorkflowRuns

  test "run_ids/1 extracts unique run ids from failing pipelines" do
    prs = [%{pipelines: [
      %{name: "CI", url: "https://github.com/o/r/actions/runs/99",
        jobs: [%{name: "a", conclusion: "FAILURE", status: "COMPLETED"}]},
      %{name: "Lint", url: "https://github.com/o/r/actions/runs/100",
        jobs: [%{name: "b", conclusion: "SUCCESS", status: "COMPLETED"}]},
      %{name: "NoUrl", url: nil,
        jobs: [%{name: "c", conclusion: "FAILURE", status: "COMPLETED"}]}
    ]}]

    assert WorkflowRuns.run_ids(prs) == [99]
  end

  test "rerun_failed_jobs/3 posts to the rerun endpoint" do
    request_fun = fn path, _body, _opts ->
      send(self(), {:posted, path})
      {:ok, %{status: 201, body: %{}}}
    end

    assert :ok = WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
    assert_received {:posted, "/repos/o/r/actions/runs/99/rerun-failed-jobs"}
  end

  test "rerun_failed_jobs/3 surfaces non-201 as error" do
    request_fun = fn _path, _body, _opts -> {:ok, %{status: 403, body: %{"message" => "forbidden"}}} end

    assert {:error, {:rerun_failed, 403, _}} = WorkflowRuns.rerun_failed_jobs("o/r", 99, request_fun: request_fun)
  end
end
```

- [ ] **Step 2: Run to verify fail**

Run: `mix test test/symphony_elixir/github/workflow_runs_test.exs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.GitHub.WorkflowRuns do
  @moduledoc """
  GitHub Actions workflow-run helpers: extracting run ids from PR pipelines
  and re-running only the failed jobs of a run.
  """

  alias SymphonyElixir.GitHub.Client

  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)
  @run_id_pattern ~r{/actions/runs/(\d+)}

  @spec run_ids([map()]) :: [pos_integer()]
  def run_ids(prs) when is_list(prs) do
    prs
    |> Enum.flat_map(&Map.get(&1, :pipelines, []))
    |> Enum.filter(&pipeline_failing?/1)
    |> Enum.flat_map(&extract_run_id/1)
    |> Enum.uniq()
  end

  @spec rerun_failed_jobs(String.t(), pos_integer(), keyword()) :: :ok | {:error, term()}
  def rerun_failed_jobs(repo, run_id, opts \\ []) when is_binary(repo) and is_integer(run_id) do
    request_fun = Keyword.get(opts, :request_fun, &default_request/3)

    case request_fun.("/repos/#{repo}/actions/runs/#{run_id}/rerun-failed-jobs", %{}, opts) do
      {:ok, %{status: 201}} -> :ok
      {:ok, %{status: status, body: body}} -> {:error, {:rerun_failed, status, body}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp default_request(path, body, opts), do: Client.rest_post(path, body, Keyword.take(opts, []))

  defp pipeline_failing?(pipeline) do
    pipeline
    |> Map.get(:jobs, [])
    |> Enum.any?(fn job ->
      String.upcase(to_string(job[:conclusion] || "")) in @failure_conclusions
    end)
  end

  defp extract_run_id(pipeline) do
    case Map.get(pipeline, :url) do
      url when is_binary(url) ->
        case Regex.run(@run_id_pattern, url) do
          [_, id] -> [String.to_integer(id)]
          _ -> []
        end

      _ ->
        []
    end
  end
end
```

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir/github/workflow_runs_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/workflow_runs.ex \
        elixir/test/symphony_elixir/github/workflow_runs_test.exs
git commit -m "feat(github): rerun failed workflow jobs helper"
```

---

### Task 10: Rerun endpoint + monitor payload in PR listing

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (after the `merge` route, ~line 113)
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller_test.exs`

- [ ] **Step 1: Write the failing controller test**

Mirror the structure of `pull_request_fix_controller_test.exs` / `pull_request_merge_controller_test.exs` (auth plug setup, project fixture, app-env stub for the client module). Core cases:

```elixir
test "POST rerun_failed reruns each failing run and returns the list", %{conn: conn} do
  # stub PullRequests reader (app env :github_client_module or the controller's
  # injectable boundary, following the fix controller test's approach) so the
  # issue resolves one PR with a failing pipeline run 99
  conn = post(conn, "/api/tracker/v1/projects/proj/issues/42/pull_requests/7/rerun_failed")

  assert %{"data" => %{"reruns" => [%{"run_id" => 99, "ok" => true}]}} = json_response(conn, 200)
end

test "returns 422 when there is nothing to rerun", %{conn: conn} do
  conn = post(conn, "/api/tracker/v1/projects/proj/issues/42/pull_requests/7/rerun_failed")

  assert json_response(conn, 422)
end
```

- [ ] **Step 2: Run to verify fail**

Run: `mix test test/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller_test.exs`
Expected: FAIL — route/controller missing.

- [ ] **Step 3: Implement**

Router (inside the tracker scope):

```elixir
post(
  "/projects/:project_slug/issues/:identifier/pull_requests/:number/rerun_failed",
  PullRequestRerunController,
  :create
)
```

Controller:

```elixir
defmodule SymphonyElixirWeb.Tracker.PullRequestRerunController do
  use Phoenix.Controller, formats: [:json]

  alias SymphonyElixir.GitHub.{PullRequests, WorkflowRuns}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.Tracker.TrackerErrors

  @spec create(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def create(conn, %{"project_slug" => slug, "identifier" => identifier, "number" => number_param}) do
    with {:ok, project} <- Context.get_project(slug),
         {number, ""} <- Integer.parse(to_string(number_param)),
         {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, prs} <- PullRequests.for_issue(repo, identifier),
         target = Enum.filter(prs, &(&1.number == number)),
         run_ids = WorkflowRuns.run_ids(target),
         :ok <- ensure_runs(run_ids) do
      reruns =
        Enum.map(run_ids, fn run_id ->
          case WorkflowRuns.rerun_failed_jobs(repo, run_id) do
            :ok -> %{run_id: run_id, ok: true}
            {:error, reason} -> %{run_id: run_id, ok: false, error: inspect(reason)}
          end
        end)

      json(conn, %{data: %{reruns: reruns}})
    else
      :error -> TrackerErrors.render(conn, :invalid_pull_request_number)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp ensure_runs([]), do: {:error, :no_failed_runs}
  defp ensure_runs([_ | _]), do: :ok
end
```

(Adapt the `use`/alias lines and error rendering to match `PullRequestFixController` exactly — copy its head. Add the `:no_failed_runs` and `:invalid_pull_request_number` reasons to `TrackerErrors` if it uses an explicit mapping.)

Monitor payload — in `PullRequestController.index`, pipe the PR list through `MonitorState.attach/3` right before rendering:

```elixir
alias SymphonyElixir.PullRequestMonitor.MonitorState
# in the success branch, before building the JSON envelope:
prs = MonitorState.attach(prs, project_slug, identifier)
```

Add a controller test case asserting the `monitor` key appears (insert a `MonitorState` row in setup) and is `null` otherwise.

- [ ] **Step 4: Run tests to verify pass**

Run: `mix test test/symphony_elixir_web/controllers/tracker/`
Expected: PASS (existing PR controller tests included).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_rerun_controller.ex \
        elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex \
        elixir/lib/symphony_elixir_web/router.ex \
        elixir/test/symphony_elixir_web/controllers/tracker/
git commit -m "feat(pr-monitor): rerun-failed-jobs endpoint and monitor payload in PR listing"
```

---

### Task 11: Frontend — types, service, tests

**Files:**
- Modify: `tracker/src/types/pull-request.ts`
- Modify: `tracker/src/services/pullRequests.ts`
- Test: `tracker/src/services/__tests__/pullRequests.test.ts` (create if missing, mirroring `issues.test.ts` mock style)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";

import { normalizePullRequest, rerunFailedJobs } from "@/services/pullRequests";
import { http } from "@/services/http";

vi.mock("@/services/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/http")>();
  return { ...actual, http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

describe("normalizePullRequest monitor payload", () => {
  it("maps monitor info when present", () => {
    const pr = normalizePullRequest({
      number: 7,
      monitor: {
        last_action: "moved_to_rework",
        summary: "login test broke",
        auto_rework_count: 1,
        last_action_at: "2026-06-10T12:00:00Z",
      },
    } as never);

    expect(pr.monitor).toEqual({
      lastAction: "moved_to_rework",
      summary: "login test broke",
      autoReworkCount: 1,
      lastActionAt: "2026-06-10T12:00:00Z",
    });
  });

  it("defaults monitor to null", () => {
    expect(normalizePullRequest({ number: 7 } as never).monitor).toBeNull();
  });
});

describe("rerunFailedJobs", () => {
  it("POSTs to the rerun endpoint and returns rerun results", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { data: { reruns: [{ run_id: 99, ok: true }] } },
    } as never);

    const result = await rerunFailedJobs("proj", "#42", 7);

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/proj/issues/42/pull_requests/7/rerun_failed"),
    );
    expect(result).toEqual([{ runId: 99, ok: true }]);
  });
});
```

(Match the exact `http` mocking pattern used in `tracker/src/services/__tests__/issues.test.ts` — adjust the `vi.mock` block accordingly.)

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- pullRequests` (from `tracker/`)
Expected: FAIL — `monitor` / `rerunFailedJobs` missing.

- [ ] **Step 3: Implement**

`types/pull-request.ts` — add:

```ts
export interface PullRequestMonitorInfo {
  lastAction: string | null;
  summary: string | null;
  autoReworkCount: number;
  lastActionAt: string | null;
}

export interface RerunResult {
  runId: number;
  ok: boolean;
  error?: string;
}
```

and on the `PullRequest` interface: `monitor: PullRequestMonitorInfo | null;`.

`services/pullRequests.ts`:

```ts
interface BackendMonitorDto {
  last_action?: string | null;
  summary?: string | null;
  auto_rework_count?: number | null;
  last_action_at?: string | null;
}
// add `monitor?: BackendMonitorDto | null;` to BackendPullRequestDto

function normalizeMonitor(dto: BackendMonitorDto | null | undefined): PullRequestMonitorInfo | null {
  if (!dto) return null;
  return {
    lastAction: dto.last_action ?? null,
    summary: dto.summary ?? null,
    autoReworkCount: dto.auto_rework_count ?? 0,
    lastActionAt: dto.last_action_at ?? null,
  };
}
// in normalizePullRequest(): monitor: normalizeMonitor(dto.monitor),

interface BackendRerunEnvelope {
  data?: { reruns?: { run_id?: number | null; ok?: boolean | null; error?: string | null }[] | null } | null;
}

export async function rerunFailedJobs(
  projectSlug: string,
  identifier: string,
  number: number,
): Promise<RerunResult[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  const issueIdentifier = normalizeIssueIdentifier(identifier);
  if (!issueIdentifier) throw new Error("identifier is required");
  if (!Number.isInteger(number) || number <= 0) throw new Error("number is required");

  const response = await http.post<BackendRerunEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/pull_requests/${number}/rerun_failed`,
    ),
  );

  return (response.data?.data?.reruns ?? []).map((entry) => ({
    runId: entry.run_id ?? 0,
    ok: entry.ok === true,
    ...(entry.error ? { error: entry.error } : {}),
  }));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- pullRequests` (from `tracker/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/pull-request.ts tracker/src/services/pullRequests.ts \
        tracker/src/services/__tests__/pullRequests.test.ts
git commit -m "feat(tracker): monitor payload and rerun-failed-jobs service"
```

---

### Task 12: Frontend — monitor banner + Re-run button in PR tab

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/PullRequestTab.tsx`

- [ ] **Step 1: Implement the banner + button**

In `PullRequestTab.tsx`:

1. Imports: add `RotateCcw` from `lucide-react`, `rerunFailedJobs` from `@/services/pullRequests`.
2. State: `const [rerunning, setRerunning] = useState(false);`
3. Handler:

```tsx
async function handleRerun() {
  if (rerunning) return;
  setRerunning(true);
  try {
    const failing = pullRequests.filter(hasFailingChecks);
    for (const pr of failing) {
      await rerunFailedJobs(projectSlug, issue.identifier, pr.number);
    }
    toast.success("Failed jobs were re-run. Refresh in a minute to see results.");
    onRefresh();
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : "Could not re-run the failed jobs.");
  } finally {
    setRerunning(false);
  }
}
```

4. Button next to "Fix with agent" (inside the same `canFix ? (...)` actions row):

```tsx
<button
  type="button"
  onClick={() => void handleRerun()}
  disabled={rerunning}
  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
>
  <RotateCcw className={cn("h-3.5 w-3.5", rerunning && "animate-spin")} />
  {rerunning ? "Re-running…" : "Re-run failed jobs"}
</button>
```

5. Banner (rendered above the PR list when any PR has monitor info):

```tsx
const monitorEntries = pullRequests
  .filter((pr) => pr.monitor?.lastAction)
  .map((pr) => ({ pr, monitor: pr.monitor! }));
```

```tsx
{monitorEntries.map(({ pr, monitor }) => (
  <div
    key={`monitor-${pr.number}`}
    className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground"
  >
    <span className="font-medium text-foreground">{monitorLabel(monitor)}</span>
    {monitor.summary ? <> — {monitor.summary}</> : null}
  </div>
))}
```

```tsx
function monitorLabel(monitor: PullRequestMonitorInfo): string {
  switch (monitor.lastAction) {
    case "moved_to_rework":
      return `CI/review failure attributed to this PR — sent to Rework (attempt ${monitor.autoReworkCount})`;
    case "moved_to_done":
      return "PR merged — issue moved to Done";
    case "kept_human_review":
      return "Kept in review — failure looks unrelated or needs a human";
    case "limit_reached":
      return "Automatic fix limit reached — human review required";
    default:
      return "PR monitor";
  }
}
```

- [ ] **Step 2: Verify lint/build**

Run: `npm run lint && npm run build` (from `tracker/`)
Expected: clean.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Start the stack, open an issue with a PR that has failing checks, confirm the banner and the Re-run button render and the POST fires.

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/issues/issue-detail/PullRequestTab.tsx
git commit -m "feat(tracker): PR monitor banner and re-run failed jobs button"
```

---

### Task 13: Docs + full quality gates

**Files:**
- Modify: `elixir/README.md` (workflow_markdown example: add `pr_monitor` section; document `SYMPHONY_PR_MONITOR_INTERVAL_MS`)
- Modify: `README.md` (one paragraph: Symphony now follows PRs of wait-state issues — auto Rework / Done / re-run suggestion)
- Modify: `SPEC.md` only if it enumerates background processes (add the reconciler where `DevServer.Reconciler` is described)

- [ ] **Step 1: Update docs** (per `elixir/AGENTS.md` docs policy — behavior/config changed, so same-PR updates are required)

- [ ] **Step 2: Run the full gates**

Run (from `elixir/`): `make all && mix specs.check`
Expected: format, lint, coverage, dialyzer all green; all public `def`s have `@spec`.

Run (from `tracker/`): `npm test && npm run lint && npm run build`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add elixir/README.md README.md SPEC.md elixir/.env.example
git commit -m "docs: PR follow-up monitor configuration and behavior"
```

---

## Plan self-review notes

- **Spec coverage:** merged→Done (T7 `handle_event(:merged…)`), CI pr_caused→Rework with logs (T6+T7), unrelated→stay+re-run suggestion (T7 comment + T9/T10/T11/T12 button), review fixable→Rework with quoted review (T7), needs_human→stay (T5 fallback + T7), 2-attempt cap (T7 `decide/4` + counter), opt-in config (T3), event dedupe across restarts (T2+T4), classification inside orchestrator cycle via async tasks (T8), monitor surfaced in UI (T10+T11+T12).
- **Known adaptation points (intentional, verify while implementing):** exact test fixture helpers (`insert_project`/`insert_issue` equivalents), `TrackerErrors` reason mapping, `Config.workspace_root/0` accessor name, `LocalTracker.Context.get_issue/2` status shape, controller `use` head copied from `PullRequestFixController`, and the `http` mock pattern in vitest tests. Each is constrained to a single named file with a named pattern to copy.
- **Type consistency:** `MonitorState.attach/3` produces `:monitor` with `last_action/summary/auto_rework_count/last_action_at`; backend JSON serializes those keys; frontend `BackendMonitorDto` matches; `decide/4` verdict strings match `Classifier.@valid_verdicts`.
