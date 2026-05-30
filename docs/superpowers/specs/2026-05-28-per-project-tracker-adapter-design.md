# Per-Project Tracker Adapter — Design

> Slice B of the **Symphony MVP completion** initiative (see roadmap at the end).
> Sibling specs:
> - Slice A: `2026-05-28-viewer-identity-and-board-filters-design.md`
> - Slice C: `2026-05-28-workspace-templates-design.md` (next)
> - Slice D: `2026-05-28-dev-environment-discovery-design.md` (next)

## 1. Problem

Today every Symphony installation is **bound to a single, globally-configured tracker** chosen at `WORKFLOW.md` load time (`tracker.kind = local | github | linear | memory`). The web UI talks only to the local SQLite tracker. The orchestrator's `SymphonyElixir.Tracker` behaviour resolves its adapter via the same global `Config.tracker_kind/0` switch.

Users with multiple parallel projects need each Symphony `Project` to point to its own issue source:

- `gamba-workspace` → Local SQLite tracker (default).
- `clouapp-front` → A GitHub Project v2 board.
- `marketing-roadmap` → A Linear project.

The UI should look identical for all three (board, issues list, drawer filters from Slice A), but reads/writes for non-local projects must go directly to the remote API. **No local mirroring / sync layer is desired** — direct calls with normalized DTOs only.

## 2. Goal

1. Add a `tracker_kind` (and configuration metadata) to `local_tracker_projects`. Existing projects default to `local` via migration backfill.
2. Introduce a per-project read/write boundary — `SymphonyElixir.Tracker.IssueAdapter` — that the Phoenix JSON API uses on every project-scoped request. The adapter is selected from the `Project` row, not from `Config.tracker_kind/0`.
3. Implement three adapters:
   - `SymphonyElixir.LocalTracker.IssueAdapter` (default; wraps the existing `LocalTracker.Context` calls).
   - `SymphonyElixir.GitHub.IssueAdapter` (GitHub Project v2 board, reuses `SymphonyElixir.GitHub.Client` GraphQL pipelines).
   - `SymphonyElixir.Linear.IssueAdapter` (Linear project, reuses `SymphonyElixir.Linear.Client`).
4. Keep the existing `SymphonyElixir.Tracker` behaviour (orchestrator) untouched. The orchestrator continues to run only against projects whose `tracker_kind = "local"` (other kinds are intentionally not auto-orchestrated in this slice).
5. Expose tracker selection in the **first step** of `ProjectWorkspaceWizard.tsx`. Existing wizard flow is preserved for `local`; new flows are introduced for `github` and `linear`.
6. Keep the `/api/tracker/v1/projects/:slug/...` URL surface stable; the same shape of `Issue` / `WorkflowStatus` DTOs is returned regardless of `tracker_kind`. Drawer filters added in Slice A keep working for `local`; remote adapters do client-side filtering on the response (see §7).
7. Frontend uses **light polling** (refetch every 30 s + manual refresh button + on-window-focus refetch) for remote projects. No new websocket plumbing.

## 3. Non-goals

