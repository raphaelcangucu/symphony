# Recents Sidebar + Freeform Assistant Chats — Design

> Adds a **Recents** section to the main left sidebar listing the most recent
> **sessions** across all projects (unified across **assistant chat threads** and
> **Codex/issue runs**), each row showing its **project** and **status**. To make
> that meaningful, it also upgrades the assistant to support **freeform chats**
> (not tied to any project) and **multiple threads**, with a data model ready for
> future **issue-scoped chats**. Read-only Recents; conversational freeform chat.

## 0. Workstreams (build order)

This is one feature delivered in four dependent workstreams:

- **WS-A — Thread model v2** (migration + schema/`History`): `scope`, nullable
  `project_slug`, `issue_identifier` (future), `title`, relaxed uniqueness.
- **WS-B — Channel & APIs**: thread-id-keyed channel topic, `CodexSession`
  per-thread/freeform turns, `GET/POST /assistant/threads`.
- **WS-C — Freeform assistant UI**: a global `/assistant` area to create/open
  freeform chats; `ProjectAssistantPanel` opens by thread id.
- **WS-D — Recents sidebar**: `Recents` builder + `GET /recents` + sidebar UI,
  consuming the contracts from WS-A/B.

## 1. Problem

The main left sidebar (`tracker/src/components/layout/ProjectSidebar.tsx`, in
`Layout.tsx`) lists static nav links and a **Boards** group. There is no
at-a-glance view of recent work-with-the-assistant: which chats and Codex runs
happened recently, in which project, and in what state.

Two "session" concepts exist today:

- **Assistant chat threads** — persisted in `assistant_threads` +
  `assistant_messages` (`SymphonyElixir.Assistant.{Thread,Message,History}`).
  Today a thread is **mapped to a project only — not to an issue**, with exactly
  **one active thread per project** (partial unique index
  `assistant_threads_active_project_slug_index`). `status` is
  `active`/`closed`/`error`; rows have `updated_at`.
- **Codex/agent executions** — **not persisted**. `AgentExecution.list/0`
  derives them live from the orchestrator's in-memory `running`/`retrying`
  snapshot; finished runs vanish. The persisted proxy for a finished run is the
  **issue** (title, workflow `status`, `branch_name`, `updated_at`, `assignee`).

The user also wants two new capabilities: **freeform chats** with the assistant
that are not bound to a project, and (future) the assistant **creating issues**
in place of the modal. The Recents list must accommodate project-less chats.

## 2. Goals (v1)

1. A **Recents** group in the sidebar listing recent sessions across all
   projects, ranked by recency, capped (default 20), each row showing project
   (or "Geral" when none) and a status indicator.
2. Two row **kinds**:
   - **Chat row** — an `assistant_threads` record. Title = thread `title` or
     latest user-message preview (fallback: project name / "Freeform chat").
     Status = thread `status` (`active`/`closed`/`error`).
   - **Codex row** — an issue that has had a Codex run (see §3). Title = issue
     title. Status = live execution state when active
     (`live`/`waiting`/`retrying`/`idle`), else the issue's workflow status.
3. **Freeform chats**: create and open chats not tied to any project, from a
   global `/assistant` area; multiple freeform chats allowed. Freeform chat is
   **conversational only** (no tracker tools) in v1.
4. **Multiple threads** supported generally; the assistant opens a chat by
   **thread id**. Project chats keep "one active per project" behavior.
5. Clicking a Recents row navigates: chat → its assistant view (project or
   freeform); codex → the issue's **Agent** tab.
6. Degrade gracefully: unavailable orchestrator → chat-only/branch-only recents;
   client fetch failure keeps the last known list.

## 3. Ambiguity resolved (Codex row signal)

A Codex run is not a persisted entity, so a row source is chosen: a **Codex row**
is an issue that **either** is currently present in `AgentExecution.list/0`
(active run) **or** has a non-empty **`branch_name`** (Symphony creates a
per-issue branch when dispatching Codex). Ranked by `last_event_at` when active,
else `updated_at`. Tunable inside `Recents` without changing the API contract.

## 4. Non-goals

