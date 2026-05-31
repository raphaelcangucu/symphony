# Recents Sidebar — Assistant & Codex Sessions — Design

> Adds a **Recents** section to the main left sidebar (next to **Boards**) that
> lists the most recent **sessions** across all projects, unified across two
> kinds — **assistant chat threads** and **Codex/issue runs** — each row showing
> the **project** it belongs to and the **status** of the session. Read-only v1
> built entirely on data Symphony already persists or already exposes; no schema
> migration.

## 1. Problem

The main left sidebar (`tracker/src/components/layout/ProjectSidebar.tsx`,
mounted in `Layout.tsx`) currently lists static nav links (Projects, Templates,
Observability) and a **Boards** group of projects. There is no way to see, at a
glance, the recent work-with-the-assistant: which chats and which Codex runs
happened recently, in which project, and what state they are in.

Two "session" concepts exist in the codebase today:

- **Assistant chat threads** — persisted in `assistant_threads` +
  `assistant_messages` (`SymphonyElixir.Assistant.{Thread,Message,History}`).
  One active thread per project; `status` is `active` / `closed` / `error`;
  rows have `updated_at`. Real recency and a last-message preview are queryable.
- **Codex/agent executions** — **not persisted**. `SymphonyElixir.AgentExecution.list/0`
  derives them live from the orchestrator's in-memory `running` / `retrying`
  snapshot. When an issue's run finishes it disappears from the snapshot. The
  only persisted proxy for a finished Codex run is the **issue** itself (title,
  workflow `status`, `branch_name`, `updated_at`, `assignee`).

The `/api/tracker/v1/agent_executions` endpoint and the Observability page only
surface **currently running** sessions; neither provides a unified, time-ranked
"recents" list including finished work.

## 2. Goal

1. A **Recents** group in the sidebar listing the most recent sessions across
   **all** projects, ranked by recency, capped (default 20).
2. Each row is one of two **types**, visually distinguished, and shows the
   **project** and a **status** indicator:
   - **Chat row** — an `assistant_threads` record. Title = latest user-message
     preview (fallback: project name). Status = thread `status`
     (`active` / `closed` / `error`).
   - **Codex row** — an issue that has had a Codex run. Title = issue title.
     Status = the **live** execution state when the issue is currently in the
     orchestrator snapshot (`live` / `waiting` / `retrying` / `idle`); otherwise
     the issue's workflow status (e.g. In Review, Done).
3. Clicking a row navigates: chat → the project assistant page; codex → the
   issue's **Agent** tab.
4. Degrade gracefully: an unavailable orchestrator snapshot yields chat-only
   recents (never an error); a frontend fetch failure keeps the last known list.

## 3. Non-goals

- **Persisting Codex run history** (a discrete `agent_execution_runs` table with
  per-run start/finish/outcome). That is the future "Approach B" and is
  explicitly deferred. v1 reads only existing persisted/live data.
- **Starting a new chat, archiving, renaming, or deleting** sessions from the
  sidebar. Read-only navigation only.
- **Per-run transcript replay** for Codex runs (only assistant chat threads have
  persisted message history; issue runs do not).
- **Real-time push** of recents via Phoenix channels. v1 uses focus-aware
  polling, consistent with `useAgentExecutions`.
- **Multiple assistant threads per project.** The backend still keeps one active
  thread per project; this feature only lists what exists.

## 4. Ambiguity resolved (Codex row signal)

"A Codex session" is not a persisted entity, so a row source must be chosen. v1
defines a Codex row as an **issue that satisfies either**:

- it is **currently present** in `AgentExecution.list/0` (active run), **or**
- it has a non-empty **`branch_name`** (Symphony creates a per-issue branch when
  dispatching Codex, so this marks "a Codex run happened for this issue").

Issues are ranked by `updated_at` (or `last_event_at` when an active execution
exists for them). This is a pragmatic, persisted, no-migration signal. If it
proves too broad/narrow in practice, the signal can be tuned in the `Recents`
module without changing the API contract.

## 5. Architecture

### 5.1 Backend — `SymphonyElixir.Recents`

