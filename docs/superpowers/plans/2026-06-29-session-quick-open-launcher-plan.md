# Session / Run Quick-Open Launcher (Plan A) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Mirror Jean's tabbed **"New Session"** modal — a global, command-palette-style launcher that lets the operator start (or jump into) an agent run from a source. v1 (CORE) ships four source tabs — **Actions**, **Issues**, **PRs**, **Branches** — each a searchable list whose selection deep-links into an issue's Agent → Execution view (or dispatches a run), with a "hold ⌥/Alt to open in background" affordance.

**Architecture:** A single self-contained `<SessionQuickOpenLauncher>` (built on the already-vendored `cmdk` primitives, exactly like `BoardPaletteShortcuts.tsx`) renders a tab header + one `cmdk` list per active tab. A pure `launcherSources.ts` module defines the item model, fuzzy + exact-number filtering, and the **client-side** branch→issue index (using `Issue.branchName`). A `useLauncherData(projectSlug, activeTab, query)` hook fans out to existing data sources (`listIssues`, `useAgentExecutions`) and **two new lightweight project-scoped backend endpoints** (open PRs + repo branches), because Symphony's existing PR/branch reads are issue-scoped. Symphony is issue-centric, so every source maps to an existing issue → `dispatchIssueAgent` / Agent→Execution deep-link; sources with no clean issue mapping degrade to a "start from branch / open externally" stub. The launcher mounts globally in `WorkspaceChrome` and opens on a distinct, collision-free shortcut (`mod+j`).

**Tech Stack:** React 19 + `cmdk` (`^1.1.1`) + `sonner` toasts + lucide + vitest; data hooks use the repo's plain `useState`/`useEffect`/`useRef` fetch pattern (cf. `tracker/src/hooks/useAgentExecutions.ts` and `useIssueCommitEvidence.ts`) — **this repo ships no external data-query/cache library**; Phoenix JSON controllers + ExUnit; GitHub reads via `GitHub.Client.rest_get` behind `GitHub.ReadCache`.

---

**Depends on / relates to:**
- **Plan 2b** — `2026-06-26-execution-control-mentions-shortcuts-plan.md` (`@`-mention data services + the `cmdk` `ui/command.tsx` wrapper + `commandPaletteScope.ts` overlay coordinator). **Verified state:** as of this writing those files are *not yet on disk* (2b is a sibling plan, not shipped), so this plan stays **self-contained**: it imports `cmdk` named exports directly (the pattern `BoardPaletteShortcuts.tsx:1` already uses today) and builds its own data hooks on the shipped `listIssues`. Integration note (do, when 2b lands): swap the direct `cmdk` import for `@/components/ui/command` and wrap open/close with `acquireOverlayPalette`/`isOverlayPaletteActive` from `tracker/src/lib/commandPaletteScope.ts` to coordinate `Esc`/stacking with the `⌘K` board palette. `mod+j` never collides with `⌘K`, so this is a refinement, not a blocker.
- **Plan 4 sessions panel** — `2026-06-26-project-sessions-panel-plan.md`. The launcher deep-links/jumps into runs exactly like the sessions panel does (`issueAgentTabPath(slug, view, id, "execution")` + quick-resume via `dispatchIssueAgent`). Reuses the live `AgentExecution` projection (`useAgentExecutions`) for per-item status dots.
- **`ui/command.tsx` / `ui/tabs.tsx`** — `ui/tabs.tsx` (Radix) ships today; `ui/command.tsx` is a 2b artifact (see above). v1 uses `cmdk` directly + a lightweight button tab-bar.

**Jean references (UX mirror):**
- `src/components/worktree/NewWorktreeModal.tsx` — the tabbed "new session" modal shell → our `SessionQuickOpenLauncher.tsx`.
- `src/components/worktree/NewWorktreeItems.tsx` — shared item rows → our `LauncherItemRow` rendering inside `CommandItem`.
- `src/components/worktree/QuickActionsTab.tsx` (Actions), `GitHubIssuesTab.tsx` (Issues), `GitHubPRsTab.tsx` (PRs), `BranchesTab.tsx` (Branches) → our four `LauncherTab` data sources.
- `src/components/worktree/IssuePreviewModal.tsx` — preview-before-launch → noted as a v1.x extension (see "v2 / later extension points").
- `src/components/command-palette/CommandPalette.tsx` — the global launcher pattern → mirrored by mounting globally + a `mod+j` keybinding.
- **v2 only:** `src/components/worktree/SecurityAlertsTab.tsx`, `src/components/worktree/LinearIssuesTab.tsx` (deferred — see "v2 / later extension points").