- Multi-tenant credential storage. Tokens stay global (`GITHUB_TOKEN`, `LINEAR_API_KEY`) per Slice A consensus.
- Webhook receivers for GitHub/Linear (deferred).
- Orchestrator (poll loop, rework loop, terminal status loop) executing against remote trackers — explicitly **out of scope**. Remote projects are UI-only in this slice.
- Repo-level GitHub Issues (without a Project v2 board). Future work.
- Linear team selection. Slice B assumes one Linear project ID per Symphony project.
- Issue creation flow for remotes does **not** create labels, milestones, or assignees in the remote system — only `title`, `description`, and target status.
- Optimistic UI updates for remote mutations. The UI awaits the API response, then refetches.
- Cache layer (ETS, Cachex, etc.). All remote reads are pass-through.

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **GitHub remote scope** = GitHub Project v2 board (existing adapter). | User skipped the picker; we pick Project v2 because it reuses `SymphonyElixir.GitHub.{Bootstrap,Client,ProjectMetadata}` and matches the orchestrator's existing pipeline. Repo-only issues = future slice. |
| D2 | **Linear remote scope** = one Linear project per Symphony project (slug-addressed, same as today). | Mirrors D1. Linear team picker = future. |
| D3 | **Credentials** = global env vars (`GITHUB_TOKEN`, `LINEAR_API_KEY`). | User-confirmed (`global_env`). |
| D4 | **Realtime** = client-side light polling at 30 s + window focus + manual refresh. | User-confirmed (`polling`). The local tracker keeps its existing Phoenix Channel broadcasts unchanged. |
| D5 | **Mutations** = full set on remotes: list / get / create / move (change state) / comment. | User-confirmed (`read_write_full`). |
| D6 | **Wizard UX** = first step of `ProjectWorkspaceWizard` picks `Local / GitHub Project / Linear Project`; subsequent steps adapt. | User-confirmed (`first_step_wizard`). |
| D7 | **Status DTO strategy** = per-project native states; each adapter returns its own status list via the existing `/projects/:slug/statuses` endpoint (currently a derived list from `WorkflowStatus`). | User-confirmed (`per_project_states`). |
| D8 | **Behaviour separation** (architecture) = recommended hybrid: a new `SymphonyElixir.Tracker.IssueAdapter` behaviour for UI reads/writes per-project; the existing `SymphonyElixir.Tracker` (orchestrator) is **not** refactored. | Picker skipped by user; assumption recorded. Future slice can migrate the orchestrator on top of `IssueAdapter`. |
| D9 | **Migration backfill** for `tracker_kind` on existing projects = `"local"`. | Single migration; no destructive change. |
| D10 | **Identifier strategy on remotes** = expose canonical tracker issue identifiers without a leading decoration (`123` for GitHub, `LIN-42` for Linear). Remote URLs still point to native systems, but Symphony routes and joins use the decoration-free identifier. | Keeps tracker URLs and agent joins consistent. |
| D11 | **Position** on remote boards = not persisted by Symphony; remote APIs return an ordered list by `createdAt` (Linear) or board sort (GitHub Project v2). UI does not support drag-to-reorder for remote projects in MVP. | Documented in §7. |
| D12 | **Drawer filters (Slice A)** for remote projects = applied client-side on the fetched issue list (search/assignee/creator). The backend forwards filter params for `local` only. | Keeps UI consistent; remote APIs vary too much for a server-side mapping in MVP. |
| D13 | **Channel broadcasts** for remote projects = none. The Phoenix `tracker:project:<slug>` channel only fires for `local` projects; the frontend already gracefully degrades when no events arrive. Polling fills the gap. | |

## 5. Architecture

### 5.1 The new behaviour

```
SymphonyElixir.Tracker.IssueAdapter (new)
├── list_issues(project, filters)        :: {:ok, [Issue.t()]} | {:error, term()}
├── get_issue(project, identifier)       :: {:ok, Issue.t()} | {:error, term()}
├── create_issue(project, attrs)         :: {:ok, Issue.t()} | {:error, term()}
├── update_issue(project, id, attrs)     :: {:ok, Issue.t()} | {:error, term()}
├── move_issue(project, id, attrs)       :: {:ok, Issue.t()} | {:error, term()}
├── list_statuses(project)               :: {:ok, [Status.t()]} | {:error, term()}
├── list_comments(project, id)           :: {:ok, [Comment.t()]} | {:error, term()}
├── add_comment(project, id, body, attrs):: {:ok, Comment.t()} | {:error, term()}
└── kind()                               :: :local | :github | :linear
```

Where `project` is the `SymphonyElixir.LocalTracker.Project` Ecto struct (with `tracker_kind` and `tracker_config` already loaded). All return values are normalized to the same DTOs the frontend already consumes.