New module `lib/symphony_elixir/recents.ex` that assembles the unified list.

```elixir
@type kind :: :chat | :codex
@type status_kind ::
        :running | :waiting | :retrying | :idle |
        :active | :done | :closed | :error | :todo | :in_progress

@type item :: %{
        kind: kind(),
        id: String.t(),                 # stable row id (e.g. "chat:42", "codex:ABC-12")
        project_slug: String.t(),
        project_name: String.t(),
        title: String.t(),
        identifier: String.t() | nil,   # issue identifier for :codex, nil for :chat
        status: String.t(),             # human label, e.g. "Live", "Done", "Active"
        status_kind: status_kind(),     # machine token for the UI dot/badge
        preview: String.t() | nil,      # last message snippet (chat) or last codex message
        updated_at: DateTime.t()
      }

@spec list(keyword()) :: [item()]   # opts: :limit (default 20)
```

Assembly:

1. **Chat items** — query `assistant_threads` across all projects ordered by
   `updated_at` desc; for each, fetch the latest message for `preview` and
   resolve `project_name` from `LocalTracker.Context`. Map thread `status` →
   `status_kind` (`active`/`closed`/`error`) and a human `status` label.
2. **Codex items** — for each project, list issues (via existing
   `LocalTracker.Context`), keep those matching the §4 signal, and overlay live
   status from `AgentExecution.list/0` keyed by issue identifier. Map to
   `status_kind`: active execution → `running`/`waiting`/`retrying`/`idle`;
   otherwise derive from the issue workflow status name (e.g. Done → `done`,
   In Review → `in_progress`/`active`, Todo → `todo`).
3. **Merge & rank** — concatenate, sort by `updated_at` desc, take `:limit`.

Graceful degradation: wrap the orchestrator snapshot read the same way
`AgentExecution.list/0` already does (empty on unavailable/timeout) so a missing
orchestrator yields chat-only recents.

Public `def`s get adjacent `@spec` (per `elixir/AGENTS.md`).

### 5.2 Backend — endpoint & presenter

- Route (in the `tracker_api` pipeline, `router.ex`):
  `get("/recents", RecentsController, :index)`.
- `lib/symphony_elixir_web/controllers/tracker/recents_controller.ex`:

```elixir
def index(conn, params) do
  limit = parse_limit(params)            # clamp to e.g. 1..50, default 20
  data = Enum.map(Recents.list(limit: limit), &TrackerPresenter.recent_item/1)
  json(conn, %{data: data})
end
```

- `TrackerPresenter.recent_item/1` serializes one item to snake_case JSON:
  `type`, `id`, `project_slug`, `project_name`, `title`, `identifier`,
  `status`, `status_kind`, `preview`, `updated_at`.

### 5.3 Frontend — types & service

- `tracker/src/types/recents.ts`:

```ts
export type RecentKind = "chat" | "codex";
export type RecentStatusKind =
  | "running" | "waiting" | "retrying" | "idle"
  | "active" | "done" | "closed" | "error" | "todo" | "in_progress";

export interface RecentSession {
  kind: RecentKind;
  id: string;
  projectSlug: string;
  projectName: string;
  title: string;
  identifier: string | null;
  status: string;
  statusKind: RecentStatusKind;
  preview: string | null;
  updatedAt: string;
}
```

- `tracker/src/services/recents.ts`: `listRecents(limit?)` → `GET /recents`,
  with a `BackendRecentItemDto` + `normalizeRecentSession` (tolerant of
  snake/camel, mirroring `agentExecutions.ts`).

### 5.4 Frontend — hook

- `tracker/src/hooks/useRecents.ts`: focus-aware polling (~10s) that keeps the
  last known list on failure (mirrors `useAgentExecutions`), exposes
  `{ recents, loading, refetch }`, and refetches on `TRACKER_PROJECTS_CHANGED_EVENT`.

### 5.5 Frontend — UI

- `tracker/src/components/layout/RecentsSection.tsx`: renders the **Recents**
  group. Each row: a type icon (`MessageSquare` for chat, `Bot` for codex), a
  truncated title, a small project label, and a status dot + short label. Click
  → `NavLink`/`useNavigate` to:
  - chat: `assistantPath(projectSlug)`
  - codex: `issuePath(projectSlug, "board", identifier, "agent")`