**Verified Symphony anchors built on:**
- Dispatch a run: `tracker/src/services/issueDispatch.ts` `dispatchIssueAgent(slug, identifier, { action })` (`action: "resume" | "restart" | "hard_reset" | "stop" | "continue_work"`); backend `SymphonyElixir.IssueDispatch` via `POST /projects/:project_slug/issues/:identifier/dispatch` (`router.ex:122`).
- Issues source: `tracker/src/services/issues.ts` `listIssues(projectSlug, { search })` → `GET /projects/:slug/issues?q=` (`router.ex:118`). `Issue.branchName` (`types/issue.ts:79`) powers the client-side branch→issue map.
- Sessions/status: `useAgentExecutions()` (`hooks/useAgentExecutions.ts`) + `listAgentExecutions()` (`services/agentExecutions.ts`) over global `GET /agent_executions` (`router.ex:83`); `AgentExecution.status` (`types/agent-execution.ts:1-8`).
- Deep-link helpers: `tracker/src/lib/workspaceRoutes.ts` — `issuePath`, `withAgentSection`, `issueAgentTabPath(slug, view, id, "execution")` (`:191`), `projectSectionPath`, `newIssuePath`, `filtersPath`, `assistantPath`, `viewFromPathname`.
- `cmdk` palette pattern: `tracker/src/components/board/BoardPaletteShortcuts.tsx` (named `cmdk` imports, `window` keydown with input guard, `CommandDialog`/`Command`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`).
- Fuzzy match: `tracker/src/lib/pickerOptions.ts` `matchesPickerSearch(query, ...parts)`.
- Global mount point: `tracker/src/components/layout/ProjectWorkspaceLayout.tsx` `WorkspaceChrome`.
- Backend PR data is **issue-scoped only** (`GitHub.PullRequests.for_project_issue/3`, `PullRequestController.index`); there is **no** project-wide open-PR or branch list → Task 1 + Task 2 add the smallest project-scoped endpoints, mirroring `GitHubController` (`github_controller.ex`) and `PullRequestController` resolution (`Context.get_project` → `IssueRepo.candidate_repos(project, "")` → `RepoSpec.split` → `GitHub.Client.rest_get` behind `GitHub.ReadCache`).

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/github/project_pull_requests.ex` — `list_open/2`: open PRs across a project's configured repos via GitHub search, annotated with a best-effort tracker `issue_identifier` (from the `Symphony-Issue:` marker). Pure-ish; one search call per repo, capped.
- `elixir/lib/symphony_elixir/github/branches.ex` — `list_for_project/2`: repo branches across configured repos via REST `GET /repos/:owner/:repo/branches`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/project_pull_request_controller.ex` — `index/2`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/branch_controller.ex` — `index/2`.
- Tests: `elixir/test/symphony_elixir/github/project_pull_requests_test.exs`, `elixir/test/symphony_elixir/github/branches_test.exs`, `elixir/test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs`, `elixir/test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir_web/router.ex` — add `GET /projects/:project_slug/pull_requests` and `GET /projects/:project_slug/branches` inside the `:tracker_api` scope.

**Create (tracker):**
- `tracker/src/services/projectPullRequests.ts` — `listProjectPullRequests(projectSlug)`.
- `tracker/src/services/projectBranches.ts` — `listProjectBranches(projectSlug)`.
- `tracker/src/hooks/useDebouncedValue.ts` — small shared debounce hook (Task 6; no generic one exists today).
- `tracker/src/types/launcher.ts` — shared launcher types.
- `tracker/src/components/launcher/launcherSources.ts` — pure model: `LAUNCHER_TABS`, `QUICK_ACTIONS`, `filterLauncherItems`, `buildBranchIssueIndex`, `resolveBranchIssue`.
- `tracker/src/components/launcher/useLauncherData.ts` — per-tab data hook.
- `tracker/src/components/launcher/LauncherItemRow.tsx` — one item row (icon + title + subtitle + status dot + alt hint).
- `tracker/src/components/launcher/SessionQuickOpenLauncher.tsx` — the `cmdk` dialog + tab bar + lists + select handlers + `mod+j` keydown.
- Tests: `tracker/src/services/__tests__/projectPullRequests.test.ts`, `tracker/src/services/__tests__/projectBranches.test.ts`, `tracker/src/components/launcher/__tests__/launcherSources.test.ts`, `tracker/src/components/launcher/__tests__/useLauncherData.test.tsx`, `tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`.

**Modify (tracker):**
- `tracker/src/components/layout/ProjectWorkspaceLayout.tsx` — mount `<SessionQuickOpenLauncher />` globally in `WorkspaceChrome`.
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — add a top-level `launcher` block.

---

## Task 1: Backend — project open-PRs source + endpoint

**Files:**
- Create: `elixir/lib/symphony_elixir/github/project_pull_requests.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/project_pull_request_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir/github/project_pull_requests_test.exs`, `elixir/test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs`

Symphony has no project-wide open-PR read (only `for_project_issue/3`). We add a thin module that runs one GitHub **search** per configured repo (`repo:<owner>/<name> is:pr is:open`) and annotates each hit with a best-effort tracker `issue_identifier` derived from the `Symphony-Issue:` marker in the PR body (`GitHub.IssueMarker.extract/2`). Repos come from `IssueRepo.candidate_repos(project, "")` (same source `PullRequests.supported?/1` uses). Reads go through `GitHub.ReadCache` (60s TTL) so the launcher does not hammer the API.

- [ ] **Step 1: Write failing test for `ProjectPullRequests.list_open/2`**

```elixir
# elixir/test/symphony_elixir/github/project_pull_requests_test.exs
defmodule SymphonyElixir.GitHub.ProjectPullRequestsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.ProjectPullRequests

  defmodule FakeClient do
    @moduledoc false
    # `search_issues/2` shape mirrors GitHub's REST /search/issues payload.
    def rest_get("/search/issues?" <> _qs = _path, _opts) do
      {:ok,
       %{
         status: 200,
         body: %{
           "items" => [
             %{
               "number" => 42,
               "title" => "Fix login",
               "html_url" => "https://github.com/o/r/pull/42",
               "pull_request" => %{"html_url" => "https://github.com/o/r/pull/42"},
               "user" => %{"login" => "codex-bot"},
               "updated_at" => "2026-06-20T10:00:00Z",
               "body" => "Symphony-Issue: DEMO-7\n\nfixes things"
             }
           ]
         }
       }}
    end
  end

  test "lists open PRs across repos, annotated with the tracker issue identifier" do
    prs =
      ProjectPullRequests.list_open(["o/r"],
        client_module: FakeClient,
        marker_key: "Symphony-Issue"
      )

    assert [pr] = prs
    assert pr.number == 42
    assert pr.repo == "o/r"
    assert pr.url == "https://github.com/o/r/pull/42"
    assert pr.title == "Fix login"
    assert pr.author == "codex-bot"
    assert pr.issue_identifier == "DEMO-7"
  end

  test "returns [] and never raises when a repo search fails" do
    failing = fn _path, _opts -> {:error, :boom} end
    assert ProjectPullRequests.list_open(["o/r"], rest_get_fun: failing) == []
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/github/project_pull_requests_test.exs -o`
Expected: FAIL with `module SymphonyElixir.GitHub.ProjectPullRequests is not available`.

- [ ] **Step 3: Implement `ProjectPullRequests`**

```elixir
# elixir/lib/symphony_elixir/github/project_pull_requests.ex
defmodule SymphonyElixir.GitHub.ProjectPullRequests do
  @moduledoc """
  Project-scoped open pull request listing for the Quick-Open launcher.

  Runs one GitHub search per configured repo (`repo:<owner>/<name> is:pr
  is:open`) and annotates each hit with a best-effort tracker issue identifier
  derived from the `Symphony-Issue:` marker in the PR body. Read-only; capped.
  """

  alias SymphonyElixir.GitHub.{Client, IssueMarker, RepoSpec}

  require Logger

  @per_repo_limit 30

  @type pull_request :: %{
          number: integer(),
          title: String.t() | nil,
          url: String.t() | nil,
          repo: String.t(),
          author: String.t() | nil,
          updated_at: String.t() | nil,
          issue_identifier: String.t() | nil
        }

  @spec list_open([String.t()], keyword()) :: [pull_request()]
  def list_open(repos, opts \\ []) when is_list(repos) do
    marker_key = Keyword.get(opts, :marker_key, IssueMarker.default_key())

    repos
    |> Enum.flat_map(&search_repo(&1, marker_key, opts))
    |> Enum.uniq_by(& &1.url)
    |> Enum.sort_by(& &1.updated_at, &>=/2)
  end

  defp search_repo(repo, marker_key, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         query = ~s(repo:#{owner}/#{name} is:pr is:open),
         path = "/search/issues?" <> URI.encode_query(%{"q" => query, "per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: %{"items" => items}}} when is_list(items) <- rest_get(path, opts) do
      Enum.flat_map(items, &normalize(&1, repo, marker_key))
    else
      {:error, reason} ->
        Logger.debug("ProjectPullRequests search failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize(%{"number" => number} = item, repo, marker_key)
       when is_integer(number) and number > 0 do
    [
      %{
        number: number,
        title: string_or_nil(item["title"]),
        url: pr_url(item),
        repo: repo,
        author: get_in(item, ["user", "login"]),
        updated_at: string_or_nil(item["updated_at"]),
        issue_identifier: marker_identifier(item["body"], marker_key)
      }
    ]
  end

  defp normalize(_item, _repo, _marker_key), do: []

  defp pr_url(item) do
    case get_in(item, ["pull_request", "html_url"]) do
      url when is_binary(url) and url != "" -> url
      _ -> string_or_nil(item["html_url"])
    end
  end

  defp marker_identifier(body, marker_key) when is_binary(body) do
    case IssueMarker.extract(body, marker_key) do
      [identifier | _] when is_binary(identifier) -> identifier
      _ -> nil
    end
  end

  defp marker_identifier(_body, _marker_key), do: nil

  defp rest_get(path, opts) do
    case Keyword.get(opts, :rest_get_fun) do
      fun when is_function(fun, 2) -> fun.(path, [])
      _ -> client_module(opts).rest_get(path, [])
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      module when is_atom(module) and not is_nil(module) -> module
      _ -> Application.get_env(:symphony_elixir, :github_client_module, Client)
    end
  end

  defp string_or_nil(value) when is_binary(value) and value != "", do: value
  defp string_or_nil(_value), do: nil
end
```

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/github/project_pull_requests_test.exs -o`
Expected: PASS (2 tests).

- [ ] **Step 5: Write failing controller test**

```elixir
# elixir/test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs
defmodule SymphonyElixirWeb.Tracker.ProjectPullRequestControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeClient do
    @moduledoc false
    def rest_get("/search/issues?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: %{
           "items" => [
             %{
               "number" => 9,
               "title" => "Add cache",
               "html_url" => "https://github.com/o/r/pull/9",
               "pull_request" => %{"html_url" => "https://github.com/o/r/pull/9"},
               "user" => %{"login" => "octocat"},
               "updated_at" => "2026-06-21T09:00:00Z",
               "body" => "Symphony-Issue: ADV-2"
             }
           ]
         }
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    ReadCache.invalidate_all()
    Application.put_env(:symphony_elixir, :github_client_module, FakeClient)

    prev_token = System.get_env(@token_env)
    prev_gh = System.get_env(@github_token_env)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      restore_env(@token_env, prev_token)
      restore_env(@github_token_env, prev_gh)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Advising",
        "slug" => "advising-pr-list",
        "tracker" => %{"kind" => "jira", "config" => %{"project_key" => "ADV"}},
        "repositories" => [
          %{
            "github_full_name" => "o/r",
            "clone_url" => "https://github.com/o/r.git",
            "role" => "primary",
            "workspace_path" => "r"
          }
        ],
        "setup" => %{}
      })

    {:ok, project: project}
  end

  test "lists open PRs for the project with marker-derived issue identifiers" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/advising-pr-list/pull_requests")

    assert %{"data" => [pr], "supported" => true} = json_response(conn, 200)
    assert pr["number"] == 9
    assert pr["repo"] == "o/r"
    assert pr["issue_identifier"] == "ADV-2"
  end

  test "returns supported: false for projects with no repos" do
    {:ok, _} =
      Context.create_workspace_project(%{
        "name" => "Local",
        "slug" => "local-no-repo",
        "tracker" => %{"kind" => "local"},
        "repositories" => [],
        "setup" => %{}
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/local-no-repo/pull_requests")
    assert %{"data" => [], "supported" => false} = json_response(conn, 200)
  end

  # --- helpers (mirror pull_request_controller_test.exs) ---
  defp authorized_conn do
    build_conn()
    |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo, do: Ecto.Migrator.run(SymphonyElixir.Repo, :up, all: true)

  defp clean_repo do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Project)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
```

- [ ] **Step 6: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs -o`
Expected: FAIL (route/controller missing → 404 / `UndefinedFunctionError`).

- [ ] **Step 7: Implement controller + route**

```elixir
# elixir/lib/symphony_elixir_web/controllers/tracker/project_pull_request_controller.ex
defmodule SymphonyElixirWeb.Tracker.ProjectPullRequestController do
  @moduledoc "Project-scoped open pull request list for the Quick-Open launcher."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{IssueRepo, ProjectPullRequests, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          data =
            ReadCache.fetch({:project_open_prs, project.slug}, fn ->
              ProjectPullRequests.list_open(repos, marker_key: marker_key(project))
            end)

          json(conn, %{data: Enum.map(data, &present/1), supported: true})
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp present(pr) do
    %{
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: pr.repo,
      author: pr.author,
      updated_at: pr.updated_at,
      issue_identifier: pr.issue_identifier
    }
  end

  defp marker_key(project) do
    project
    |> ProjectConfig.resolve()
    |> ProjectConfig.source_control_issue_marker_key()
  rescue
    _ -> SymphonyElixir.GitHub.IssueMarker.default_key()
  end
end
```

Add the route in `elixir/lib/symphony_elixir_web/router.ex` inside the `scope "/api/tracker/v1" ... pipe_through(:tracker_api)` block, next to the issue PR routes (after `router.ex:152`):

```elixir
    get("/projects/:project_slug/pull_requests", ProjectPullRequestController, :index)
```

- [ ] **Step 8: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/github/project_pull_requests_test.exs test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs -o`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add elixir/lib/symphony_elixir/github/project_pull_requests.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/project_pull_request_controller.ex \
  elixir/lib/symphony_elixir_web/router.ex \
  elixir/test/symphony_elixir/github/project_pull_requests_test.exs \
  elixir/test/symphony_elixir_web/controllers/tracker/project_pull_request_controller_test.exs
git commit -m "feat(launcher): project-scoped open PR list endpoint"
```

---

## Task 2: Backend — project branches source + endpoint

**Files:**
- Create: `elixir/lib/symphony_elixir/github/branches.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/branch_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir/github/branches_test.exs`, `elixir/test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs`

**Decision (justified):** branches come from GitHub REST `GET /repos/:owner/:repo/branches` (via the existing authenticated `GitHub.Client.rest_get`), **not** `RunContract.repo_states/1`. `repo_states/1` inspects a single *issue workspace* path and only sees the branch that workspace has checked out — wrong granularity for "repo branches" and unavailable until an issue workspace exists. The REST list is project-level, works regardless of any workspace, and returns the full branch set in one call per repo.

- [ ] **Step 1: Write failing test for `Branches.list_for_project/2`**

```elixir
# elixir/test/symphony_elixir/github/branches_test.exs
defmodule SymphonyElixir.GitHub.BranchesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Branches

  defmodule FakeClient do
    @moduledoc false
    def rest_get("/repos/o/r/branches?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{"name" => "main", "protected" => true, "commit" => %{"sha" => "aaa"}},
           %{"name" => "codex/demo-7", "protected" => false, "commit" => %{"sha" => "bbb"}}
         ]
       }}
    end
  end

  test "lists branches across repos with repo + protection metadata" do
    branches = Branches.list_for_project(["o/r"], client_module: FakeClient)

    assert [%{name: "codex/demo-7", repo: "o/r", protected: false, commit_sha: "bbb"}, %{name: "main"}] =
             branches
  end

  test "never raises when a repo branch read fails" do
    failing = fn _path, _opts -> {:error, :boom} end
    assert Branches.list_for_project(["o/r"], rest_get_fun: failing) == []
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/github/branches_test.exs -o`
Expected: FAIL with `module SymphonyElixir.GitHub.Branches is not available`.

- [ ] **Step 3: Implement `Branches`**

```elixir
# elixir/lib/symphony_elixir/github/branches.ex
defmodule SymphonyElixir.GitHub.Branches do
  @moduledoc """
  Project-scoped repo branch listing for the Quick-Open launcher, via REST
  `GET /repos/:owner/:repo/branches`. Read-only; capped per repo.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  require Logger

  @per_repo_limit 100

  @type branch :: %{
          name: String.t(),
          repo: String.t(),
          protected: boolean(),
          commit_sha: String.t() | nil
        }

  @spec list_for_project([String.t()], keyword()) :: [branch()]
  def list_for_project(repos, opts \\ []) when is_list(repos) do
    repos
    |> Enum.flat_map(&list_repo(&1, opts))
    |> Enum.sort_by(& &1.name)
  end

  defp list_repo(repo, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         path = "/repos/#{owner}/#{name}/branches?" <> URI.encode_query(%{"per_page" => "#{@per_repo_limit}"}),
         {:ok, %{body: branches}} when is_list(branches) <- rest_get(path, opts) do
      Enum.flat_map(branches, &normalize(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("Branches list failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize(%{"name" => name} = node, repo) when is_binary(name) and name != "" do
    [
      %{
        name: name,
        repo: repo,
        protected: node["protected"] == true,
        commit_sha: get_in(node, ["commit", "sha"])
      }
    ]
  end

  defp normalize(_node, _repo), do: []

  defp rest_get(path, opts) do
    case Keyword.get(opts, :rest_get_fun) do
      fun when is_function(fun, 2) -> fun.(path, [])
      _ -> client_module(opts).rest_get(path, [])
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      module when is_atom(module) and not is_nil(module) -> module
      _ -> Application.get_env(:symphony_elixir, :github_client_module, Client)
    end
  end
end
```

- [ ] **Step 4: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/github/branches_test.exs -o`
Expected: PASS (2 tests).

- [ ] **Step 5: Write failing controller test**

```elixir
# elixir/test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs
defmodule SymphonyElixirWeb.Tracker.BranchControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeClient do
    @moduledoc false
    def rest_get("/repos/o/r/branches?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{"name" => "main", "protected" => true, "commit" => %{"sha" => "aaa"}},
           %{"name" => "codex/adv-2", "protected" => false, "commit" => %{"sha" => "bbb"}}
         ]
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    ReadCache.invalidate_all()
    Application.put_env(:symphony_elixir, :github_client_module, FakeClient)

    prev_token = System.get_env(@token_env)
    prev_gh = System.get_env(@github_token_env)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      restore_env(@token_env, prev_token)
      restore_env(@github_token_env, prev_gh)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Advising",
        "slug" => "advising-branches",
        "tracker" => %{"kind" => "jira", "config" => %{"project_key" => "ADV"}},
        "repositories" => [
          %{
            "github_full_name" => "o/r",
            "clone_url" => "https://github.com/o/r.git",
            "role" => "primary",
            "workspace_path" => "r"
          }
        ],
        "setup" => %{}
      })

    :ok
  end

  test "lists repo branches for the project" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/advising-branches/branches")

    assert %{"data" => data, "supported" => true} = json_response(conn, 200)
    names = Enum.map(data, & &1["name"])
    assert "codex/adv-2" in names
    assert "main" in names
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo, do: Ecto.Migrator.run(SymphonyElixir.Repo, :up, all: true)
  defp clean_repo, do: SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Project)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