### 5.2 Adapter resolution

```
SymphonyElixir.Tracker.IssueAdapter.for(%Project{tracker_kind: kind})
  :local  → SymphonyElixir.LocalTracker.IssueAdapter
  :github → SymphonyElixir.GitHub.IssueAdapter
  :linear → SymphonyElixir.Linear.IssueAdapter
```

`for/1` is the only dispatch point. Plug-in adapters (tests, future Memory) register via `Application.put_env(:symphony_elixir, :issue_adapters, %{custom: MyModule})` (overrides defaults). The default mapping lives in the behaviour module — no per-environment config necessary.

### 5.3 Controller refactor

Today `SymphonyElixirWeb.Tracker.IssueController` calls `LocalTracker.Context` directly. After Slice B it calls:

```elixir
def index(conn, %{"project_slug" => slug} = params) do
  with {:ok, project}  <- Context.get_project(slug),           # still reads the local Project row
       {:ok, filters}  <- build_filters(params),
       adapter         <- IssueAdapter.for(project),
       {:ok, issues}   <- adapter.list_issues(project, filters) do
    json(conn, %{data: Enum.map(issues, &TrackerPresenter.issue/1)})
  end
end
```

`Context.get_project/1` continues to be the canonical lookup for the **Symphony-side `Project` row** — that exists for every project regardless of tracker_kind. Only the issue payload differs.

### 5.4 Shared remote clients

We do not bypass the existing GitHub/Linear clients. The IssueAdapters delegate to:

- `SymphonyElixir.GitHub.Client` — GraphQL HTTP, request signing, error normalization.
- `SymphonyElixir.GitHub.ProjectMetadata` — single source of truth for project ID / status field / option IDs. Per Slice B, metadata is **resolved on-demand per project** instead of from `.symphony/github-project.json`. See §6.4.
- `SymphonyElixir.Linear.Client` — same idea.

A thin wrapper module `SymphonyElixir.GitHub.IssueAdapter.QueryBuilder` (and Linear equivalent) holds the GraphQL strings + DTO normalizers (`%Issue{}`, `%Status{}`, `%Comment{}`).

### 5.5 What we do NOT change

- `SymphonyElixir.Tracker` (orchestrator behaviour) and its three current implementations.
- `Config.tracker_kind/0` and the YAML `tracker:` section: still drive the orchestrator. They become **the default for new projects** (auto-selected in the wizard for backwards compat — see §7.1).
- The Phoenix channel `tracker:project:<slug>` and the `Broadcaster` module — only fire for local projects, exactly as today.

## 6. Data model & backend design

### 6.1 Migration

`priv/repo/migrations/2026MMDDHHMMSS_add_tracker_kind_to_projects.exs`

```elixir
def change do
  alter table(:local_tracker_projects) do
    add :tracker_kind, :string, null: false, default: "local"
    add :tracker_config, :map, null: false, default: %{}
  end

  create index(:local_tracker_projects, [:tracker_kind])
end
```

- `tracker_kind` ∈ `{"local", "github", "linear"}` (validated in the changeset).
- `tracker_config` shape depends on kind:
  - `local` → `%{}` (unused).
  - `github` → `%{"repo" => "owner/name", "project_id" => "PVT_kwHO...", "project_number" => 7, "status_field" => "Symphony State"}`.
  - `linear` → `%{"project_id" => "abc-uuid", "project_slug" => "lin-proj-slug", "team_id" => "team-uuid"}`.

### 6.2 Schema changes

`SymphonyElixir.LocalTracker.Project`:

```elixir
schema "local_tracker_projects" do
  field :name, :string
  field :slug, :string
  field :description, :string
  field :archived_at, :utc_datetime_usec
  field :tracker_kind, :string, default: "local"
  field :tracker_config, :map, default: %{}
  # ...existing associations
end

def changeset(project, attrs) do
  project
  |> cast(attrs, [:name, :slug, :description, :tracker_kind, :tracker_config])
  |> validate_required([:name, :slug, :tracker_kind])
  |> validate_inclusion(:tracker_kind, ~w(local github linear))
  |> validate_tracker_config()
  |> unique_constraint(:slug)
end

defp validate_tracker_config(changeset) do
  case get_field(changeset, :tracker_kind) do
    "local"  -> changeset
    "github" -> validate_required_keys(changeset, :tracker_config, ["repo", "project_id"])
    "linear" -> validate_required_keys(changeset, :tracker_config, ["project_id"])
    _ -> changeset
  end
end
```

### 6.3 New behaviour module

`elixir/lib/symphony_elixir/tracker/issue_adapter.ex` declares the behaviour, the `for/1` resolver, the `dispatch/4` convenience helper, and the structured error type `{:error, tracker_error()}` where:

```elixir
@type tracker_error ::
  :project_not_found
  | :issue_not_found
  | :status_not_found
  | :remote_unavailable        # network / 5xx
  | :remote_unauthorized       # 401
  | :remote_forbidden          # 403
  | :remote_rate_limited       # GitHub 403 / Linear COMPLEXITY_LIMIT
  | :missing_credentials       # token absent
  | {:remote_validation, map()} # 4xx mapped into changeset-like errors
  | {:adapter_error, term()}
```

`SymphonyElixirWeb.TrackerErrors.render/2` is extended to map these into HTTP responses (see §9).

### 6.4 GitHub IssueAdapter — concretely

- **Metadata resolution.** Hot path uses `ProjectMetadata.for_project/1`. New variant: instead of reading `.symphony/github-project.json` (which is repo-specific and lives in the cloned workspace), `for_project/1` reads from `project.tracker_config`. Fields needed: `project_id`, `project_number`, `repo`, `status_field`, and the map of `status_name -> option_id`. The option map is fetched lazily on the first `list_statuses/1` call and cached in ETS keyed by `{project.id, project.updated_at}`.

- **Wizard bootstrap (during create).** When the user picks `GitHub Project` in the wizard, the backend calls a new endpoint `POST /api/tracker/v1/github/projects/discover` that:
  1. Calls the existing `Viewer` to resolve the operator login.
  2. Calls `viewer { projectsV2(first: 50) { nodes { id, number, title, ... } } }` to enumerate boards.
  3. Returns the list as DTOs.
  The wizard renders the list; user picks one; we then call `POST /api/tracker/v1/github/projects/resolve` with the chosen project_id which returns `{repo, status_field, status_options}` ready to be saved in `tracker_config`.

- **`list_issues/2`.** Calls a tailored GraphQL query (`SymphonyElixir.GitHub.IssueAdapter.Query.list_issues/2`) that pages `projectV2.items(first: 50)` and reads `Symphony State`. Returns `[%Issue{}]` with `identifier = "#{issue.number}"`, `status = single-select option name`, `position = nil`. Filters are not pushed down to GitHub in MVP; the adapter returns the full open set (≤200 items by default; pagination = future).

- **`create_issue/2`.** Two-step GraphQL: `createIssue` against the repo, then `addProjectV2ItemById`. The status is set with `updateProjectV2ItemFieldValue` afterwards if `attrs[:status]` is provided.

- **`move_issue/3`.** GraphQL `updateProjectV2ItemFieldValue` against the item's node ID for the configured `Symphony State` field.

- **`list_statuses/1`.** Returns the configured `Symphony State` options as `[%Status{name, category, position, is_terminal}]`. `category` is heuristically mapped (`"In Progress" -> "started"`, `"Done" -> "completed"`, `"Cancelled" -> "canceled"`, others -> `"unstarted"`).

- **`add_comment/4` and `list_comments/2`.** `addComment` mutation / `issue.comments(first: 100)` query against the issue node.

### 6.5 Linear IssueAdapter — concretely