- Status visuals: extend the existing dot/badge vocabulary. Reuse
  `AgentStatusDot`/`AgentStatusBadge` colors for `running`(live)/`waiting`/
  `retrying`/`idle`, and add `active`(blue), `done`(emerald + check),
  `closed`(slate), `error`(red), `todo`(slate), `in_progress`(blue). A small
  shared `RecentStatusDot` maps `RecentStatusKind` → color/label.
- `ProjectSidebar.tsx`: the middle scroll area holds two labeled groups —
  **Recents** (new, on top) then **Boards** (existing). Empty Recents shows a
  dashed "No recent sessions yet." placeholder consistent with the Boards empty
  state.

## 6. Data flow

```
Sidebar mount
  → useRecents() polls GET /api/tracker/v1/recents?limit=20 (focus-aware)
      → Recents.list/1
          ├─ assistant_threads (ordered) + latest message preview + project name
          └─ issues (per project, branch/active signal) ⊕ AgentExecution.list/0 overlay
      → merge + rank + limit
  → rows render with type icon + project label + status dot
  → click → assistantPath | issuePath(...,"agent")
```

## 7. Error handling & edge cases

- Orchestrator snapshot unavailable/timeout → Codex live overlay empty; chat
  rows and branch-derived issue rows still listed (no error surfaced).
- A project with no chats and no qualifying issues contributes nothing.
- Issue present in the live snapshot but missing from the issue store → still
  listed using snapshot fields (title falls back to identifier).
- Fetch failure on the client → keep last known recents; never blank the list.
- `limit` is clamped server-side (1..50).
- Long titles/previews are truncated in the UI; identifiers are normalized via
  the existing `normalizeIssueIdentifier`.

## 8. Testing

Backend:
- `test/symphony_elixir/recents_test.exs`: chat ordering + preview, codex signal
  selection, live-status overlay, workflow-status fallback mapping, merge/rank,
  `:limit` clamping, graceful degradation when the orchestrator is down.
- `test/.../tracker/recents_controller_test.exs`: JSON shape, snake_case keys,
  auth via `TrackerAuth`, `limit` param handling.

Frontend:
- `services/__tests__/recents.test.ts`: normalizer (snake/camel, nulls, kinds).
- `hooks/__tests__/useRecents.test.tsx`: polling, focus gating, keep-last-on-error.
- Extend `components/layout/__tests__/ProjectSidebar.test.tsx`: Recents rows
  render with correct icons, status dots, project labels, and link targets;
  empty-state placeholder.

## 9. Files

New:
- `elixir/lib/symphony_elixir/recents.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/recents_controller.ex`
- `tracker/src/types/recents.ts`
- `tracker/src/services/recents.ts`
- `tracker/src/hooks/useRecents.ts`
- `tracker/src/components/layout/RecentsSection.tsx`
- tests listed in §8.

Modified:
- `elixir/lib/symphony_elixir_web/router.ex` (route)
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` (presenter)
- `tracker/src/components/layout/ProjectSidebar.tsx` (mount Recents group)
- (optional) extract a shared `RecentStatusDot` near `AgentStatusBadge.tsx`.

## 10. Risks

- **Cost of listing issues across all projects** each poll. Mitigation: cap work
  (rank/limit early; consider a cheap per-project recency cap) and rely on the
  10s focus-aware interval; revisit if projects/issues grow large.
- **Codex signal accuracy** (§4) — branch-name may over- or under-include.
  Contained to the `Recents` module; API contract unaffected if tuned.
- **Sidebar vertical space** with two scrolling groups. Mitigation: cap Recents
  height and let both groups share the scroll area.

## 11. Future (Approach B)

Persist a discrete `agent_execution_runs` record per dispatch (start/finish,
final outcome, tokens, last message) written by the orchestrator, enabling true
per-run history, multiple runs per issue, and accurate finished-run statuses.
The §5.2 API contract is designed to absorb this by swapping the Codex item
source without changing the response shape.
