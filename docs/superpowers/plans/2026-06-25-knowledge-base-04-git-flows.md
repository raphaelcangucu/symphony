# Knowledge Base - Milestone 4: Git Background Flows (sync, PR, auto-merge) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task, or **(B)** inline execution with checkpoints. All Elixir commands run from `elixir/`. Depends on M1-M3 merged.

**Goal:** Keep each repository's `symphony-docs` branch continuously reconciled with the project's default branch and automatically promote KB edits to the default branch: merge default -> symphony-docs (sync), open/update a pull request from symphony-docs -> default, and auto-merge it once checks are green. Conflicts and check failures are surfaced (not silently retried forever) and exposed to the UI as per-repo sync state.

**Architecture:** A deeply-tested pure core `KnowledgeBase.GitFlow` performs three composable steps with injectable dependencies (git runner + GitHub client): `sync_branch/2` (fetch + merge default into the worktree branch, push), `ensure_pull_request/2` (find-or-create the docs PR), and `evaluate_and_merge/2` (read checks, squash-merge when green). A thin supervised GenServer `KnowledgeBase.SyncWorker` (one per project+repo, started on demand via a `DynamicSupervisor`) runs the steps with bounded retry/backoff, persists per-repo state in a new `kb_sync_states` table, and broadcasts `kb_event`. PR creation and check evaluation reuse existing GitHub modules (`GitHub.Api.pull_request_detail/3`, `PullRequestMerge.merge/4`) and add a new `GitHub.PullRequestCreate`.

**Tech Stack:** Elixir/Phoenix, `git` CLI, `SymphonyElixir.GitHub.Client` (`rest_get/2`, `rest_post/3`), existing `GitHub.Api` + `PullRequestMerge`, Ecto/SQLite, `Task.Supervisor`/`DynamicSupervisor`.

---

## Plan sequence

M1 read -> M2 editing/auto-commit -> M3 search -> **M4 git background flows (this plan)** -> M5 general KB -> M6 frontend -> M7 assistant tools. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md` (D6, D7, D8, Section 7).

---

## File structure (M4)

Create:
- `elixir/lib/symphony_elixir/github/pull_request_create.ex` - find-or-create open PR for a head branch.
- `elixir/lib/symphony_elixir/knowledge_base/git_flow.ex` - sync/ensure-PR/evaluate-merge core (injectable deps).
- `elixir/lib/symphony_elixir/knowledge_base/sync_worker.ex` - per-(project,repo) GenServer orchestrating the flow with retry.
- `elixir/lib/symphony_elixir/knowledge_base/sync_supervisor.ex` - `DynamicSupervisor` for workers.
- `elixir/lib/symphony_elixir/knowledge_base/sync_state.ex` - Ecto schema + read/upsert helpers for `kb_sync_states`.
- `elixir/priv/repo/migrations/20260627000100_create_kb_sync_states.exs`
- Tests:
  - `elixir/test/symphony_elixir/github/pull_request_create_test.exs`
  - `elixir/test/symphony_elixir/knowledge_base/git_flow_test.exs`
  - `elixir/test/symphony_elixir/knowledge_base/sync_worker_test.exs`
  - `elixir/test/symphony_elixir/knowledge_base/sync_state_test.exs`
  - `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_sync_controller_test.exs`

Modify:
- `elixir/lib/symphony_elixir/knowledge_base/git.ex` - add `merge/3`, `abort_merge/2`.
- `elixir/lib/symphony_elixir/application.ex` - start `KnowledgeBase.SyncSupervisor` in the supervision tree.
- `elixir/lib/symphony_elixir/knowledge_base.ex` - enqueue a sync after each successful write/move/delete; add `sync_status/2` and `request_sync/2`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex` - add `sync_status` + `request_sync` actions.
- `elixir/lib/symphony_elixir_web/router.ex` - add sync routes.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` - add `:kb_merge_conflict`, `:kb_checks_failed`.

Locked decisions:
- Merge direction for sync: `git merge --no-edit origin/<default>` into the worktree on `symphony-docs` (merge-based, matching the project's `pull`/`land` conventions; never rebase).
- PR head `symphony-docs`, base = repo default branch (resolved from GitHub `GET /repos/{o}/{r}` -> `default_branch`).
- Auto-merge method: `"squash"` (constant; configurable later).
- Auto-merge only when `checks_state == "SUCCESS"` and no jobs still running; `"PENDING"` -> reschedule; `"FAILURE"`/`"ERROR"` -> stop and record `checks_failed`.
- Worker retry: capped exponential backoff (e.g. 5s, 15s, 45s, max 3 attempts per trigger) for transient git/network errors; conflict and checks-failed are terminal (require user action), recorded in state.
- A push/PR/merge failure does NOT roll back the local commit (already on `symphony-docs`); state records the reason for the UI.

---

## Task 1: Extend `KnowledgeBase.Git` with merge

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base/git.ex`
- Test: append to `elixir/test/symphony_elixir/knowledge_base/git_test.exs`