- **Metadata resolution.** `project.tracker_config["project_id"]` is the Linear Project UUID; everything else (team, states) is resolved from Linear at runtime. States are cached identically to GitHub.

- **Wizard bootstrap.** `POST /api/tracker/v1/linear/projects/discover` runs `viewer { teamMemberships { team { projects(first: 50) { nodes { id, name, slugId, state, team { id, name } } } } } }`. Returns projects + their team. `POST /api/tracker/v1/linear/projects/resolve` returns `{team_id, states: [{id, name, type, position}]}`.

- **`list_issues/2`.** `project { id, issues(first: 100, filter: {state: {type: {neq: "canceled"}}}) { nodes { id, identifier, title, description, priority, state { id name type position } assignee { id name displayName } creator { id name displayName } createdAt, updatedAt } } }`. DTO mapping is straight.

- **`create_issue/2`.** `issueCreate(input: {teamId, projectId, title, description, stateId?})`.

- **`move_issue/3`.** `issueUpdate(id, input: {stateId})`. We resolve the `stateId` from the project's team states list.

- **`list_statuses/1`.** Returns team states for the project's team.

- **`add_comment/4` and `list_comments/2`.** `commentCreate` mutation / `issue.comments(first: 100)` query.

### 6.6 Local IssueAdapter

A thin façade over the existing `LocalTracker.Context` — preserves every behaviour added in Slice A (filters, creator injection, channel broadcasts). All new code is `defdelegate` plus DTO normalization.

```elixir
defmodule SymphonyElixir.LocalTracker.IssueAdapter do
  @behaviour SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueMapper

  def kind, do: :local

  def list_issues(%{slug: slug}, filters) do
    issues = Context.list_issues(slug, filters)
    {:ok, Enum.map(issues, &IssueMapper.to_dto/1)}
  end
  # ... etc
end
```

### 6.7 Controller refactor

`IssueController`, `CommentController`, `BlockerController` all switch from `Context.X` to `IssueAdapter.dispatch(project, :X, args)`. The `BlockerController` for remotes returns `{:error, :not_supported_on_remote}` in MVP — explicitly mapped to 501 Not Implemented.

A new controller `SymphonyElixirWeb.Tracker.RemoteDiscoveryController` exposes:

- `POST /api/tracker/v1/github/projects/discover` (list viewer's Project v2 boards)
- `POST /api/tracker/v1/github/projects/resolve` (fetch metadata for a chosen board)
- `POST /api/tracker/v1/linear/projects/discover`
- `POST /api/tracker/v1/linear/projects/resolve`

These power the wizard.

### 6.8 Project setup endpoint changes

`POST /api/tracker/v1/projects/workspace` accepts a new field `tracker` in the payload:

```json
{
  "name": "...",
  "slug": "...",
  "tracker": {
    "kind": "github",
    "config": {
      "repo": "raphaelcangucu/symphony",
      "project_id": "PVT_kwHO...",
      "project_number": 7,
      "status_field": "Symphony State"
    }
  },
  "workflow_statuses": [...],
  "repositories": [...],
  "setup": {...}
}
```

When `tracker.kind != "local"`, the backend:

- Skips `insert_workspace_statuses/2` (statuses come from the remote at read time, see §6.4/§6.5).
- Skips `insert_workspace_setup/2` (workspace setup is local-tracker-specific). Repositories are still recorded (slice C will broaden multi-repo handling — for B, repos remain optional).
- Stores `tracker.config` in `local_tracker_projects.tracker_config`.

Old payloads without `tracker` continue to behave as `{"kind": "local", "config": {}}`.

### 6.9 Issue mapper / IssueDTO

A shared module `SymphonyElixir.Tracker.IssueDTO` builds `%{id, identifier, title, description, priority, position, status, labels, blocked_by, assignee, creator, created_at, updated_at, project_slug}`. Each adapter calls it.

`TrackerPresenter.issue/1` already accepts the local `IssueRecord` — we add a clause for `IssueDTO` (raw map / struct). Same JSON shape goes out.

## 7. Frontend design

### 7.1 Wizard step 1 — tracker picker

`ProjectWorkspaceWizard.tsx` gains a top-level step BEFORE the current GitHub-org step:

```
┌─ Tracker source ─────────────────────────────┐
│ ( ) Symphony local tracker (default)         │
│ ( ) GitHub Project v2 board                  │
│ ( ) Linear project                           │
└──────────────────────────────────────────────┘
```

- `local` → existing flow renders next (org pick + repo scan + suggest).
- `github` → fetch viewer's Project v2 boards; user picks one; we save `tracker_config` on submit. Repository scan is **optional** in slice B (workspace template handling belongs to slice C).
- `linear` → fetch viewer's Linear projects; user picks one; same.

For the MVP we **disable the multi-repo wizard parts when remote is chosen**: only `name`, `slug`, optional `description`, and tracker config are required. A muted hint says "Workspace setup is configured separately for remote projects (coming soon — slice C)."

### 7.2 Tracker picker component

`tracker/src/components/projects/TrackerSourcePicker.tsx` — a `RadioGroup` (shadcn) with three labelled cards.

### 7.3 GitHub/Linear remote browsers

`tracker/src/components/projects/GitHubProjectPicker.tsx`:
- Calls `discoverGitHubProjects()` from `services/remoteTrackers.ts` on mount.
- Renders a searchable list of boards (`<owner>/<title>`, with project number).
- On selection, calls `resolveGitHubProject(projectId)` to get the canonical metadata.

`LinearProjectPicker.tsx` mirrors this, grouped by Linear Team.

### 7.4 Service layer

`tracker/src/services/remoteTrackers.ts`:

```ts
export interface GitHubProjectSummary {
  id: string;
  number: number;
  title: string;
  owner: { login: string; kind: "user" | "organization" };
  repoNameWithOwner: string | null;
}

export interface GitHubProjectConfig {
  repo: string;
  projectId: string;
  projectNumber: number;
  statusField: string;
}

export async function discoverGitHubProjects(): Promise<GitHubProjectSummary[]>;
export async function resolveGitHubProject(projectId: string): Promise<GitHubProjectConfig>;

export interface LinearProjectSummary {
  id: string;
  slugId: string;
  name: string;
  state: string;
  team: { id: string; name: string };
}

export interface LinearProjectConfig {
  projectId: string;
  teamId: string;
  projectSlugId: string;
}

export async function discoverLinearProjects(): Promise<LinearProjectSummary[]>;
export async function resolveLinearProject(projectId: string): Promise<LinearProjectConfig>;
```

### 7.5 Project types

`tracker/src/types/project.ts`:

```ts
export type TrackerKind = "local" | "github" | "linear";

export interface ProjectTrackerConfig {
  kind: TrackerKind;
  config: Record<string, unknown>;
}

export interface Project {
  // existing fields ...
  tracker: ProjectTrackerConfig;
}
```

Mapper (`mappers.ts`) reads `dto.tracker_kind` + `dto.tracker_config` and builds `tracker`. Backwards compatible: missing fields default to `{ kind: "local", config: {} }`.

### 7.6 Polling & badge

A new hook `useTrackerPolling(projectSlug)` lives in `tracker/src/hooks/`:

- For `local`: returns `{ refetch }` but does not start a timer (channel handles updates).
- For `github`/`linear`: starts a 30 s interval refetching issues + statuses + comments-for-open-detail-pane. Also refetches on `window.focus` and on a manual refresh button.

A small badge in `ProjectHeader` shows the tracker kind ("Local", "GitHub Project", "Linear") with a refresh button. The board page consumes the hook.

### 7.7 Drag-and-drop on remote boards

Drag-and-drop (DnD) to reorder positions is **disabled** on remote projects (per D11). Cross-column drops (changing status) **are** enabled and call `move_issue` exactly like local — the adapter ignores the `position` argument. The frontend UX gates `onDragEnd` with `if (project.tracker.kind !== "local") { /* drop targets show columns only */ }`.

### 7.8 Filters & viewer (Slice A integration)

Slice A's filter drawer + viewer-aware "me" tokens already work because filtering is applied:

- For `local`: server-side (Context filters).
- For `github`/`linear`: client-side in `tracker/src/services/issues.ts` after the response (search by title/identifier/description, assignee match, creator match). The drawer UI is identical.

A new helper `filterIssuesClientSide(issues, filters, viewer)` lives in `tracker/src/services/issueFilters.ts` and is reused by remote adapters' UI layer.

## 8. Migration & backward compatibility

- Migration backfills `tracker_kind = "local"` for every existing project; no manual ops.
- Existing `Workflow.md`/CLI behaviour is unchanged: the orchestrator still reads `Config.tracker_kind/0`. Local-tracker users with `tracker.kind = "local"` see no difference.
- `IssueController` returns the same JSON shape; the frontend works without redeploy for `local` projects.
- New endpoints (`/github/projects/discover`, `/linear/projects/discover`) are additive.

### What if `tracker.kind` in `WORKFLOW.md` ≠ `local`?

This is the legacy "global tracker mode". For Slice B, we surface that as a one-time **default for the first project** the user creates: when the database has zero non-archived projects, the wizard's tracker picker pre-selects the kind matching `Config.tracker_kind/0` and pre-fills config from `GitHub.Config`/`Linear.Config`. The user can still change it. A follow-up slice will deprecate the global `tracker` YAML section in favour of per-project config; for now both coexist.

## 9. Error handling

Adapter errors → HTTP via `TrackerErrors.render/2`:

| Adapter return | HTTP status | error.code | message |
|----|---|---|---|
| `:project_not_found` | 404 | `project_not_found` | "Project not found" |
| `:issue_not_found` | 404 | `issue_not_found` | "Issue not found" |
| `:status_not_found` | 422 | `status_not_found` | "Workflow status not found" |
| `:missing_credentials` | 503 | `tracker_credentials_missing` | "GITHUB_TOKEN / LINEAR_API_KEY missing on server" |
| `:remote_unauthorized` | 502 | `tracker_unauthorized` | "Remote tracker rejected the token (401)" |
| `:remote_forbidden` | 502 | `tracker_forbidden` | "Remote tracker forbade the request (403)" |
| `:remote_rate_limited` | 429 | `tracker_rate_limited` | "Remote tracker rate limit hit; retry later" |
| `:remote_unavailable` | 502 | `tracker_unavailable` | "Remote tracker unreachable; try again" |
| `{:remote_validation, errors}` | 422 | `tracker_validation_failed` | with `details` map |
| `{:adapter_error, term}` | 500 | `tracker_internal` | sanitized message |
| Local Ecto changeset | 422 (unchanged) | as today | |

Frontend `toast.error` shows the localized message + a `Retry` action that calls `refetch()`.

## 10. Testing strategy

### 10.1 Backend (ExUnit)

- `SymphonyElixir.Tracker.IssueAdapterTest` — covers `for/1` dispatch + behaviour adherence (every implementation passes a shared contract suite via `ExUnit.Case.register_attribute(:adapter_under_test, ...)`).
- `SymphonyElixir.LocalTracker.IssueAdapterTest` — proves `defdelegate` chain works and DTO normalization matches what the controller already serializes today (snapshot via `TrackerPresenter.issue/1`).
- `SymphonyElixir.GitHub.IssueAdapterTest` — uses the existing `github_client_module` test override to stub GraphQL responses. Cases: list, list-with-empty-board, create + add-to-project, move (option ID resolution), comment, list-comments, error mapping for 401/403/rate-limit.
- `SymphonyElixir.Linear.IssueAdapterTest` — same approach with `linear_client_module` override.
- `SymphonyElixir.LocalTracker.Project` schema test — validates `tracker_kind` inclusion + `tracker_config` required keys per kind.
- `SymphonyElixirWeb.Tracker.IssueControllerTest` — adds remote-flavored cases by inserting a `Project` with `tracker_kind = "github"` and stubbing the adapter via `Application.put_env`.
- `SymphonyElixirWeb.Tracker.RemoteDiscoveryControllerTest` — exercises the four `/discover` and `/resolve` endpoints with stubbed clients.

### 10.2 Frontend (Vitest)

- `tracker/src/services/__tests__/remoteTrackers.test.ts` — mocks `axios` and checks payload shape.
- `tracker/src/services/__tests__/issueFilters.test.ts` — client-side filter helper.
- `tracker/src/components/projects/__tests__/TrackerSourcePicker.test.tsx` — radio interaction.
- `tracker/src/components/projects/__tests__/GitHubProjectPicker.test.tsx` and `LinearProjectPicker.test.tsx` — discovery flow + selection.
- `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx` — extends existing test to cover the new tracker step (local default + GH + Linear paths).
- `tracker/src/hooks/__tests__/useTrackerPolling.test.tsx` — interval + focus listener + manual refetch.

### 10.3 End-to-end smoke (manual)

1. Create a `local` project via wizard — same behaviour as today.
2. Create a `github` project pointing at a real Project v2 board. Verify board renders, create issue, move column, leave comment.
3. Same for Linear.
4. Window-focus refresh; manual refresh button; 30 s timer.
5. Drawer filters (Slice A) apply correctly client-side on remote boards.
6. Revoke `GITHUB_TOKEN` and confirm the board renders the structured error toast.

## 11. Open questions / future work

- **Cache layer.** If remote latency hurts UX (board switching, deep-link reload), add an ETS read-through cache with 10 s TTL per `(project_slug, query_kind)`.
- **Webhook ingestion.** GitHub webhooks → backend → Channel broadcast would remove the 30 s polling lag.
- **Per-project credentials.** Allow projects to use a different `GITHUB_TOKEN`/`LINEAR_API_KEY` (encrypted at rest).
- **Repo-only GitHub issues** (no Project v2 board).
- **Orchestrator over remote trackers.** Re-platform `SymphonyElixir.Tracker` on top of `IssueAdapter`, enabling poll/rework/terminal loops for GitHub/Linear projects.
- **Drag-to-reorder on remote boards.** Requires per-adapter strategy (GitHub Project v2 `updateProjectV2ItemPosition` mutation; Linear `issueUpdate(input: { sortOrder })`).
- **Server-side filter pushdown** to remote APIs (`assignee`, search) for very large boards.
- **Linear team selector** when a project's team membership is ambiguous.

## 12. Success criteria

A reviewer should be able to:

1. Run the migration on a populated DB without data loss; existing projects show `tracker_kind = "local"` and behave identically.
2. Create a new project pointing at a GitHub Project v2 board through the wizard, see issues render, create one, move it across columns, leave a comment — all without touching SQLite.
3. Repeat (2) for a Linear project.
4. See Slice A's filter drawer apply client-side on remote boards.
5. See the GitHub/Linear adapters return structured `tracker_unauthorized` / `tracker_unavailable` errors that the UI displays cleanly.
6. Run the full `mix test` + `pnpm test` suite green.

## Roadmap context (Symphony MVP)

| Slice | Title | Status |
|---|---|---|
| A | Viewer identity + board filters drawer | ✅ Spec + plan committed (`917a613`) |
| **B** | **Per-project tracker adapter** | **This document** |
| C | Workspace templates (multi-repo presets + bootstrap) | spec pending |
| D | Dev-environment discovery (`mise`, container, postgres, secrets) | spec pending |