- **Issue-scoped chats** — the model is made ready (`scope: "issue"`,
  `issue_identifier`) but the feature is **not** implemented in v1; issues are
  represented by the Codex row.
- **Assistant creates issues (replacing the modal) with skills** — future;
  noted in §12. No implementation in v1.
- **Tracker tools inside freeform chats** — freeform is conversational only.
- **Persisting Codex run history** (`agent_execution_runs`) — future
  (§12); v1 reads existing persisted/live data only.
- **Per-run transcript replay** for Codex runs.
- **Realtime push of Recents** — v1 uses focus-aware polling like
  `useAgentExecutions`.
- **Renaming/deleting threads from the sidebar** — Recents is read-only
  navigation. (Creating freeform chats happens in the `/assistant` area.)

---

## WS-A — Thread model v2

### A.1 Migration

New migration altering `assistant_threads`:

- `add :scope, :string, null: false, default: "project"` (`project`|`freeform`|`issue`).
- `modify :project_slug, :string, null: true` (was `null: false`).
- `add :issue_identifier, :string` (nullable; reserved for future issue scope).
- `add :title, :string` (nullable; user-facing chat name).
- Drop `assistant_threads_active_project_slug_index`; recreate scoped to project
  rows only:
  `unique_index(:assistant_threads, [:project_slug], where: "status = 'active' AND scope = 'project'", name: :assistant_threads_active_project_index)`.
- Future-proofing (created now, harmless): partial unique index for issue scope
  `unique_index(:assistant_threads, [:project_slug, :issue_identifier], where: "status = 'active' AND scope = 'issue'", name: :assistant_threads_active_issue_index)`.
- Backfill: existing rows get `scope = "project"` (default covers it).

### A.2 Schema & changeset (`Assistant.Thread`)

- Cast/allow `scope`, `issue_identifier`, `title`; `project_slug` no longer
  globally required.
- `validate_inclusion(:scope, ["project", "freeform", "issue"])`.
- Conditional required fields:
  - `scope == "project"` → `project_slug` required.
  - `scope == "issue"` → `project_slug` and `issue_identifier` required.
  - `scope == "freeform"` → `project_slug` must be `nil`.
- Keep `workspace_path`, `status` required; keep status inclusion.
- Replace the unique constraint name with `:assistant_threads_active_project_index`.

### A.3 `Assistant.History`

- `get_thread(id)` — fetch a thread by id.
- `list_threads(opts)` — `:scope`, `:project_slug`, `:limit`, ordered by
  `updated_at` desc; used by the threads API and Recents.
- `ensure_thread/2` keeps returning the active **project** thread (unchanged for
  project scope) and gains `create_thread/1` for freeform creation
  (`scope: "freeform"`, no project).
- `latest_message(thread_id)` — for previews (Recents + thread list).
- `list_messages/1` gains a thread-id arity: `list_messages_for_thread(id)`.

---

## WS-B — Channel & APIs

### B.1 Assistant channel (`SymphonyElixirWeb.AssistantChannel`)

Support both topic shapes (minimize breakage):

- `assistant:<project_slug>` — existing behavior; resolves/creates the active
  project thread (unchanged).
- `assistant:thread:<id>` — joins a specific thread (project or freeform). On
  join, load that thread's history; assign `:thread_id` (and `:project_slug` /
  `:scope`) to the socket.

`handle_in("send_message", …)` routes by the socket's thread context:

- Project thread → existing `CodexSession.send_message(project_slug, …)`.
- Freeform thread → new `CodexSession.send_message_to_thread(thread, …)` that
  uses the freeform workspace and **omits** `dynamic_tools`/`tool_executor`
  (conversational only).

`user_socket.ex` already routes `assistant:*`, so the new sub-topic needs no
socket change.

### B.2 `Assistant.CodexSession` — freeform turns

- `assistant_workspace/2` gains a freeform variant:
  `workspace_root/assistant/freeform/<thread-id>`.
- `send_message_to_thread(thread, message, context, opts)`:
  - ensures the freeform workspace,
  - appends the user message, builds a **conversational** prompt (no project
    tools, no project slug in the system preamble),
  - runs the Codex turn **without** `dynamic_tools`/`tool_executor`,
  - persists the assistant message; same streaming callbacks as today.