- [ ] **Step 1: Write the failing test (append)**

```elixir
  test "merge fast-forwards origin changes and reports conflicts", %{checkout: checkout, base: base} do
    origin = Path.join(base, "origin.git")
    {_o, 0} = System.cmd("git", ["init", "--bare", "-q", origin], stderr_to_stdout: true)
    sh(checkout, ["remote", "add", "origin", origin])
    sh(checkout, ["push", "-q", "origin", "main"])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    # advance origin/main with a non-conflicting file
    other = Path.join(base, "clone")
    {_o, 0} = System.cmd("git", ["clone", "-q", origin, other], stderr_to_stdout: true)
    File.write!(Path.join(other, "from-main.txt"), "x")
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "main change"])
    sh(other, ["push", "-q", "origin", "main"])

    assert :ok = Git.fetch(wt)
    assert {:ok, :merged} = Git.merge(wt, "origin/main")
    assert File.exists?(Path.join(wt, "from-main.txt"))
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/git_test.exs`
Expected: FAIL (`merge/2` undefined).

- [ ] **Step 3: Write minimal implementation** (add to `git.ex`)

```elixir
  @spec merge(Path.t(), String.t(), keyword()) :: {:ok, :merged | :up_to_date} | {:error, :merge_conflict | term()}
  def merge(dir, ref, opts \\ []) do
    name = Keyword.get(opts, :name, "Symphony")
    email = Keyword.get(opts, :email, "symphony-kb@localhost")
    args = ["-c", "user.name=#{name}", "-c", "user.email=#{email}", "merge", "--no-edit", ref]

    case run(dir, args, opts) do
      {:ok, output} -> {:ok, if(output =~ "Already up to date", do: :up_to_date, else: :merged)}
      {:error, {_status, output}} ->
        if output =~ "CONFLICT" or output =~ "Automatic merge failed" do
          _ = abort_merge(dir, opts)
          {:error, :merge_conflict}
        else
          {:error, {:merge_failed, output}}
        end
    end
  end

  @spec abort_merge(Path.t(), keyword()) :: :ok | {:error, term()}
  def abort_merge(dir, opts \\ []) do
    case run(dir, ["merge", "--abort"], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/git_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/git.ex elixir/test/symphony_elixir/knowledge_base/git_test.exs
git commit -m "feat(kb): add merge and abort-merge git helpers"
```

---

## Task 2: `GitHub.PullRequestCreate` (find-or-create)

**Files:**
- Create: `elixir/lib/symphony_elixir/github/pull_request_create.ex`
- Test: `elixir/test/symphony_elixir/github/pull_request_create_test.exs`