```

- [ ] **Step 6: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs -o`
Expected: FAIL (route/controller missing).

- [ ] **Step 7: Implement controller + route**

```elixir
# elixir/lib/symphony_elixir_web/controllers/tracker/branch_controller.ex
defmodule SymphonyElixirWeb.Tracker.BranchController do
  @moduledoc "Project-scoped repo branch list for the Quick-Open launcher."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{Branches, IssueRepo, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          data =
            ReadCache.fetch({:project_branches, project.slug}, fn ->
              Branches.list_for_project(repos)
            end)

          json(conn, %{data: Enum.map(data, &present/1), supported: true})
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp present(branch) do
    %{name: branch.name, repo: branch.repo, protected: branch.protected, commit_sha: branch.commit_sha}
  end
end
```

Add the route in `elixir/lib/symphony_elixir_web/router.ex` (next to the Task 1 route):

```elixir
    get("/projects/:project_slug/branches", BranchController, :index)
```

- [ ] **Step 8: Run (expect pass)** — `cd elixir && mix test test/symphony_elixir/github/branches_test.exs test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs -o`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add elixir/lib/symphony_elixir/github/branches.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/branch_controller.ex \
  elixir/lib/symphony_elixir_web/router.ex \
  elixir/test/symphony_elixir/github/branches_test.exs \
  elixir/test/symphony_elixir_web/controllers/tracker/branch_controller_test.exs
git commit -m "feat(launcher): project-scoped repo branch list endpoint"
```

---

## Task 3: Tracker — project PR + branch services

**Files:**
- Create: `tracker/src/services/projectPullRequests.ts`, `tracker/src/services/projectBranches.ts`
- Test: `tracker/src/services/__tests__/projectPullRequests.test.ts`, `tracker/src/services/__tests__/projectBranches.test.ts`

Mirror `services/issues.ts` (use `http`, `trackerPath`, `unwrapData`, `requireProjectSlug`) and the test style of `services/__tests__/issues.test.ts` (spy on `http.get`).

- [ ] **Step 1: Write failing service tests**

```ts
// tracker/src/services/__tests__/projectPullRequests.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listProjectPullRequests } from "@/services/projectPullRequests";

describe("listProjectPullRequests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs the project PR list and normalizes snake_case", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            number: 9,
            title: "Add cache",
            url: "https://github.com/o/r/pull/9",
            repo: "o/r",
            author: "octocat",
            updated_at: "2026-06-21T09:00:00Z",
            issue_identifier: "ADV-2",
          },
        ],
        supported: true,
      },
    });

    const result = await listProjectPullRequests("advising");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/advising/pull_requests");
    expect(result).toEqual([
      {
        number: 9,
        title: "Add cache",
        url: "https://github.com/o/r/pull/9",
        repo: "o/r",
        author: "octocat",
        updatedAt: "2026-06-21T09:00:00Z",
        issueIdentifier: "ADV-2",
      },
    ]);
  });

  it("returns [] when the backend reports unsupported", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [], supported: false } });
    expect(await listProjectPullRequests("local")).toEqual([]);
  });
});
```

```ts
// tracker/src/services/__tests__/projectBranches.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listProjectBranches } from "@/services/projectBranches";