- Existing project `send_message/4` is unchanged.

### B.3 Threads REST API (`tracker_api` pipeline)

- `GET /api/tracker/v1/assistant/threads?scope=&project_slug=&limit=` →
  `{ data: [thread…] }` where each thread = `id`, `scope`, `project_slug`,
  `project_name`, `issue_identifier`, `title`, `status`, `preview`,
  `updated_at`.
- `POST /api/tracker/v1/assistant/threads` body `{ scope, project_slug?, title? }`
  → creates a thread (v1 supports `freeform` and `project`); returns the thread.
- New `AssistantThreadController`; presenter `TrackerPresenter.assistant_thread/1`.
- Routes added near the existing `/projects/:project_slug/assistant/*` routes.

---

## WS-C — Freeform assistant UI

### C.1 Global assistant area

- New nav link **Assistant** in `ProjectSidebar` → route `/assistant`.
- New page `tracker/src/pages/AssistantPage.tsx` (mounted under `Layout`):
  - left: list of freeform chats (from `GET /assistant/threads?scope=freeform`)
    + a **New chat** button (`POST /assistant/threads {scope:"freeform"}`),
  - right: the chat panel for the selected thread.
- Route: `/assistant` and `/assistant/:threadId` in `App.tsx`.

### C.2 `ProjectAssistantPanel` opens by thread id

- Accept an optional `threadId`; when present, join `assistant:thread:<id>`;
  otherwise keep the project topic `assistant:<projectSlug>` (back-compat).
- Extract the chat surface so both the project route and the freeform page reuse
  it. The freeform variant hides project-only affordances.
- `services/assistant.ts` + `services/phoenix/assistantChannel.ts` gain a
  `assistantThreadTopic(id)` helper alongside `assistantTopic(slug)`.

### C.3 Frontend services/types for threads

- `tracker/src/types/assistant-thread.ts`: `AssistantThread` (`id`, `scope`,
  `projectSlug|null`, `projectName|null`, `issueIdentifier|null`, `title|null`,
  `status`, `preview|null`, `updatedAt`).
- `tracker/src/services/assistantThreads.ts`: `listThreads(params)` and
  `createThread(input)` with tolerant normalizers (snake/camel).

---

## WS-D — Recents sidebar

### D.1 Backend `SymphonyElixir.Recents`

```elixir
@type kind :: :chat | :codex
@type scope :: :project | :freeform | :issue
@type status_kind ::
        :running | :waiting | :retrying | :idle |
        :active | :done | :closed | :error | :todo | :in_progress

@type item :: %{
        kind: kind(),
        scope: scope() | nil,            # nil for codex rows
        id: String.t(),                  # "chat:42" | "codex:ABC-12"
        project_slug: String.t() | nil,  # nil for freeform chats
        project_name: String.t() | nil,
        title: String.t(),
        identifier: String.t() | nil,    # issue id for :codex
        thread_id: integer() | nil,      # for :chat rows
        status: String.t(),
        status_kind: status_kind(),
        preview: String.t() | nil,
        updated_at: DateTime.t()
      }

@spec list(keyword()) :: [item()]        # opts: :limit (default 20)
```

Assembly:

1. **Chat items** — `History.list_threads(limit: …)` across all scopes ordered
   by `updated_at`; attach `latest_message` preview; resolve `project_name` from
   `LocalTracker.Context` when `project_slug` present (else `nil` → "Geral").
   Map thread `status` → `status_kind`.
2. **Codex items** — per project, list issues via `LocalTracker.Context`, keep
   those matching §3, overlay `AgentExecution.list/0` by identifier; map status
   (active → `running`/`waiting`/`retrying`/`idle`; else workflow status name →
   `done`/`in_progress`/`todo`/`active`).
3. **Merge & rank** by `updated_at` desc; take `:limit`.

Graceful degradation: wrap the snapshot read like `AgentExecution.list/0`
(empty on unavailable/timeout) → chat + branch-derived rows still returned.