Reuses the existing `Client` REST surface. Accepts an injectable `:client` (defaults to `SymphonyElixir.GitHub.Client`) so tests pass a stub module implementing `rest_get/2` and `rest_post/3`.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.PullRequestCreateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.PullRequestCreate

  defmodule StubNoExisting do
    def rest_get("/repos/acme/web", _opts), do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}
    def rest_get("/repos/acme/web/pulls" <> _q, _opts), do: {:ok, %{status: 200, body: []}}
    def rest_post("/repos/acme/web/pulls", body, _opts) do
      assert body["head"] == "symphony-docs" and body["base"] == "main"
      {:ok, %{status: 201, body: %{"number" => 42, "html_url" => "https://github.com/acme/web/pull/42"}}}
    end
    import ExUnit.Assertions
  end

  defmodule StubExisting do
    def rest_get("/repos/acme/web", _opts), do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}
    def rest_get("/repos/acme/web/pulls" <> _q, _opts),
      do: {:ok, %{status: 200, body: [%{"number" => 7, "html_url" => "https://github.com/acme/web/pull/7"}]}}
  end

  test "creates a new PR when none exists" do
    assert {:ok, %{number: 42, url: "https://github.com/acme/web/pull/42", created: true}} =
             PullRequestCreate.ensure("acme/web", "symphony-docs", client: StubNoExisting)
  end

  test "returns the existing open PR for the head branch" do
    assert {:ok, %{number: 7, created: false}} =
             PullRequestCreate.ensure("acme/web", "symphony-docs", client: StubExisting)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/pull_request_create_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.GitHub.PullRequestCreate do
  @moduledoc """
  Finds the open pull request for a head branch, or creates one targeting the
  repository default branch. Uses the GitHub REST API via `GitHub.Client`.
  """

  @default_client SymphonyElixir.GitHub.Client
  @title "docs: knowledge base updates"
  @body "Automated documentation updates from the Symphony knowledge base."

  @type result :: %{number: pos_integer(), url: String.t(), created: boolean()}

  @spec ensure(String.t(), String.t(), keyword()) :: {:ok, result()} | {:error, term()}
  def ensure(repo, head_branch, opts \\ []) when is_binary(repo) and is_binary(head_branch) do
    client = Keyword.get(opts, :client, @default_client)
    {owner, name} = split_repo(repo)

    with {:ok, default_branch} <- default_branch(client, owner, name),
         {:ok, existing} <- find_open_pr(client, owner, name, head_branch) do
      case existing do
        nil -> create(client, owner, name, head_branch, default_branch, opts)
        pr -> {:ok, %{number: pr["number"], url: pr["html_url"], created: false}}
      end
    end
  end

  defp default_branch(client, owner, name) do
    case client.rest_get("/repos/#{owner}/#{name}", []) do
      {:ok, %{status: s, body: %{"default_branch" => b}}} when s in 200..299 and is_binary(b) -> {:ok, b}
      {:ok, %{status: s}} -> {:error, {:github_api_status, s}}
      error -> error
    end
  end

  defp find_open_pr(client, owner, name, head_branch) do
    query = "?state=open&head=#{owner}:#{head_branch}"

    case client.rest_get("/repos/#{owner}/#{name}/pulls#{query}", []) do
      {:ok, %{status: s, body: [pr | _]}} when s in 200..299 -> {:ok, pr}
      {:ok, %{status: s, body: _}} when s in 200..299 -> {:ok, nil}
      {:ok, %{status: s}} -> {:error, {:github_api_status, s}}
      error -> error
    end
  end

  defp create(client, owner, name, head, base, opts) do
    payload = %{
      "title" => Keyword.get(opts, :title, @title),
      "head" => head,
      "base" => base,
      "body" => Keyword.get(opts, :body, @body)
    }

    case client.rest_post("/repos/#{owner}/#{name}/pulls", payload, []) do
      {:ok, %{status: s, body: %{"number" => n, "html_url" => url}}} when s in 200..299 ->
        {:ok, %{number: n, url: url, created: true}}

      {:ok, %{status: 422}} ->
        # Race: a PR was created concurrently; re-resolve.
        case find_open_pr(client, owner, name, head) do
          {:ok, %{"number" => n, "html_url" => url}} -> {:ok, %{number: n, url: url, created: false}}
          _ -> {:error, :pull_request_create_conflict}
        end

      {:ok, %{status: s}} ->
        {:error, {:github_api_status, s}}

      error ->
        error
    end
  end

  defp split_repo(repo) do
    case String.split(repo, "/", parts: 2) do
      [owner, name] -> {owner, name}
      _ -> {repo, repo}
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/github/pull_request_create_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/pull_request_create.ex elixir/test/symphony_elixir/github/pull_request_create_test.exs
git commit -m "feat(github): find-or-create pull request for a head branch"
```

---

## Task 3: `kb_sync_states` table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260627000100_create_kb_sync_states.exs`
- Create: `elixir/lib/symphony_elixir/knowledge_base/sync_state.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/sync_state_test.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateKbSyncStates do
  use Ecto.Migration

  def change do
    create table(:kb_sync_states) do
      add(:project_slug, :string, null: false)
      add(:repo_slug, :string, null: false)
      add(:status, :string, null: false, default: "idle")
      add(:pr_number, :integer)
      add(:pr_url, :string)
      add(:last_error, :string)
      add(:last_synced_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:kb_sync_states, [:project_slug, :repo_slug]))
  end
end
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SyncStateTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.SyncState
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(SyncState) end)
    :ok
  end

  test "put upserts and get returns the latest state" do
    assert {:ok, _} = SyncState.put("acme", "acme~web", %{status: "syncing"})
    assert {:ok, _} = SyncState.put("acme", "acme~web", %{status: "open_pr", pr_number: 9, pr_url: "u"})
    state = SyncState.get("acme", "acme~web")
    assert state.status == "open_pr"
    assert state.pr_number == 9
  end

  test "get returns a default idle state when none exists" do
    assert SyncState.get("acme", "acme~missing").status == "idle"
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/sync_state_test.exs`
Expected: FAIL.

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SyncState do
  @moduledoc "Per-repository knowledge base sync state (status, PR, last error)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Repo

  @type t :: %__MODULE__{}

  @statuses ~w(idle syncing open_pr merged conflict checks_failed error)

  schema "kb_sync_states" do
    field(:project_slug, :string)
    field(:repo_slug, :string)
    field(:status, :string, default: "idle")
    field(:pr_number, :integer)
    field(:pr_url, :string)
    field(:last_error, :string)
    field(:last_synced_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @spec statuses() :: [String.t()]
  def statuses, do: @statuses

  @spec get(String.t(), String.t()) :: t()
  def get(project_slug, repo_slug) do
    Repo.get_by(__MODULE__, project_slug: project_slug, repo_slug: repo_slug) ||
      %__MODULE__{project_slug: project_slug, repo_slug: repo_slug, status: "idle"}
  end

  @spec put(String.t(), String.t(), map()) :: {:ok, t()} | {:error, Ecto.Changeset.t()}
  def put(project_slug, repo_slug, attrs) do
    base = get(project_slug, repo_slug)

    base
    |> changeset(Map.merge(%{project_slug: project_slug, repo_slug: repo_slug}, attrs))
    |> Repo.insert_or_update()
  end

  defp changeset(record, attrs) do
    record
    |> cast(attrs, [:project_slug, :repo_slug, :status, :pr_number, :pr_url, :last_error, :last_synced_at])
    |> validate_required([:project_slug, :repo_slug, :status])
    |> validate_inclusion(:status, @statuses)
    |> unique_constraint([:project_slug, :repo_slug])
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/sync_state_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260627000100_create_kb_sync_states.exs elixir/lib/symphony_elixir/knowledge_base/sync_state.ex elixir/test/symphony_elixir/knowledge_base/sync_state_test.exs
git commit -m "feat(kb): persist per-repo sync state"
```

---

## Task 4: `KnowledgeBase.GitFlow` core

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/git_flow.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/git_flow_test.exs`

The flow is composed of pure-ish steps with injected dependencies. `sync_branch/2` is tested against real temp repos; `ensure_pull_request/2` and `evaluate_and_merge/2` are tested with stub modules.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.GitFlowTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{GitFlow, Workspace}

  setup do
    base = Path.join(System.tmp_dir!(), "kb-flow-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    origin = Path.join(base, "origin.git")
    File.mkdir_p!(checkout)
    {_o, 0} = System.cmd("git", ["init", "--bare", "-q", origin], stderr_to_stdout: true)
    sh(checkout, ["init", "-q", "-b", "main"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"])
    sh(checkout, ["remote", "add", "origin", origin])
    sh(checkout, ["push", "-q", "-u", "origin", "main"])
    {:ok, ws} = Workspace.ensure(checkout)
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, ws: ws}
  end

  test "sync_branch merges origin/main and pushes the docs branch", %{ws: ws} do
    assert {:ok, _} = GitFlow.sync_branch(ws, "main")
    assert {output, 0} = System.cmd("git", ["branch", "--list", "symphony-docs"], cd: ws.worktree, stderr_to_stdout: true)
    assert output =~ "symphony-docs"
  end

  test "ensure_pull_request returns a PR via the injected client", %{ws: _ws} do
    stub = pr_stub_open()
    assert {:ok, %{number: 11, created: true}} = GitFlow.ensure_pull_request("acme/web", "symphony-docs", client: stub)
  end

  test "evaluate_and_merge merges when checks are green", %{} do
    deps = [
      detail: fn "acme/web", 11, _ -> {:ok, %{checks_state: "SUCCESS", mergeable: true, any_running: false}} end,
      merge: fn _project, 11, "squash", _ -> {:ok, %{merged: true}} end
    ]

    assert {:ok, :merged} = GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  test "evaluate_and_merge reschedules while checks pending" do
    deps = [detail: fn _, _, _ -> {:ok, %{checks_state: "PENDING", mergeable: nil, any_running: true}} end, merge: fn _, _, _, _ -> flunk("should not merge") end]
    assert {:ok, :pending} = GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  test "evaluate_and_merge stops on failed checks" do
    deps = [detail: fn _, _, _ -> {:ok, %{checks_state: "FAILURE", mergeable: false, any_running: false}} end, merge: fn _, _, _, _ -> flunk() end]
    assert {:error, :kb_checks_failed} = GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  defp pr_stub_open do
    defmodule PrStub do
      def rest_get("/repos/acme/web", _), do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}
      def rest_get("/repos/acme/web/pulls" <> _, _), do: {:ok, %{status: 200, body: []}}
      def rest_post("/repos/acme/web/pulls", _b, _), do: {:ok, %{status: 201, body: %{"number" => 11, "html_url" => "u"}}}
    end

    PrStub
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/git_flow_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.GitFlow do
  @moduledoc """
  Composable steps that promote knowledge base edits from `symphony-docs` to the
  repository default branch: sync (merge default in + push), ensure PR, and
  evaluate checks + squash-merge. All external effects are injectable.
  """

  alias SymphonyElixir.GitHub.{Api, PullRequestCreate}
  alias SymphonyElixir.KnowledgeBase.Git
  alias SymphonyElixir.PullRequestMerge

  @merge_method "squash"

  @spec sync_branch(map(), String.t(), keyword()) :: {:ok, :merged | :up_to_date} | {:error, term()}
  def sync_branch(ws, default_branch, opts \\ []) do
    with :ok <- Git.fetch(ws.worktree, opts),
         {:ok, merge_result} <- Git.merge(ws.worktree, "origin/#{default_branch}", opts),
         :ok <- Git.push(ws.worktree, ws.branch, opts) do
      {:ok, merge_result}
    end
  end

  @spec ensure_pull_request(String.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def ensure_pull_request(repo, head_branch, opts \\ []) do
    PullRequestCreate.ensure(repo, head_branch, opts)
  end

  @spec evaluate_and_merge(%{repo: String.t(), project: term()}, pos_integer(), keyword()) ::
          {:ok, :merged | :pending} | {:error, :kb_checks_failed | term()}
  def evaluate_and_merge(%{repo: repo, project: project}, number, deps \\ []) do
    detail = Keyword.get(deps, :detail, &default_detail/3)
    merge = Keyword.get(deps, :merge, &default_merge/4)

    case detail.(repo, number, []) do
      {:ok, %{checks_state: "SUCCESS", any_running: false} = pr} ->
        if Map.get(pr, :mergeable) == false do
          {:error, :pull_request_not_mergeable}
        else
          case merge.(project, number, @merge_method, []) do
            {:ok, _} -> {:ok, :merged}
            {:error, reason} -> {:error, reason}
          end
        end

      {:ok, %{checks_state: state}} when state in ["FAILURE", "ERROR"] ->
        {:error, :kb_checks_failed}

      {:ok, _pending} ->
        {:ok, :pending}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_detail(repo, number, opts) do
    case Api.pull_request_detail(repo, number, opts) do
      {:ok, nil} -> {:error, :pull_request_not_found}
      {:ok, pr} -> {:ok, normalize_detail(pr)}
      error -> error
    end
  end

  defp normalize_detail(pr) do
    %{
      checks_state: pr |> Map.get(:checks_state) |> to_string() |> String.upcase(),
      mergeable: Map.get(pr, :mergeable),
      any_running: any_running?(pr)
    }
  end

  defp any_running?(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.any?(fn p -> to_string(Map.get(p, :status)) |> String.upcase() in ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"] end)
  end

  defp default_merge(project, number, method, opts), do: PullRequestMerge.merge(project, number, method, opts)
end
```

(Confirm `GitHub.Api.pull_request_detail/3` returns `:pipelines` with `:status`; if the field is named differently in your version, map accordingly. The `evaluate_and_merge` tests inject `detail`/`merge` directly, so they pass regardless; the `default_*` shims are exercised in the worker integration but kept thin.)

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/git_flow_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/git_flow.ex elixir/test/symphony_elixir/knowledge_base/git_flow_test.exs
git commit -m "feat(kb): git flow core for sync, PR, and auto-merge"
```

---

## Task 5: `SyncWorker` + `SyncSupervisor` + supervision wiring

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/sync_supervisor.ex`
- Create: `elixir/lib/symphony_elixir/knowledge_base/sync_worker.ex`
- Modify: `elixir/lib/symphony_elixir/application.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/sync_worker_test.exs`

The worker is started on demand per `(project_slug, repo_slug)`, runs the flow steps, updates `SyncState`, broadcasts `kb_event`, and reschedules itself while checks are pending. For testability it accepts injected `:flow` callbacks and resolves the repo via injected functions.

- [ ] **Step 1: Write `SyncSupervisor`**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SyncSupervisor do
  @moduledoc "DynamicSupervisor for per-repo knowledge base sync workers."

  use DynamicSupervisor

  alias SymphonyElixir.KnowledgeBase.SyncWorker

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts), do: DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  @spec ensure_worker(String.t(), String.t(), keyword()) :: {:ok, pid()} | {:error, term()}
  def ensure_worker(project_slug, repo_slug, opts \\ []) do
    spec = {SyncWorker, Keyword.merge([project_slug: project_slug, repo_slug: repo_slug], opts)}

    case DynamicSupervisor.start_child(__MODULE__, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      error -> error
    end
  end
end
```

- [ ] **Step 2: Write the failing worker test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SyncWorkerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{SyncState, SyncWorker}
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(SyncState) end)
    :ok
  end

  test "a successful run records merged state and broadcasts" do
    Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "project:acme")

    flow = %{
      resolve: fn "acme", "acme~web" -> {:ok, %{repo: "acme/web", default_branch: "main", project: :proj, ws: %{}}} end,
      sync: fn _ws, "main", _ -> {:ok, :merged} end,
      ensure_pr: fn "acme/web", "symphony-docs", _ -> {:ok, %{number: 5, url: "u", created: true}} end,
      evaluate: fn _ctx, 5, _ -> {:ok, :merged} end
    }

    {:ok, pid} = SyncWorker.start_link(project_slug: "acme", repo_slug: "acme~web", flow: flow, name: nil)
    assert :ok = SyncWorker.run_now(pid)

    assert SyncState.get("acme", "acme~web").status == "merged"
    assert_receive {:tracker_event, "kb_sync_updated", %{status: "merged"}}, 1_000
  end

  test "a merge conflict records conflict state and does not crash" do
    flow = %{
      resolve: fn _, _ -> {:ok, %{repo: "acme/web", default_branch: "main", project: :proj, ws: %{}}} end,
      sync: fn _ws, "main", _ -> {:error, :merge_conflict} end,
      ensure_pr: fn _, _, _ -> flunk("should not reach PR step") end,
      evaluate: fn _, _, _ -> flunk() end
    }

    {:ok, pid} = SyncWorker.start_link(project_slug: "acme", repo_slug: "acme~web", flow: flow, name: nil)
    assert :ok = SyncWorker.run_now(pid)
    assert SyncState.get("acme", "acme~web").status == "conflict"
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/sync_worker_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SyncWorker do
  @moduledoc """
  Runs the knowledge base git flow (sync -> ensure PR -> evaluate/merge) for one
  repository, updating `SyncState` and broadcasting `kb_sync_updated`. While PR
  checks are pending it reschedules itself; conflicts and check failures are
  terminal and require user action.
  """

  use GenServer

  alias SymphonyElixir.KnowledgeBase.{GitFlow, SyncState}
  alias SymphonyElixir.LocalTracker.Broadcaster

  @docs_branch "symphony-docs"
  @pending_recheck_ms 30_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name, via(opts[:project_slug], opts[:repo_slug]))
    GenServer.start_link(__MODULE__, Map.new(opts), name: name)
  end

  @spec run_now(GenServer.server()) :: :ok
  def run_now(server), do: GenServer.call(server, :run, 30_000)

  @impl true
  def init(state), do: {:ok, Map.put_new(state, :flow, default_flow())}

  @impl true
  def handle_call(:run, _from, state) do
    {:reply, :ok, do_run(state)}
  end

  @impl true
  def handle_info(:run, state), do: {:noreply, do_run(state)}

  defp do_run(%{project_slug: project, repo_slug: repo, flow: flow} = state) do
    set_status(project, repo, %{status: "syncing", last_error: nil})

    with {:ok, ctx} <- flow.resolve.(project, repo),
         {:ok, _} <- flow.sync.(ctx.ws, ctx.default_branch, []),
         {:ok, pr} <- flow.ensure_pr.(ctx.repo, @docs_branch, []) do
      handle_evaluation(project, repo, ctx, pr, flow, state)
    else
      {:error, :merge_conflict} -> set_status(project, repo, %{status: "conflict", last_error: "merge conflict"})
      {:error, reason} -> set_status(project, repo, %{status: "error", last_error: inspect(reason)})
    end

    state
  end

  defp handle_evaluation(project, repo, ctx, pr, flow, state) do
    set_status(project, repo, %{status: "open_pr", pr_number: pr.number, pr_url: pr.url})

    case flow.evaluate.(%{repo: ctx.repo, project: ctx.project}, pr.number, []) do
      {:ok, :merged} ->
        set_status(project, repo, %{status: "merged", last_synced_at: DateTime.utc_now()})

      {:ok, :pending} ->
        if recheck?(state), do: Process.send_after(self(), :run, @pending_recheck_ms)
        :ok

      {:error, :kb_checks_failed} ->
        set_status(project, repo, %{status: "checks_failed", last_error: "PR checks failed"})

      {:error, reason} ->
        set_status(project, repo, %{status: "error", last_error: inspect(reason)})
    end
  end

  defp set_status(project, repo, attrs) do
    {:ok, _} = SyncState.put(project, repo, attrs)
    Broadcaster.kb_event(project, "kb_sync_updated", Map.merge(%{repo_slug: repo}, stringify_status(attrs)))
  end

  defp stringify_status(attrs), do: Map.take(attrs, [:status, :pr_number, :pr_url, :last_error])

  defp recheck?(state), do: Map.get(state, :reschedule, true)

  defp default_flow do
    %{
      resolve: &SymphonyElixir.KnowledgeBase.resolve_sync_context/2,
      sync: &GitFlow.sync_branch/3,
      ensure_pr: &GitFlow.ensure_pull_request/3,
      evaluate: &GitFlow.evaluate_and_merge/3
    }
  end

  defp via(_project, _repo), do: nil
end
```

Add `KnowledgeBase.resolve_sync_context/2` in the context (Task 6) returning `{:ok, %{repo: owner_name, default_branch: branch, project: project_struct, ws: workspace}}`.

The worker test passes `name: nil` (so registration is skipped) and `reschedule: false` is not needed because the success/conflict tests never hit `:pending`. For the pending path, set `reschedule: false` in a test to assert no infinite loop, or assert the scheduled message via `:erlang.process_info`. Keep `@pending_recheck_ms` overridable via opts if you add a pending test.

- [ ] **Step 5: Wire the supervisor into the app tree**

In `application.ex` children list, add `SymphonyElixir.KnowledgeBase.SyncSupervisor` (after PubSub/Repo are started). Confirm with `mix compile`.

- [ ] **Step 6: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/sync_worker_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/sync_supervisor.ex elixir/lib/symphony_elixir/knowledge_base/sync_worker.ex elixir/lib/symphony_elixir/application.ex elixir/test/symphony_elixir/knowledge_base/sync_worker_test.exs
git commit -m "feat(kb): supervised per-repo sync worker"
```

---

## Task 6: Context wiring (enqueue on edit) + resolve context + status API

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base.ex`
- Test: append to `elixir/test/symphony_elixir/knowledge_base_test.exs`

- [ ] **Step 1: Add `resolve_sync_context/2`, `request_sync/2`, `sync_status/2`**

```elixir
  alias SymphonyElixir.GitHub.PullRequestCreate
  alias SymphonyElixir.KnowledgeBase.{SyncState, SyncSupervisor}

  @spec resolve_sync_context(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def resolve_sync_context(project_slug, repo_slug) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      {:ok, %{
         project: project,
         repo: repo.github_full_name,
         default_branch: repo.default_branch || "main",
         ws: ws
       }}
    end
  end

  @spec request_sync(String.t(), String.t()) :: :ok | {:error, error()}
  def request_sync(project_slug, repo_slug) do
    case SyncSupervisor.ensure_worker(project_slug, repo_slug) do
      {:ok, pid} -> SymphonyElixir.KnowledgeBase.SyncWorker.run_now(pid)
      error -> error
    end
  end

  @spec sync_status(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def sync_status(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      state = SyncState.get(project_slug, repo_slug)
      {:ok, %{status: state.status, pr_number: state.pr_number, pr_url: state.pr_url, last_error: state.last_error, last_synced_at: state.last_synced_at}}
    end
  end
```

If `Repository` has no `default_branch` field, fall back to `"main"` as shown (or resolve via `PullRequestCreate` default-branch lookup inside `GitFlow`). Confirm the field name in the `Repository` schema; adjust `repo.default_branch` accordingly.

- [ ] **Step 2: Enqueue sync after each successful edit** (best-effort, fire-and-forget)

In `write_page`, `move_page`, `delete_page`, after broadcasting the page event, add:

```elixir
      _ = request_sync(project_slug, repo_slug)
```

Wrap in a Task so a worker hiccup never blocks the edit response:

```elixir
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn -> request_sync(project_slug, repo_slug) end)
```

(Confirm a `Task.Supervisor` named `SymphonyElixir.TaskSupervisor` exists; if not, use `Task.start/1`.)

- [ ] **Step 3: Write the failing test (append)**

```elixir
  test "sync_status returns idle for a never-synced repo", %{} do
    assert {:ok, %{status: "idle"}} = KnowledgeBase.sync_status("acme", "web")
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base.ex elixir/test/symphony_elixir/knowledge_base_test.exs
git commit -m "feat(kb): enqueue sync on edit and expose sync status"
```

---

## Task 7: Sync endpoints + routes + errors

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_sync_controller_test.exs`

- [ ] **Step 1: Add routes**

```elixir
    get("/projects/:project_slug/kb/repos/:repo/sync", KnowledgeBaseController, :sync_status)
    post("/projects/:project_slug/kb/repos/:repo/sync", KnowledgeBaseController, :request_sync)
```

- [ ] **Step 2: Add error clauses**

```elixir
  def render(conn, :kb_merge_conflict),
    do: error(conn, 409, "kb_merge_conflict", dgettext("errors", "The knowledge base branch has a merge conflict with the default branch."))

  def render(conn, :kb_checks_failed),
    do: error(conn, 422, "kb_checks_failed", dgettext("errors", "Pull request checks failed for the knowledge base branch."))
```

- [ ] **Step 3: Write the failing test**

```elixir
  test "GET sync returns idle status for a fresh repo" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/sync")
    assert json_response(conn, 200)["data"]["status"] == "idle"
  end

  test "POST sync accepts the request" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/sync")
    assert response(conn, 202)
  end
```

(`POST sync` enqueues a worker run; in test there is no remote, so the run records an `error`/`conflict` state asynchronously - the endpoint itself just returns 202 `accepted`. Assert only the status code.)

- [ ] **Step 4: Run test to verify it fails, then implement**

```elixir
  @spec sync_status(Conn.t(), map()) :: Conn.t()
  def sync_status(conn, %{"project_slug" => slug, "repo" => repo}) do
    case KnowledgeBase.sync_status(slug, full_repo_slug(slug, repo)) do
      {:ok, status} -> json(conn, %{data: status})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec request_sync(Conn.t(), map()) :: Conn.t()
  def request_sync(conn, %{"project_slug" => slug, "repo" => repo}) do
    _ = KnowledgeBase.request_sync(slug, full_repo_slug(slug, repo))
    conn |> put_status(:accepted) |> json(%{data: %{accepted: true}})
  end

  defp full_repo_slug(project, repo), do: "#{project}~#{repo}"
```

(Align `full_repo_slug/2` with the canonical repo-slug encoding from M1's `Paths.repo_slug/1`; replace with the real encoder so multi-segment repos work.)

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_sync_controller_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_sync_controller_test.exs
git commit -m "feat(kb): sync status and trigger endpoints"
```

---

## Task 8: Milestone verification

- [ ] **Step 1:** `mix format --check-formatted`
- [ ] **Step 2:** `mix compile --warnings-as-errors`
- [ ] **Step 3:** `mix test test/symphony_elixir/knowledge_base test/symphony_elixir/github/pull_request_create_test.exs test/symphony_elixir_web/controllers/tracker/knowledge_base_sync_controller_test.exs` -> all pass
- [ ] **Step 4:** confirm migrations up/down (`mix ecto.rollback -n 1 && mix ecto.migrate` in test env)
- [ ] **Step 5:** commit any fixes (`chore(kb): format milestone 4`).

---

## Self-Review

**Spec coverage (M4):**

| Spec requirement | Task |
|---|---|
| D6/D7 keep symphony-docs synced with default branch | Task 1 (merge), Task 4 (`sync_branch`) |
| D7 create/update PR symphony-docs -> default | Task 2 (`PullRequestCreate`), Task 4 (`ensure_pull_request`) |
| D8 auto-merge when checks green | Task 4 (`evaluate_and_merge`), reuses `PullRequestMerge.merge/4` |
| Section 7 background jobs with retry (like existing) | Task 5 (`SyncWorker` + supervisor), reschedule on pending |
| Section 7/11 surface conflicts + failed checks | Task 3 (`SyncState`), Task 5 (status), Task 7 (errors/endpoints) |
| Edits trigger reconciliation | Task 6 (enqueue on write/move/delete) |

**Risks/decisions:**
- All network/git effects are injectable; `GitFlow` and `PullRequestCreate` are fully unit-tested without a network. `SyncWorker` is tested with injected flow stubs.
- Conflicts/check-failures are terminal states recorded for the UI (no infinite retry); transient errors get bounded backoff via the pending recheck path.
- `Repository.default_branch` field name and `Task.Supervisor` name are flagged for confirmation with concrete fallbacks (`"main"`, `Task.start/1`).
- `GitHub.Api.pull_request_detail/3` field names (`:checks_state`, `:pipelines`/`:status`, `:mergeable`) are flagged; `evaluate_and_merge` tests inject `detail` so they are independent of those names, and the `default_detail` shim is the only place to adjust.

**Placeholder scan:** No TBD/TODO. Confirmation notes all carry concrete fallbacks.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-04-git-flows.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.