describe("listProjectBranches", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs the project branch list and normalizes snake_case", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [{ name: "codex/adv-2", repo: "o/r", protected: false, commit_sha: "bbb" }],
        supported: true,
      },
    });

    const result = await listProjectBranches("advising");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/advising/branches");
    expect(result).toEqual([{ name: "codex/adv-2", repo: "o/r", protected: false, commitSha: "bbb" }]);
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/services/__tests__/projectPullRequests.test.ts src/services/__tests__/projectBranches.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the services**

```ts
// tracker/src/services/projectPullRequests.ts
import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

export interface ProjectPullRequest {
  number: number;
  title: string | null;
  url: string | null;
  repo: string | null;
  author: string | null;
  updatedAt: string | null;
  issueIdentifier: string | null;
}

interface BackendProjectPullRequestDto {
  number: number;
  title?: string | null;
  url?: string | null;
  repo?: string | null;
  author?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
}

export async function listProjectPullRequests(projectSlug: string): Promise<ProjectPullRequest[]> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/pull_requests`));
  return unwrapData<BackendProjectPullRequestDto[]>(response).map(normalize);
}

function normalize(dto: BackendProjectPullRequestDto): ProjectPullRequest {
  return {
    number: dto.number,
    title: dto.title ?? null,
    url: dto.url ?? null,
    repo: dto.repo ?? null,
    author: dto.author ?? null,
    updatedAt: dto.updated_at ?? dto.updatedAt ?? null,
    issueIdentifier: dto.issue_identifier ?? dto.issueIdentifier ?? null,
  };
}
```

```ts
// tracker/src/services/projectBranches.ts
import { requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

export interface ProjectBranch {
  name: string;
  repo: string | null;
  protected: boolean;
  commitSha: string | null;
}

interface BackendProjectBranchDto {
  name: string;
  repo?: string | null;
  protected?: boolean | null;
  commit_sha?: string | null;
  commitSha?: string | null;
}

export async function listProjectBranches(projectSlug: string): Promise<ProjectBranch[]> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/branches`));
  return unwrapData<BackendProjectBranchDto[]>(response).map(normalize);
}

function normalize(dto: BackendProjectBranchDto): ProjectBranch {
  return {
    name: dto.name,
    repo: dto.repo ?? null,
    protected: dto.protected === true,
    commitSha: dto.commit_sha ?? dto.commitSha ?? null,
  };
}
```

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/services/__tests__/projectPullRequests.test.ts src/services/__tests__/projectBranches.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/projectPullRequests.ts tracker/src/services/projectBranches.ts \
  tracker/src/services/__tests__/projectPullRequests.test.ts tracker/src/services/__tests__/projectBranches.test.ts
git commit -m "feat(launcher): project PR + branch tracker services"
```

---

## Task 4: Tracker — launcher types + pure source model

**Files:**
- Create: `tracker/src/types/launcher.ts`, `tracker/src/components/launcher/launcherSources.ts`
- Test: `tracker/src/components/launcher/__tests__/launcherSources.test.ts`

This is the pure, framework-free core: the tab list, the curated Actions, fuzzy + exact-number filtering, and the client-side branch→issue index (using `Issue.branchName`). No React, no network — fully unit-testable.

**Curated Actions (data-driven, v1):** each maps to an **existing** `workspaceRoutes` helper, so no new routes are introduced. The list is an array so curated entries ("Open diff viewer", "Open command palette") can be appended later (the diff viewer is opened today via `ProjectEditorMenu`/`useProjectEditor`, which has no in-SPA route, so it is intentionally deferred to a v1.x action rather than faked here).

- [ ] **Step 1: Write failing test**

```ts
// tracker/src/components/launcher/__tests__/launcherSources.test.ts
import { describe, expect, it } from "vitest";

import {
  LAUNCHER_TABS,
  QUICK_ACTIONS,
  buildBranchIssueIndex,
  filterLauncherItems,
  resolveBranchIssue,
} from "@/components/launcher/launcherSources";
import type { LauncherItem } from "@/types/launcher";

const items: LauncherItem[] = [
  { kind: "issue", id: "DEMO-12", title: "Fix login bug", subtitle: "In Progress", searchTokens: ["DEMO-12", "Fix login bug", "12"] },
  { kind: "issue", id: "DEMO-3", title: "Dark mode", subtitle: "Todo", searchTokens: ["DEMO-3", "Dark mode", "3"] },
];

describe("LAUNCHER_TABS", () => {
  it("ships exactly the v1 CORE tabs in order", () => {
    expect(LAUNCHER_TABS.map((t) => t.id)).toEqual(["actions", "issues", "prs", "branches"]);
  });
});

describe("QUICK_ACTIONS", () => {
  it("are data-driven with unique ids and translation keys", () => {
    const ids = QUICK_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(QUICK_ACTIONS.every((a) => a.labelKey.startsWith("launcher.actions."))).toBe(true);
  });
});

describe("filterLauncherItems", () => {
  it("returns all items for a blank query", () => {
    expect(filterLauncherItems(items, "")).toHaveLength(2);
  });

  it("fuzzy-matches against title and identifier", () => {
    expect(filterLauncherItems(items, "login").map((i) => i.id)).toEqual(["DEMO-12"]);
  });

  it("supports exact-number lookup (the issue number suffix)", () => {
    expect(filterLauncherItems(items, "12").map((i) => i.id)).toEqual(["DEMO-12"]);
    // "3" must not match "DEMO-12" (no substring false positive on the number token)
    expect(filterLauncherItems(items, "3").map((i) => i.id)).toEqual(["DEMO-3"]);
  });
});

describe("branch → issue index", () => {
  it("maps a branch name to the issue whose branchName equals it", () => {
    const index = buildBranchIssueIndex([
      { identifier: "DEMO-12", branchName: "codex/demo-12", title: "Fix login bug" } as never,
      { identifier: "DEMO-3", branchName: null, title: "Dark mode" } as never,
    ]);

    expect(resolveBranchIssue(index, "codex/demo-12")?.identifier).toBe("DEMO-12");
    expect(resolveBranchIssue(index, "feature/orphan")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/launcher/__tests__/launcherSources.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the types + model**

```ts
// tracker/src/types/launcher.ts
export type LauncherTabId = "actions" | "issues" | "prs" | "branches";

export interface LauncherTabSpec {
  id: LauncherTabId;
  labelKey: string;
}

/** A normalized, renderable launcher row. `searchTokens` feed fuzzy + exact-number match. */
export interface LauncherItem {
  kind: LauncherTabId;
  /** Stable id: issue identifier, `pr:<repo>#<number>`, branch name, or action id. */
  id: string;
  title: string;
  subtitle?: string | null;
  /** Optional issue identifier this row maps to (PRs/branches → issue-centric action). */
  issueIdentifier?: string | null;
  /** External URL fallback when there is no issue mapping (PR/branch). */
  externalUrl?: string | null;
  searchTokens: string[];
}

export interface QuickAction {
  id: string;
  labelKey: string;
  /** Action handlers receive navigation context resolved in the launcher component. */
  run: (ctx: QuickActionContext) => void;
}

export interface QuickActionContext {
  projectSlug: string;
  navigate: (to: string, options?: { state?: unknown }) => void;
}
```

```ts
// tracker/src/components/launcher/launcherSources.ts
import { matchesPickerSearch } from "@/lib/pickerOptions";
import {
  assistantPath,
  filtersPath,
  newIssuePath,
  projectSectionPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";
import type { LauncherItem, LauncherTabSpec, QuickAction } from "@/types/launcher";

export const LAUNCHER_TABS: readonly LauncherTabSpec[] = [
  { id: "actions", labelKey: "launcher.tabs.actions" },
  { id: "issues", labelKey: "launcher.tabs.issues" },
  { id: "prs", labelKey: "launcher.tabs.prs" },
  { id: "branches", labelKey: "launcher.tabs.branches" },
];

/** The board view the launcher links into when it cannot infer one from the URL. */
const DEFAULT_LAUNCHER_VIEW: WorkspaceView = "board";

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "new-issue",
    labelKey: "launcher.actions.newIssue",
    run: ({ projectSlug, navigate }) => navigate(newIssuePath(projectSlug, DEFAULT_LAUNCHER_VIEW)),
  },
  {
    id: "go-to-board",
    labelKey: "launcher.actions.goToBoard",
    run: ({ projectSlug, navigate }) => navigate(projectSectionPath(projectSlug, "board")),
  },
  {
    id: "open-filters",
    labelKey: "launcher.actions.openFilters",
    run: ({ projectSlug, navigate }) => navigate(filtersPath(projectSlug, DEFAULT_LAUNCHER_VIEW)),
  },
  {
    id: "search-issues",
    labelKey: "launcher.actions.searchIssues",
    run: ({ projectSlug, navigate }) =>
      navigate(filtersPath(projectSlug, DEFAULT_LAUNCHER_VIEW), { state: { focusSearch: true } }),
  },
  {
    id: "open-assistant",
    labelKey: "launcher.actions.openAssistant",
    run: ({ projectSlug, navigate }) => navigate(assistantPath(projectSlug)),
  },
  {
    id: "open-kb",
    labelKey: "launcher.actions.openKb",
    run: ({ projectSlug, navigate }) => navigate(projectSectionPath(projectSlug, "kb")),
  },
];

/**
 * Fuzzy + exact-number filter. Exact-number lookup is honored because issue/PR
 * number tokens are pushed as standalone `searchTokens` (e.g. "12"), and a pure
 * numeric query matches a token only on equality — so "3" does not match "12".
 */
export function filterLauncherItems(items: LauncherItem[], query: string): LauncherItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  const numeric = /^\d+$/.test(trimmed);

  return items.filter((item) => {
    if (numeric) {
      if (item.searchTokens.some((token) => token === trimmed)) return true;
    }
    return matchesPickerSearch(trimmed, ...item.searchTokens);
  });
}

export type BranchIssueIndex = ReadonlyMap<string, Issue>;

export function buildBranchIssueIndex(issues: Issue[]): BranchIssueIndex {
  const index = new Map<string, Issue>();
  for (const issue of issues) {
    const branch = issue.branchName?.trim();
    if (branch) index.set(branch, issue);
  }
  return index;
}

export function resolveBranchIssue(index: BranchIssueIndex, branchName: string): Issue | undefined {
  return index.get(branchName.trim());
}
```

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/components/launcher/__tests__/launcherSources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/types/launcher.ts tracker/src/components/launcher/launcherSources.ts \
  tracker/src/components/launcher/__tests__/launcherSources.test.ts
git commit -m "feat(launcher): pure source model (tabs, actions, fuzzy + branch index)"
```

---

## Task 5: Tracker — `useLauncherData` hook

**Files:**
- Create: `tracker/src/components/launcher/useLauncherData.ts`
- Test: `tracker/src/components/launcher/__tests__/useLauncherData.test.tsx`

Fans out per active tab to the shipped/new data sources and returns normalized `LauncherItem[]`:
- **actions** → static (no fetch); items derived from `QUICK_ACTIONS` (titles resolved by the component via i18n; the hook returns ids + token = labelKey so search works on the raw key, while the component renders the translated label).
- **issues** → `listIssues(projectSlug, { search: query })`; status dot from `useAgentExecutions()` keyed by `issueIdentifier`.
- **prs** → `listProjectPullRequests(projectSlug)`; each row carries `issueIdentifier` (marker) + `externalUrl` (PR url).
- **branches** → `listProjectBranches(projectSlug)` joined with `buildBranchIssueIndex(listIssues(projectSlug))` to attach `issueIdentifier` when the branch maps to an issue; otherwise `externalUrl` = the repo branch URL.

Implement as a **plain `useState`/`useEffect` hook** (the repo ships **no** external data-query/cache library; mirror `useAgentExecutions.ts` / `useIssueCommitEvidence.ts`). Fetch is gated on `open && activeTab !== "actions"` so closed tabs (and the no-network Actions tab) never fetch. A monotonic `requestIdRef` is the ignore-stale guard (the role `inFlightRef` plays in `useAgentExecutions` — here a request id is used instead of a hard in-flight block so a rapid tab switch can never *drop* a fetch; only the latest response is applied). The issue query string is debounced by the component (passed in already-debounced). The hook returns `{ items, loading, error, refetch }` (matching `useIssueCommitEvidence`'s shape); the component consumes `items` + `loading`. Tests mock the services + `useAgentExecutions` with `vi.mock`/`vi.spyOn` and render the hook directly with `renderHook` — no provider needed.

- [ ] **Step 1: Write failing hook test**

```tsx
// tracker/src/components/launcher/__tests__/useLauncherData.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLauncherData } from "@/components/launcher/useLauncherData";
import * as issuesService from "@/services/issues";
import * as prService from "@/services/projectPullRequests";
import * as branchService from "@/services/projectBranches";

vi.mock("@/hooks/useAgentExecutions", () => ({
  useAgentExecutions: () => ({
    executions: new Map([["DEMO-12", { issueIdentifier: "DEMO-12", status: "live" }]]),
    refetch: vi.fn(),
  }),
}));

describe("useLauncherData", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns issue items with a live status when the issues tab is open", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: "codex/demo-12" } as never,
    ]);

    const { result } = renderHook(() =>
      useLauncherData({ projectSlug: "demo", open: true, activeTab: "issues", query: "" }),
    );

    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.items[0]).toMatchObject({
      kind: "issue",
      id: "DEMO-12",
      issueIdentifier: "DEMO-12",
      status: "live",
    });
    expect(result.current.loading).toBe(false);
  });

  it("joins branches to issues via branchName and falls back to an external url", async () => {
    vi.spyOn(branchService, "listProjectBranches").mockResolvedValue([
      { name: "codex/demo-12", repo: "o/r", protected: false, commitSha: "a" },
      { name: "feature/orphan", repo: "o/r", protected: false, commitSha: "b" },
    ]);
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: "codex/demo-12" } as never,
    ]);

    const { result } = renderHook(() =>
      useLauncherData({ projectSlug: "demo", open: true, activeTab: "branches", query: "" }),
    );

    await waitFor(() => expect(result.current.items.length).toBe(2));
    const mapped = result.current.items.find((i) => i.id === "codex/demo-12");
    const orphan = result.current.items.find((i) => i.id === "feature/orphan");
    expect(mapped?.issueIdentifier).toBe("DEMO-12");
    expect(orphan?.issueIdentifier).toBeNull();
    expect(orphan?.externalUrl).toBe("https://github.com/o/r/tree/feature/orphan");
  });

  it("does not fetch PRs while the PRs tab is closed", () => {
    const spy = vi.spyOn(prService, "listProjectPullRequests").mockResolvedValue([]);
    renderHook(() => useLauncherData({ projectSlug: "demo", open: false, activeTab: "prs", query: "" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/launcher/__tests__/useLauncherData.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```tsx
// tracker/src/components/launcher/useLauncherData.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildBranchIssueIndex, resolveBranchIssue } from "@/components/launcher/launcherSources";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { listIssues } from "@/services/issues";
import { listProjectBranches, type ProjectBranch } from "@/services/projectBranches";
import { listProjectPullRequests, type ProjectPullRequest } from "@/services/projectPullRequests";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { LauncherItem, LauncherTabId } from "@/types/launcher";

export interface UseLauncherDataArgs {
  projectSlug: string;
  open: boolean;
  activeTab: LauncherTabId;
  query: string;
}

export interface LauncherDataItem extends LauncherItem {
  status?: AgentExecutionStatus | null;
}

export interface UseLauncherDataResult {
  items: LauncherDataItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface TabData {
  issues: Issue[];
  prs: ProjectPullRequest[];
  branches: ProjectBranch[];
  // The full issue set (with `branchName`) backing the branch → issue index;
  // fetched alongside branches and independent of the issue-tab search string.
  branchIssues: Issue[];
}

const EMPTY_DATA: TabData = { issues: [], prs: [], branches: [], branchIssues: [] };

function branchTreeUrl(repo: string | null, branch: string): string | null {
  if (!repo) return null;
  return `https://github.com/${repo}/tree/${branch}`;
}

// Fetch only the active tab's data (Actions never fetches). Branches needs the
// issue set too, so it fans out with Promise.all.
async function fetchForTab(projectSlug: string, tab: LauncherTabId, query: string): Promise<TabData> {
  if (tab === "issues") {
    const issues = await listIssues(projectSlug, { search: query });
    return { ...EMPTY_DATA, issues };
  }
  if (tab === "prs") {
    const prs = await listProjectPullRequests(projectSlug);
    return { ...EMPTY_DATA, prs };
  }
  if (tab === "branches") {
    const [branches, branchIssues] = await Promise.all([
      listProjectBranches(projectSlug),
      listIssues(projectSlug),
    ]);
    return { ...EMPTY_DATA, branches, branchIssues };
  }
  return EMPTY_DATA;
}

export function useLauncherData({
  projectSlug,
  open,
  activeTab,
  query,
}: UseLauncherDataArgs): UseLauncherDataResult {
  const { executions } = useAgentExecutions({ enabled: open });

  const [data, setData] = useState<TabData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id: a response is applied only when it is still the
  // latest in-flight request. This is the ignore-stale guard (the role
  // `inFlightRef` plays in useAgentExecutions); a request id — rather than a
  // hard in-flight block — is used so a rapid tab switch never drops a fetch.
  const requestIdRef = useRef(0);

  // Closed launcher and the no-network Actions tab never fetch.
  const active = open && projectSlug.trim() !== "" && activeTab !== "actions";

  const load = useCallback(async () => {
    if (!active) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await fetchForTab(projectSlug, activeTab, query);
      if (requestId !== requestIdRef.current) return; // stale: tab/query/slug changed
      setData(next);
      setError(null);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("load-failed");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [active, projectSlug, activeTab, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo<LauncherDataItem[]>(() => {
    if (activeTab === "issues") {
      return data.issues.map((issue) => issueItem(issue, executions.get(issue.identifier)?.status ?? null));
    }
    if (activeTab === "prs") {
      return data.prs.map((pr) => ({
        kind: "prs" as LauncherTabId,
        id: `pr:${pr.repo ?? "?"}#${pr.number}`,
        title: pr.title ?? `#${pr.number}`,
        subtitle: pr.repo ? `${pr.repo} · #${pr.number}` : `#${pr.number}`,
        issueIdentifier: pr.issueIdentifier,
        externalUrl: pr.url,
        searchTokens: [String(pr.number), pr.title ?? "", pr.repo ?? "", pr.issueIdentifier ?? ""],
        status: pr.issueIdentifier ? executions.get(pr.issueIdentifier)?.status ?? null : null,
      }));
    }
    if (activeTab === "branches") {
      const index = buildBranchIssueIndex(data.branchIssues);
      return data.branches.map((branch) => {
        const issue = resolveBranchIssue(index, branch.name);
        return {
          kind: "branches" as LauncherTabId,
          id: branch.name,
          title: branch.name,
          subtitle: branch.repo,
          issueIdentifier: issue?.identifier ?? null,
          externalUrl: issue ? null : branchTreeUrl(branch.repo, branch.name),
          searchTokens: [branch.name, branch.repo ?? "", issue?.identifier ?? ""],
          status: issue ? executions.get(issue.identifier)?.status ?? null : null,
        };
      });
    }
    return [];
  }, [activeTab, data, executions]);

  return { items, loading, error, refetch: load };
}

function issueItem(issue: Issue, status: AgentExecutionStatus | null): LauncherDataItem {
  const numberToken = issue.identifier.includes("-") ? issue.identifier.split("-").pop() ?? "" : issue.identifier;
  return {
    kind: "issue" as LauncherTabId,
    id: issue.identifier,
    title: issue.title,
    subtitle: issue.status,
    issueIdentifier: issue.identifier,
    externalUrl: null,
    searchTokens: [issue.identifier, issue.title, numberToken],
    status,
  };
}
```

> Notes:
> - **No external query/cache library.** Fetching is plain `useState` + a `useEffect` that re-runs whenever `load`'s deps (`active`, `projectSlug`, `activeTab`, `query`) change, with a monotonic `requestIdRef` so only the latest response is applied. Each successful fetch replaces the whole `TabData` (other tabs' slices reset to `[]`), so no cross-tab data leaks; `items` is `useMemo`'d from `data` + live `executions` so status dots stay current as the executions poll updates.
> - **Return shape** is `{ items, loading, error, refetch }` (mirrors `useIssueCommitEvidence`). `SessionQuickOpenLauncher` consumes `items` + `loading`; `error`/`refetch` are returned for parity and future surfacing (no new i18n key is introduced — `error` holds a plain `"load-failed"` sentinel, not a rendered string).
> - `LauncherItem.kind` is typed `LauncherTabId` (`"actions" | "issues" | "prs" | "branches"`). The issue row keeps `kind: "issue"` (cast) for readability/consistency with the Task 4 fixtures; the launcher component switches on the **tab id** (`activeTab`), never on `item.kind`, so this label is presentational only.

- [ ] **Step 4: Run (expect pass)** — `cd tracker && npx vitest run src/components/launcher/__tests__/useLauncherData.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/launcher/useLauncherData.ts \
  tracker/src/components/launcher/__tests__/useLauncherData.test.tsx
git commit -m "feat(launcher): useLauncherData per-tab data hook"
```

---

## Task 6: Tracker — `SessionQuickOpenLauncher` (cmdk dialog + tabs + select)

**Files:**
- Create: `tracker/src/hooks/useDebouncedValue.ts`, `tracker/src/components/launcher/LauncherItemRow.tsx`, `tracker/src/components/launcher/SessionQuickOpenLauncher.tsx`
- Test: `tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`

> Verified: there is no generic debounce hook under `tracker/src/hooks/` today (`useKbSearch.ts` debounces internally). This task creates a small shared `useDebouncedValue` (Step 3a) so the launcher's issue search does not refetch on every keystroke.

Built on `cmdk` named imports (mirror `BoardPaletteShortcuts.tsx:1`). The dialog hosts a tab button-bar (the four `LAUNCHER_TABS`) + a single `CommandInput` + a `CommandList` showing the active tab's items. cmdk's own filtering is disabled (`<Command shouldFilter={false}>`) because we filter with `filterLauncherItems` (so exact-number lookup is deterministic). The `mod+j` global keydown lives in this component (mirror the `BoardPaletteShortcuts` keydown + input guard). Select behavior implements Jean's **hold ⌥/Alt to open in background**:

- **Default (Enter/click):** *open / jump to* the run — navigate to the issue's Agent → Execution deep-link via `issueAgentTabPath(slug, viewFromPathname(pathname), issueIdentifier, "execution")`. For PR/branch rows with no `issueIdentifier`, open `externalUrl` in a new tab. Actions run their `run(ctx)`.
- **Alt held:** *open in background* — `dispatchIssueAgent(slug, issueIdentifier, { action: "resume" })` (start/continue the run) **without navigating**, then `toast.success(...)`. For PR/branch rows with no `issueIdentifier`, Alt opens the `externalUrl` (same as default for those). On error, `toast.error(...)` (mirror `ExecutionControlComposer` dispatch error handling).

- [ ] **Step 1: Write failing test**

```tsx
// tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionQuickOpenLauncher } from "@/components/launcher/SessionQuickOpenLauncher";
import * as issuesService from "@/services/issues";
import * as prService from "@/services/projectPullRequests";
import * as branchService from "@/services/projectBranches";
import * as dispatchService from "@/services/issueDispatch";

vi.mock("@/hooks/useAgentExecutions", () => ({
  useAgentExecutions: () => ({ executions: new Map(), refetch: vi.fn() }),
}));

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy, useParams: () => ({ projectSlug: "demo" }) };
});

function renderLauncher() {
  return render(
    <MemoryRouter initialEntries={["/projects/demo/board"]}>
      <SessionQuickOpenLauncher />
    </MemoryRouter>,
  );
}

describe("SessionQuickOpenLauncher", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    // Safe network-free defaults for every tab; individual tests override
    // `listIssues` as needed. Re-applied each test because `afterEach` restores.
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([]);
    vi.spyOn(prService, "listProjectPullRequests").mockResolvedValue([]);
    vi.spyOn(branchService, "listProjectBranches").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    navigateSpy.mockReset();
  });

  it("opens on mod+j and shows the four source tabs", async () => {
    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");

    expect(await screen.findByRole("tab", { name: /actions/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /issues/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /prs/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /branches/i })).toBeInTheDocument();
  });

  it("selecting an issue navigates to its Agent → Execution deep-link", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: null } as never,
    ]);

    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");
    await userEvent.click(await screen.findByRole("tab", { name: /issues/i }));
    await userEvent.click(await screen.findByText(/Fix login bug/i));

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        "/projects/demo/board/issues/DEMO-12/agent?agent=execution",
      ),
    );
  });

  it("Alt+click dispatches a background resume instead of navigating", async () => {
    vi.spyOn(issuesService, "listIssues").mockResolvedValue([
      { identifier: "DEMO-12", title: "Fix login bug", status: "In Progress", branchName: null } as never,
    ]);
    const dispatch = vi
      .spyOn(dispatchService, "dispatchIssueAgent")
      .mockResolvedValue({ action: "resume", message: "ok", issue: {} as never });

    renderLauncher();
    await userEvent.keyboard("{Meta>}j{/Meta}");
    await userEvent.click(await screen.findByRole("tab", { name: /issues/i }));
    await userEvent.keyboard("{Alt>}");
    await userEvent.click(await screen.findByText(/Fix login bug/i));
    await userEvent.keyboard("{/Alt}");

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith("demo", "DEMO-12", { action: "resume" }),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`
Expected: FAIL (components not found).

- [ ] **Step 3a: Implement the debounce hook**

```ts
// tracker/src/hooks/useDebouncedValue.ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 3: Implement `LauncherItemRow`**

```tsx
// tracker/src/components/launcher/LauncherItemRow.tsx
import { Boxes, CircleDot, GitBranch, GitPullRequest, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { LauncherDataItem } from "@/components/launcher/useLauncherData";
import { cn } from "@/lib/utils";
import type { LauncherTabId } from "@/types/launcher";

const TAB_ICON: Record<LauncherTabId, typeof CircleDot> = {
  actions: Zap,
  issues: CircleDot,
  prs: GitPullRequest,
  branches: GitBranch,
};

const STATUS_DOT: Record<string, string> = {
  live: "bg-emerald-500 animate-pulse",
  retrying: "bg-amber-500",
  waiting: "bg-amber-400",
  idle: "bg-slate-400",
  saved: "bg-sky-500",
  error: "bg-red-500",
  aborted: "bg-red-400",
};

export function LauncherItemRow({ item, tab }: { item: LauncherDataItem; tab: LauncherTabId }) {
  const { t } = useTranslation();
  const Icon = TAB_ICON[tab] ?? Boxes;

  return (
    <div className="flex w-full items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{item.title}</div>
        {item.subtitle ? <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div> : null}
      </div>
      {item.status ? (
        <span
          className={cn("h-2 w-2 rounded-full", STATUS_DOT[item.status] ?? "bg-slate-400")}
          aria-label={t(`launcher.status.${item.status}`)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SessionQuickOpenLauncher`**

```tsx
// tracker/src/components/launcher/SessionQuickOpenLauncher.tsx
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from "cmdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { LauncherItemRow } from "@/components/launcher/LauncherItemRow";
import { filterLauncherItems, LAUNCHER_TABS, QUICK_ACTIONS } from "@/components/launcher/launcherSources";
import { useLauncherData } from "@/components/launcher/useLauncherData";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { issueAgentTabPath, viewFromPathname } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { LauncherDataItem } from "@/components/launcher/useLauncherData";
import type { LauncherTabId } from "@/types/launcher";

export function SessionQuickOpenLauncher() {
  const { t } = useTranslation();
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LauncherTabId>("issues");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { items, loading } = useLauncherData({ projectSlug, open, activeTab, query: debouncedQuery });

  const actionItems = useMemo<LauncherDataItem[]>(
    () =>
      QUICK_ACTIONS.map((action) => ({
        kind: "actions",
        id: action.id,
        title: t(action.labelKey),
        searchTokens: [t(action.labelKey), action.id],
      })),
    [t],
  );

  const visible = useMemo(() => {
    const source = activeTab === "actions" ? actionItems : items;
    return filterLauncherItems(source, query);
  }, [activeTab, actionItems, items, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const runIssue = useCallback(
    async (issueIdentifier: string, background: boolean) => {
      if (!background) {
        const view = viewFromPathname(location.pathname);
        navigate(issueAgentTabPath(projectSlug, view, issueIdentifier, "execution"));
        return;
      }
      try {
        await dispatchIssueAgent(projectSlug, issueIdentifier, { action: "resume" });
        toast.success(t("launcher.toast.backgroundResume", { identifier: issueIdentifier }));
      } catch {
        toast.error(t("launcher.toast.dispatchFailed", { identifier: issueIdentifier }));
      }
    },
    [location.pathname, navigate, projectSlug, t],
  );

  const onSelect = useCallback(
    (item: LauncherDataItem, background: boolean) => {
      close();

      if (activeTab === "actions") {
        const action = QUICK_ACTIONS.find((entry) => entry.id === item.id);
        action?.run({ projectSlug, navigate });
        return;
      }

      if (item.issueIdentifier) {
        void runIssue(item.issueIdentifier, background);
        return;
      }

      if (item.externalUrl) {
        window.open(item.externalUrl, "_blank", "noopener");
        return;
      }

      toast.message(t("launcher.toast.noLinkedIssue"));
    },
    [activeTab, close, navigate, projectSlug, runIssue, t],
  );

  return (
    <CommandDialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <div role="tablist" aria-label={t("launcher.tabsLabel")} className="flex gap-1 border-b px-2 py-2">
        {LAUNCHER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-sm px-3 py-1 text-xs font-medium",
              activeTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t(`launcher.placeholder.${activeTab}`)}
        />
        <CommandList>
          <CommandEmpty>{loading ? t("launcher.loading") : t("launcher.empty")}</CommandEmpty>
          {visible.map((item) => (
            <CommandItem
              key={item.id}
              value={item.id}
              onSelect={() =>
                onSelect(item, isAltPressedRef.current)
              }
              onClick={(event) => {
                event.preventDefault();
                onSelect(item, event.altKey);
              }}
            >
              <LauncherItemRow item={item} tab={activeTab} />
            </CommandItem>
          ))}
        </CommandList>
        <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {t("launcher.altHint")}
        </div>
      </Command>
    </CommandDialog>
  );
}

// cmdk's `onSelect` (keyboard Enter) does not carry the mouse modifier, so we
// track the Alt key globally to honor "hold ⌥/Alt to open in background" for
// both Enter and click.
const isAltPressedRef = { current: false } as { current: boolean };

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt") isAltPressedRef.current = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") isAltPressedRef.current = false;
  });
  window.addEventListener("blur", () => {
    isAltPressedRef.current = false;
  });
}
```

> Implementation note: `useDebouncedValue` is the hook created in Step 3a. The Alt-tracking `isAltPressedRef` lives at module scope (with `keydown`/`keyup`/`blur` listeners) because cmdk's keyboard `onSelect` does not expose the modifier key; the mouse `onClick` path reads `event.altKey` directly. The launcher also updates the commit-step file list to include `tracker/src/hooks/useDebouncedValue.ts`.

- [ ] **Step 5: Run (expect pass)** — `cd tracker && npx vitest run src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/hooks/useDebouncedValue.ts \
  tracker/src/components/launcher/LauncherItemRow.tsx \
  tracker/src/components/launcher/SessionQuickOpenLauncher.tsx \
  tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx
git commit -m "feat(launcher): SessionQuickOpenLauncher cmdk dialog + tabs + alt-background"
```

---

## Task 7: Tracker — global mount + shortcut + i18n

**Files:**
- Modify: `tracker/src/components/layout/ProjectWorkspaceLayout.tsx`
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`
- Test: extend `tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx` (mount-level: shortcut works anywhere, not only on the board).

**Shortcut justification (no collision):** `⌘K`/`Ctrl+K` is the board filters palette (`BoardPaletteShortcuts.tsx:37`, mounted only on board paths); `/` focuses board search; Plan 2b reserves `⌘`+`Enter`/`.`/`Shift+R` for execution actions; the magic-commands plan reserves `⌘P`. **`mod+j`** ("**J**ump to / new session", echoing Jean) is unused and never overlaps `⌘K`. The launcher mounts globally in `WorkspaceChrome` (not gated by `showBoardFilters`), so it is reachable from board, list, issue, assistant, KB, and settings views.

- [ ] **Step 1: Write failing mount test** — append a second harness + test to `tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx` proving the launcher opens via `mod+j` from a non-board route (it is globally mounted, not board-gated):

```tsx
function renderLauncherAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionQuickOpenLauncher />
    </MemoryRouter>,
  );
}