### D.2 Endpoint & presenter

- `get("/recents", RecentsController, :index)` in the `tracker_api` pipeline.
- `RecentsController.index/2`: clamp `limit` to `1..50` (default 20);
  `Enum.map(Recents.list(limit: limit), &TrackerPresenter.recent_item/1)`;
  `json(conn, %{data: data})`.
- `TrackerPresenter.recent_item/1` → snake_case JSON: `type`, `scope`, `id`,
  `project_slug`, `project_name`, `title`, `identifier`, `thread_id`, `status`,
  `status_kind`, `preview`, `updated_at`.

### D.3 Frontend types/service/hook

- `tracker/src/types/recents.ts`:

```ts
export type RecentKind = "chat" | "codex";
export type RecentScope = "project" | "freeform" | "issue";
export type RecentStatusKind =
  | "running" | "waiting" | "retrying" | "idle"
  | "active" | "done" | "closed" | "error" | "todo" | "in_progress";

export interface RecentSession {
  kind: RecentKind;
  scope: RecentScope | null;
  id: string;
  projectSlug: string | null;
  projectName: string | null;
  title: string;
  identifier: string | null;
  threadId: number | null;
  status: string;
  statusKind: RecentStatusKind;
  preview: string | null;
  updatedAt: string;
}
```

- `tracker/src/services/recents.ts`: `listRecents(limit?)` → `GET /recents` +
  `normalizeRecentSession` (tolerant of snake/camel; mirrors
  `agentExecutions.ts`).
- `tracker/src/hooks/useRecents.ts`: focus-aware ~10s polling, keep-last on
  failure, refetch on `TRACKER_PROJECTS_CHANGED_EVENT`; returns
  `{ recents, loading, refetch }`.

### D.4 UI

- `tracker/src/components/layout/RecentsSection.tsx`: each row = type icon
  (`MessageSquare` chat, `Bot` codex), truncated title, small project label (or
  "Geral"), status dot + short label. Click navigates:
  - chat, project scope → `assistantPath(projectSlug)`
  - chat, freeform scope → `/assistant/${threadId}`
  - codex → `issuePath(projectSlug, "board", identifier, "agent")`
- Shared `RecentStatusDot` maps `RecentStatusKind` → color/label, reusing the
  `AgentStatusBadge` palette for `running`/`waiting`/`retrying`/`idle` and adding
  `active`(blue), `done`(emerald+check), `closed`(slate), `error`(red),
  `todo`(slate), `in_progress`(blue).
- `ProjectSidebar.tsx`: middle scroll area holds **Recents** (top) then
  **Boards**; empty Recents shows a dashed "No recent sessions yet." placeholder.

## 5. Data flow

```
Sidebar mount
  → useRecents() polls GET /recents?limit=20 (focus-aware)
      → Recents.list/1
          ├─ History.list_threads (all scopes) + latest_message + project_name
          └─ issues (branch/active signal) ⊕ AgentExecution.list/0 overlay
      → merge + rank + limit
  → rows render: type icon + project|"Geral" + status dot
  → click → assistantPath | /assistant/:threadId | issuePath(...,"agent")

/assistant area
  → GET /assistant/threads?scope=freeform  (list)
  → POST /assistant/threads {scope:"freeform"}  (new chat)
  → open thread → channel join assistant:thread:<id> → send_message_to_thread
```

## 6. Error handling & edge cases

- Orchestrator snapshot down/timeout → Codex live overlay empty; chat +
  branch-derived rows still listed (no error surfaced).
- Freeform chat with no project → no tracker tools; `project_*` are `nil`;
  Recents groups it under "Geral".
- Project with no chats and no qualifying issues contributes nothing.
- Issue in the live snapshot but absent from the store → listed from snapshot
  fields (title falls back to identifier).
- Client fetch failure → keep last known recents; never blank the list.
- `limit` clamped server-side (1..50); titles/previews truncated in UI;
  identifiers normalized via `normalizeIssueIdentifier`.
- Back-compat: `assistant:<project_slug>` topic keeps working unchanged.

## 7. Testing