it("opens on mod+j from a non-board route", async () => {
  renderLauncherAt("/projects/demo/kb");
  await userEvent.keyboard("{Meta>}j{/Meta}");
  expect(await screen.findByRole("tab", { name: /issues/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`
Expected: FAIL only if i18n keys are missing (the launcher renders raw keys); add keys in Step 4. If the dialog already opens, this test passes once keys exist — proceed to wire the mount + locales.

- [ ] **Step 3: Mount globally** — edit `tracker/src/components/layout/ProjectWorkspaceLayout.tsx`:

Add the import:

```tsx
import { SessionQuickOpenLauncher } from "@/components/launcher/SessionQuickOpenLauncher";
```

Render it inside `WorkspaceChrome` **unconditionally** (right after `<ProjectHeader … />`, before the board-only palette), so it is available on every project view:

```tsx
      />
      <SessionQuickOpenLauncher />
      {showBoardFilters ? <BoardPaletteShortcuts /> : null}
```

- [ ] **Step 4: Add i18n keys** — add this block as a **new top-level** key in `tracker/locales/en/tracker.json`. (A `launcher` key already exists *nested* under `assistant` — `assistant…launcher` — which is a different dotted path and does not conflict with the top-level `launcher.*` keys resolved by `t("launcher.…")`.)

```json
  "launcher": {
    "tabsLabel": "Source",
    "loading": "Loading…",
    "empty": "No matching results.",
    "altHint": "Hold ⌥/Alt to open in background",
    "tabs": {
      "actions": "Actions",
      "issues": "Issues",
      "prs": "PRs",
      "branches": "Branches"
    },
    "placeholder": {
      "actions": "Run a command…",
      "issues": "Search issues or paste a number…",
      "prs": "Search open pull requests…",
      "branches": "Search branches…"
    },
    "actions": {
      "newIssue": "New issue",
      "goToBoard": "Go to board",
      "openFilters": "Open filters",
      "searchIssues": "Search issues",
      "openAssistant": "Open assistant",
      "openKb": "Open knowledge base"
    },
    "status": {
      "live": "Running",
      "retrying": "Retrying",
      "waiting": "Waiting for review",
      "idle": "Idle",
      "saved": "Saved (resumable)",
      "error": "Error",
      "aborted": "Aborted"
    },
    "toast": {
      "backgroundResume": "Resuming {{identifier}} in the background",
      "dispatchFailed": "Could not start {{identifier}}",
      "noLinkedIssue": "No Symphony issue is linked to this branch yet"
    }
  },
```

Add the Portuguese mirror at the top level of `tracker/locales/pt-BR/tracker.json`:

```json
  "launcher": {
    "tabsLabel": "Origem",
    "loading": "Carregando…",
    "empty": "Nenhum resultado correspondente.",
    "altHint": "Segure ⌥/Alt para abrir em segundo plano",
    "tabs": {
      "actions": "Ações",
      "issues": "Issues",
      "prs": "PRs",
      "branches": "Branches"
    },
    "placeholder": {
      "actions": "Executar um comando…",
      "issues": "Buscar issues ou colar um número…",
      "prs": "Buscar pull requests abertos…",
      "branches": "Buscar branches…"
    },
    "actions": {
      "newIssue": "Nova issue",
      "goToBoard": "Ir para o board",
      "openFilters": "Abrir filtros",
      "searchIssues": "Buscar issues",
      "openAssistant": "Abrir assistente",
      "openKb": "Abrir base de conhecimento"
    },
    "status": {
      "live": "Em execução",
      "retrying": "Tentando novamente",
      "waiting": "Aguardando revisão",
      "idle": "Ocioso",
      "saved": "Salvo (retomável)",
      "error": "Erro",
      "aborted": "Abortado"
    },
    "toast": {
      "backgroundResume": "Retomando {{identifier}} em segundo plano",
      "dispatchFailed": "Não foi possível iniciar {{identifier}}",
      "noLinkedIssue": "Nenhuma issue do Symphony está vinculada a esta branch ainda"
    }
  },
```

- [ ] **Step 5: Run (expect pass)** — `cd tracker && npx vitest run src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx`
Expected: PASS (all launcher tests, including the non-board mount test).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/layout/ProjectWorkspaceLayout.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json \
  tracker/src/components/launcher/__tests__/SessionQuickOpenLauncher.test.tsx
git commit -m "feat(launcher): mount globally on mod+j + i18n (en/pt-BR)"
```

---

## Task 8: Full gates + docs + v2 extension points

**Files:** Modify `elixir/README.md` (or `../SPEC.md`) to document the launcher; no new code.

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all`
Expected: PASS (format, lint, coverage, dialyzer). Both new modules expose `@spec` on every public `def` (required by `elixir/AGENTS.md`).

- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 3: Docs** — add a short "Session / Run Quick-Open Launcher" subsection to `elixir/README.md`: the `mod+j` shortcut, the four v1 tabs (Actions/Issues/PRs/Branches), the issue-centric mapping, "hold ⌥/Alt to open in background", and the two new project-scoped read endpoints (`GET /projects/:slug/pull_requests`, `GET /projects/:slug/branches`).

- [ ] **Step 4: Commit**

```bash
git add elixir/README.md
git commit -m "docs(launcher): document quick-open launcher + project PR/branch endpoints"
```

### v2 / later extension points (do NOT build in v1)

- **Security advisories tab** (Jean's `SecurityAlertsTab.tsx`): add a `GitHub.Advisories.list_for_project/2` over `GET /repos/:owner/:repo/dependabot/alerts` (or code-scanning alerts) + a `GET /projects/:slug/security_advisories` endpoint, then register `{ id: "security", labelKey: "launcher.tabs.security" }` in `LAUNCHER_TABS` and a branch in `useLauncherData`. Selecting an advisory could open/create a remediation issue.
- **Linear issues tab** (Jean's `LinearIssuesTab.tsx`): for Linear-backed projects, add a `linear_graphql`-powered project issue search (see `.claude/skills/linear/SKILL.md`) behind a `GET /projects/:slug/linear/issues` endpoint, mapped the same way the Issues tab maps to Agent→Execution. Gate the tab on `trackerKind === "linear"`.
- **Preview-before-launch** (Jean's `IssuePreviewModal.tsx`): a right-hand preview pane in the launcher showing the highlighted item's details before dispatch. Additive to `SessionQuickOpenLauncher` (a second column); no data-model change.
- **`commandPaletteScope` integration:** when Plan 2b lands `tracker/src/lib/commandPaletteScope.ts`, wrap the launcher's open/close in `acquireOverlayPalette`/`isOverlayPaletteActive` and swap the direct `cmdk` import for `@/components/ui/command` so the launcher, the board `⌘K` palette, and the execution `⌘K` palette share one Esc/stacking owner.
- **Curated Actions growth:** append `"Open diff viewer"` (once an in-SPA diff route exists; today it opens externally via `ProjectEditorMenu`) and `"Open command palette"` (dispatch a synthetic `⌘K`) to `QUICK_ACTIONS` — the list is already data-driven.

---

## Self-Review (spec coverage)

| Requirement (from spec) | Task(s) |
| --- | --- |
| Global command-palette modal with source tabs | 6 (cmdk dialog + tab bar), 7 (global mount) |
| v1 tabs: Actions, Issues, PRs, Branches (security/Linear deferred) | 4 (`LAUNCHER_TABS`), 8 (v2 notes) |
| Each tab searchable (fuzzy + exact-number) | 4 (`filterLauncherItems`), 6 (`shouldFilter={false}` + filter) |
| "Hold ⌥/Alt to open in background" | 6 (`onSelect(item, alt)` → dispatch resume vs navigate) |
| Actions = curated, data-driven quick commands | 4 (`QUICK_ACTIONS` array, existing route helpers) |
| Issues → Agent → Execution deep-link (+ optional dispatch) | 5 (issue items), 6 (`issueAgentTabPath(...,"execution")`) |
| PRs → open the PR's associated issue (or PR-focused view) | 1 (marker → `issue_identifier`), 5/6 (deep-link or external url) |
| Branches → map to issue-on-branch, else "start from branch" stub | 2 (branches endpoint), 4 (`buildBranchIssueIndex`), 6 (deep-link or stub toast/external) |
| Smallest backend addition where no clean mapping | 1, 2 (two thin project-scoped read endpoints; reuse marker/branchName mapping) |
| Distinct, collision-free global shortcut (justified) | 7 (`mod+j`, justification + non-board test) |
| Reuse 2b cmdk primitive / coordinate ⌘K ownership | Header note + 8 (integration note; `mod+j` avoids collision regardless) |
| Reuse Plan 4 sessions/deep-link + `dispatchIssueAgent` | 5 (`useAgentExecutions`), 6 (`dispatchIssueAgent`, `issueAgentTabPath`) |
| i18n keys (en + pt-BR) | 7 |
| Self-contained even though 2b/Plan 4 unmerged | Header note + 4–6 (direct `cmdk`, own data hooks) |

**Type-consistency check (fixed inline):**
- **Data layer uses no external query/cache library** (verified absent from `tracker/package.json`). `useLauncherData` (Task 5) is a plain `useState`/`useEffect`/`useRef` hook mirroring `useAgentExecutions.ts`/`useIssueCommitEvidence.ts`, and returns `{ items, loading, error, refetch }`. `SessionQuickOpenLauncher` (Task 6) destructures `{ items, loading }` (the `CommandEmpty` toggles on `loading`); the hook and component tests (Tasks 5–7) render via `renderHook`/`render` with `vi.mock`/`vi.spyOn` for the services + `useAgentExecutions` — no provider/wrapper.
- `LauncherItem.kind` is the tab id type. Task 4's pure test uses `kind: "issue"` for readability; the runtime hook (Task 5) and the component (Task 6) switch on the **tab id** (`activeTab`), never on `kind`, so behavior is unaffected — documented in the Task 5 note. (If a reviewer prefers strictness, change the Task 4 fixtures to `kind: "issues"`; no code path depends on it.)
- `dispatchIssueAgent(projectSlug, identifier, { action: "resume" })` matches `issueDispatch.ts` exactly (Task 6, test asserts this signature).
- `issueAgentTabPath(slug, view, identifier, "execution")` returns `/projects/<slug>/<view>/issues/<id>/agent?agent=execution` (`workspaceRoutes.ts:191`), matching the Task 6 navigation assertion.
- New endpoints return `{ data, supported }`; services normalize snake_case → camelCase (`updated_at`→`updatedAt`, `commit_sha`→`commitSha`, `issue_identifier`→`issueIdentifier`), asserted in Task 3 tests.

**Open questions / risks:**
- **Branches → action mapping (highest risk):** v1 maps a branch to an issue purely client-side via `Issue.branchName` equality. Branches with no matching local issue degrade to a "start from branch" stub (toast + external GitHub branch link), because Symphony has no "create issue from arbitrary branch" path and runs are keyed by issue. If product wants true "start from branch", that is a larger backend addition (synthesize/adopt an issue for the branch) — explicitly out of v1 scope.
- **PR → issue identifier** relies on the `Symphony-Issue:` marker in the PR body; PRs without the marker show with no issue mapping and open externally on select. This matches Symphony's existing marker-based linkage but means marker-less PRs cannot deep-link.
- **GitHub auth/rate limits:** both new endpoints require a GitHub token and run one call per configured repo; results are cached via `ReadCache` (60s). Projects with no configured repos return `supported: false` (PRs/Branches tabs render an empty/"unsupported" state — handle gracefully in the empty state copy).
- **2b dependency:** if 2b's `ui/command.tsx` / `commandPaletteScope.ts` land before this plan executes, prefer them (see header + Task 8 integration note); the plan is written to work either way.