Backend:
- `assistant/thread_test.exs`: scope validation, conditional required fields,
  freeform requires nil project, unique-active-project still enforced.
- migration smoke (schema fields present; old rows default to `scope:"project"`).
- `assistant/history_test.exs`: `list_threads` filters/order, freeform create,
  `latest_message`, thread-id message listing.
- `assistant/codex_session_test.exs`: freeform turn uses freeform workspace and
  **no** tool specs; project turn unchanged.
- `assistant_channel_test.exs`: join `assistant:thread:<id>` loads history;
  freeform `send_message` routes to `send_message_to_thread`; project topic
  back-compat.
- `tracker/assistant_thread_controller_test.exs`: list/create shape + auth.
- `recents_test.exs`: chat ordering+preview, codex signal, live overlay,
  workflow fallback, merge/rank, `:limit` clamp, graceful degradation.
- `tracker/recents_controller_test.exs`: JSON shape, snake_case, auth, `limit`.

Frontend:
- `services/__tests__/recents.test.ts`, `assistantThreads.test.ts`: normalizers.
- `hooks/__tests__/useRecents.test.tsx`: polling, focus gating, keep-last.
- `components/layout/__tests__/ProjectSidebar.test.tsx`: Recents rows (icons,
  status dots, project/"Geral" labels, link targets), empty state, Assistant nav
  link.
- `pages/__tests__/AssistantPage.test.tsx`: list freeform chats, create new chat,
  open by thread id.

## 8. Files

New (backend):
- `elixir/priv/repo/migrations/<ts>_extend_assistant_threads_scope.exs`
- `elixir/lib/symphony_elixir/recents.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/recents_controller.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`

New (frontend):
- `tracker/src/types/recents.ts`, `tracker/src/types/assistant-thread.ts`
- `tracker/src/services/recents.ts`, `tracker/src/services/assistantThreads.ts`
- `tracker/src/hooks/useRecents.ts`
- `tracker/src/components/layout/RecentsSection.tsx`
- `tracker/src/pages/AssistantPage.tsx`
- tests in §7.

Modified (backend):
- `assistant/thread.ex`, `assistant/history.ex`, `assistant/codex_session.ex`
- `channels/assistant_channel.ex`
- `web/router.ex`, `web/presenters/tracker_presenter.ex`

Modified (frontend):
- `components/layout/ProjectSidebar.tsx` (Recents group + Assistant nav)
- `components/assistant/ProjectAssistantPanel.tsx` (open by thread id; extract
  reusable surface)
- `services/assistant.ts`, `services/phoenix/assistantChannel.ts`
- `App.tsx` (routes `/assistant`, `/assistant/:threadId`)
- optional shared `RecentStatusDot` near `AgentStatusBadge.tsx`.

## 9. Risks

- **Assistant channel/runtime refactor** touches working chat code. Mitigation:
  keep the `assistant:<project_slug>` topic intact; add the thread topic
  alongside; cover both with tests before switching the UI.
- **Cost of listing issues across all projects** each poll. Mitigation: rank/
  limit early; 10s focus-aware interval; revisit for large datasets.
- **Codex signal accuracy** (§3) — contained to `Recents`; API unaffected.
- **Migration on `project_slug` nullability** + index swap. Mitigation: default
  backfill to `scope:"project"`; recreate the partial index in the same change;
  test old-row behavior.
- **Sidebar vertical space** with two scrolling groups. Mitigation: cap Recents
  height; shared scroll.

## 10. Future (contract-ready, not in v1)

- **Issue-scoped chats** (`scope:"issue"`, `issue_identifier`) — schema + indexes
  already prepared; add UI + channel/topic wiring later.
- **Assistant creates the issue** (replacing the create-issue modal) using
  skills — a new flow where a chat turn produces a tracker `create_issue` (and
  related) action; freeform chats would gain an opt-in project target. Builds on
  the existing `ToolExecutor` tool path.
- **Persisted Codex run history** (`agent_execution_runs`) for true per-run
  status/multiple-runs-per-issue; the §D.2 contract absorbs it by swapping the
  Codex item source without changing the response shape.
