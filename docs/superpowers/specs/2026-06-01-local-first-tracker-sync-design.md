# Local-First Tracker + Continuous Bidirectional Sync — Design

- **Date:** 2026-06-01
- **Status:** Draft (design approved in brainstorming; pending user review of written spec)
- **Area:** `elixir/` — tracker subsystem (local tracker, GitHub/Linear adapters, orchestrator)

## Problem & Motivation

Today Symphony has two tracker abstractions:

- **Orchestrator** `SymphonyElixir.Tracker` (global `tracker_kind` from `WORKFLOW.md`).
- **UI/API** `SymphonyElixir.Tracker.IssueAdapter` (per-project `Project.tracker_kind` on the SQLite row).

Only the **local** tracker persists issues/comments/labels/relations in SQLite. For `github` and `linear`, **both** the UI request path and the orchestrator read/write the remote API live (GitHub uses only a 60s `ReadCache` for PR-discussion enrichment at dispatch). There is **no** background mirror of remote issues into the local DB.

Consequences:

- Every board load / issue detail / poll hits the remote API. When GitHub GraphQL is rate-limited, the UI hangs and (as recently observed) request handlers and even app boot can freeze. This is the class of bug that motivated this work.
- Linear writes are `:not_supported_on_remote` in the UI.
- PRs, remote comments, and labels are not durably stored, so features must re-fetch live.

**Goal:** Make every tracker (local/github/linear) **local-first**: the UI and orchestrator read from the local SQLite DB and write locally first; a single background **SyncEngine** is the only component that talks to the remote APIs, mirroring remote changes down and flushing local changes up, continuously. GitHub remains the default **source control**, so Pull Requests are synced for every project that has a GitHub repository, independent of `tracker_kind`.

## Approved Decisions (from brainstorming)

1. **Scope:** single comprehensive SPEC — local-first reads + continuous pull + write-local-with-outbox + conflict resolution + complete field/entity mapping.
2. **Conflict resolution:** field-level **last-writer-wins (LWW)** with outbox replay (local pending edits replay over remote; untouched fields take remote).
3. **Trigger/cadence:** sync runs on the **orchestrator poll heartbeat** (shared cadence); a **force-sync flag** triggers an immediate sync right after a local write (no waiting a full interval).
4. **Data model:** **unify** into `local_tracker_issues` (+ comments/labels/relations) with sync metadata; the UI has a single local read path for all tracker kinds.
5. **Source control:** PR structure/sync exists for **all** projects with a GitHub repo, independent of `tracker_kind`.

## Architecture Overview

```
UI (React) + API controllers ── read/write local ──▶ LocalTracker.Context (SQLite)
Orchestrator poll cycle ─────── read candidates ───▶ LocalTracker.Context
        │ (each cycle) request_sync(project, force?)
        ▼
Tracker.Sync.Engine (GenServer)
   push: outbox → remote   |   pull: remote → local   |   conflict: LWW per field
        │ all remote I/O via SymphonyElixir.GitHub.RequestGateway (fail-fast on rate limit)
        ▼
GitHub GraphQL / Linear GraphQL
```

Principles:

- **Read local-first:** `Tracker.IssueAdapter` (UI) and `Tracker.fetch_candidate_issues` (orchestrator) read from `LocalTracker.Context` for *all* kinds. The remote API is never called on the UI request path.
- **Write local-first:** every mutation writes to SQLite immediately **and** enqueues an outbox entry; the UI reflects instantly.
- **Single remote owner:** `Tracker.Sync.Engine` is the only component that calls GitHub/Linear. It runs on the orchestrator heartbeat and routes all remote calls through `RequestGateway`, which fails fast under rate limit — so a rate-limited remote never blocks the UI.

## Data Model

All new columns are nullable so native local projects are unaffected (`sync_status` defaults to `synced`, sync columns null). New migrations are additive.

### New columns on existing tables

`local_tracker_issues`: `remote_id` (string), `remote_number` (integer), `remote_url` (string), `sync_status` (string: `synced`/`pending`/`conflict`/`error`/`archived`), `remote_updated_at` (utc_datetime_usec), `last_synced_at` (utc_datetime_usec), `dirty_fields` (map: `field => changed_at`), `last_sync_error` (string). Partial unique index `(project_id, remote_id)` where `remote_id` is not null.

`local_tracker_comments`: `remote_id`, `sync_status`, `remote_updated_at`, `last_synced_at`, `dirty_fields`.

`local_tracker_labels`: `remote_id` (label node id).

`local_tracker_issue_relations`: `remote_origin` (boolean) to distinguish remote-derived blockers (`trackedInIssues` / `inverseRelations`) from purely local relations (for deletion reconciliation).

### New tables

`tracker_sync_outbox`: `id`, `project_id` (FK), `issue_id` (FK, nullable for create), `entity_type` (`issue`/`comment`/`label`/`state`/`assignee`), `operation` (`create`/`update`/`move`/`add`/`remove`), `payload` (map), `dedup_key` (string), `status` (`pending`/`in_flight`/`done`/`failed`/`conflict`), `attempts` (integer), `last_error` (string), `remote_id` (string, filled after create), timestamps.

`tracker_sync_state` (per project): `project_id` (FK, unique), `last_full_sync_at`, `last_incremental_cursor` (string), `last_pull_at`, `last_push_at`, `status` (`idle`/`syncing`/`error`), `last_error`.

`tracker_pull_requests`: `id`, `issue_id` (FK), `remote_id`, `number`, `url`, `title`, `state` (`open`/`closed`/`merged`), `last_synced_at`, timestamps.

`tracker_users` (assignee/author cache): `id`, `project_id` (FK), `remote_id`, `login`, `name`, `avatar_url`, timestamps.

### Notes

- `agent_session_id`, `worker_id`, `agent_goal` remain local-only and are never pushed.
- Mirrored data is fully reconstructible via a fresh full sync (idempotent upserts).

## Sync Algorithm

Per project, each heartbeat cycle runs **push → pull → pr-sync** (push first so local writes land before we re-pull and compare).

### Push (outbox → remote)

For each `pending` outbox entry (ordered by `inserted_at`, coalesced by `dedup_key`): mark `in_flight`; apply remotely via the driver (create issue / add comment / move state / add|remove label / update field / set assignee) through `RequestGateway`.

- `:ok` → store `remote_id` on the local row (if create), clear the `dirty_fields` covered by the op, set `status=done`, `sync_status=synced`.
- `{:rate_limited, _}` → leave `pending` (retry next cycle; never hammer).
- `{:error, _}` → `attempts + 1`, record `last_error`; after N attempts → `status=failed` (surfaced in UI).

Operations are idempotent where possible (state move is idempotent; `add_comment` uses `dedup_key` to avoid duplicates on reprocess).

### Pull (remote → local), incremental

Fetch remote issues changed since `last_incremental_cursor` (GitHub: order by `UPDATED_AT desc`, stop when `updatedAt <= last_pull`; Linear: `updatedAt` filter). For each remote issue R: find local L by `(project_id, remote_id)`. If absent → insert full mirror (fields + comments + labels + blockers). If present → field-level merge (below). Update `tracker_sync_state` (cursor, `last_pull_at`). Reconcile deletions: `remote_origin` issues/labels/relations that disappeared from the remote and have no pending local edit are archived/removed. Locally-created issues without `remote_id` are untouched by pull (they await push).

### Conflict resolution (field-level LWW)

For each syncable field of an existing issue/comment:

```
if field is in dirty_fields (pending local edit):
   if dirty_fields[field].changed_at >= R.updated_at -> keep local (replay wins)
   else (remote changed later)                       -> remote wins, set sync_status=conflict, drop the dirty_field
else:
   apply remote value (remote is truth for untouched fields)
```

`sync_status=conflict` is **informational** (UI may highlight); the data does not block — LWW already chose the value. No manual conflict queue. Temporal base: `remote_updated_at` (field) vs `dirty_fields[field].changed_at` (local clock); for fields without granular remote timestamps, the issue `updatedAt` is used as an approximation.

### PR-sync (GitHub source control, for every project with a GitHub repo)

For each project with GitHub `repositories`, for issues in active states (tunable), fetch PRs referencing the issue (`closedByPullRequestsReferences` / `linkedBranches` / by `branch_name`) and upsert into `tracker_pull_requests` (`number`, `url`, `state`, `remote_id`). "Human Review"/merge detection then reads `tracker_pull_requests` locally. This runs even when `tracker_kind` is `linear` or `local`.

### Force-sync and cadence

The orchestrator calls `Sync.Engine.request_sync(project, force: true)` right after any local write (via outbox enqueue) → the next tick processes that project immediately. With no pending writes, sync follows `poll_interval_ms`. A project syncs one at a time (no concurrency); everything goes through `RequestGateway`.

### Initial backfill

Triggered when a remote project has no `tracker_sync_state.last_full_sync_at` (first run / post-migration). A paginated full sync pulls all issues (all states) + comments + labels + blockers + PRs into the local DB, page by page via `RequestGateway` (fail-fast on rate limit; resumes next cycle). `tracker_sync_state.status=syncing` and a `bootstrapping` flag are exposed so the UI can show "syncing…" instead of appearing empty. On completion `last_full_sync_at` is set and incremental sync takes over.

## Field & Entity Mapping

Direction: ↓ pull (remote→local), ↑ push (local→remote), ↕ both, — local-only (never pushed).

### Issue (`local_tracker_issues`)

| Local field | GitHub | Linear | Dir | Conflict |
|---|---|---|---|---|
| `remote_id` | `Issue.id` | `Issue.id` | ↓ | key |
| `remote_number` | `Issue.number` | — | ↓ | n/a |
| `identifier` | `#` + number | `Issue.identifier` | ↓ | n/a |
| `title` | `Issue.title` | `Issue.title` | ↕ | LWW |
| `description` | `Issue.body` | `Issue.description` | ↕ | LWW |
| `state` (status name) | Project v2 Status single-select | `Issue.state.name` | ↕ | LWW |
| `priority` | `priority:N` label | `Issue.priority` | ↕ | LWW |
| `assignee_id` | `assignees.nodes[0].login` | `Issue.assignee.id` | ↕ | LWW |
| `branch_name` | `linkedBranches.nodes[0].ref.name` | `Issue.branchName` | ↓ | remote |
| `remote_url`/`url` | `Issue.url` | `Issue.url` | ↓ | remote |
| `remote_updated_at` | `Issue.updatedAt` | `Issue.updatedAt` | ↓ | LWW base |
| `created_at` | `Issue.createdAt` | `Issue.createdAt` | ↓ | remote |
| `creator` | `Issue.author.login` | `Issue.creator` | ↓ | remote |
| `labels` | `labels.nodes[].name` | `labels.nodes[]` | ↕ | per-label |
| `comments` | `comments.nodes[]` | `comments.nodes[]` | ↕ | per-comment |
| `blocked_by` | `trackedInIssues` + body parse | `inverseRelations` | ↓ | remote |
| `position` | board order (optional) | `Issue.sortOrder` | ↓ | remote |
| `agent_kind` | derived from labels | derived from labels | — | — |
| `agent_goal`, `worker_id`, `agent_session_id` | — | — | — | — |

Terminal states (close/reopen) on GitHub continue to use `closeIssue`/`reopenIssue` when pushing `state` to a terminal/active state (existing `Client.transition_open_state` logic).

### Comments (`local_tracker_comments`)

| Field | GitHub | Linear | Dir |
|---|---|---|---|
| `remote_id` | `IssueComment.id` | `Comment.id` | ↓ |
| `body` | `comment.body` | `comment.body` | ↕ |
| `author` | `comment.author.login` | `comment.user` | ↓ |
| `kind` | always `comment` | `comment` | — |
| `remote_updated_at` | `comment.updatedAt` | `updatedAt` | ↓ |

- Create: comment written locally immediately + outbox `comment/create` → `addComment` (GitHub) / `commentCreate` (Linear). Comment edits push if supported (GitHub `updateIssueComment`; Linear optional).
- Assistant/Codex chat replies stay local and are **not** pushed (aligns with the recent "do not spam comments" policy). Only the existing `dispatch_codex` milestone comment is synced.

### Labels (`local_tracker_labels` + join)

| Field | GitHub | Linear | Dir |
|---|---|---|---|
| `remote_id` | `Label.id` | `IssueLabel.id` | ↓ |
| `name` | `Label.name` | `name` | ↕ |
| `color` | `Label.color` | `color` | ↓ |
| issue↔label assoc | `Issue.labels` | `Issue.labels` | ↕ (add/remove via outbox) |

Internal labels (`symphony:*`, `priority:N`) remain filtered from the UI but are **persisted** locally for agent routing and correct push.

### Blockers / relations (`local_tracker_issue_relations`)

- GitHub: `trackedInIssues` + `Blockers.from_body`. Linear: `inverseRelations` (type `blocks`). Direction ↓ with `remote_origin=true`. Purely local relations are kept. `remote_origin` relations that vanish remotely (no local pending edit) are removed on pull.

### Pull Requests (`tracker_pull_requests`) — GitHub source control for ALL trackers

| Field | GitHub source | Dir |
|---|---|---|
| `remote_id`, `number`, `url`, `title` | `closedByPullRequestsReferences` / search by `branch_name` | ↓ |
| `state` (`open`/`closed`/`merged`) | PR `state` + `merged` | ↓ |
| `issue_id` link | by reference/branch | ↓ |

Pull-only (Symphony does not create PRs here). Runs for `linear`/`local` projects too if a GitHub repo is configured.

### Workflow statuses (`local_tracker_workflow_statuses`)

- GitHub: Project v2 Status field options (existing `StateReconciliation`). Linear: team `WorkflowState`. Direction ↓. WORKFLOW.md configured states remain the active/terminal reference.

### Users/assignees (`tracker_users`)

- `remote_id`, `login`, `name`, `avatar_url` ↓ from GitHub/Linear users. Used to display assignee names and resolve `assignee: me` (via `Viewer`) reading local.

### Activity events (`local_tracker_activity_events`)

- Remain local (Symphony timeline). Optionally record sync events (pulled, conflict resolved) for audit. Never pushed.

## Read/Write Path Changes

### New subsystem `SymphonyElixir.Tracker.Sync`

- **`Tracker.Sync.Engine`** (GenServer): orchestrates push→pull→pr-sync per project; exposes `request_sync(project, force: bool)`; serializes per project; routes all remote I/O via `RequestGateway`.
- **`Tracker.Sync.Driver`** (behaviour): remote primitives each source implements — `pull_issues(project, cursor)`, `push_issue(op, payload)`, `push_comment(...)`, `push_state(...)`, `push_labels(...)`, `pull_pull_requests(project, issues)`. Implementations: `GitHub.SyncDriver` (reuses `GitHub.Client`) and `Linear.SyncDriver` (reuses `Linear.Client`). PR-sync lives in `GitHub.SyncDriver` and runs for any project with a GitHub repo.
- **`Tracker.Sync.Outbox`**: enqueue/coalesce/claim/complete; idempotency via `dedup_key`.
- **`Tracker.Sync.Merge`**: per-field LWW; isolated and testable.

### UI: `Tracker.IssueAdapter` (per `Project.tracker_kind`)

- `list_issues`, `get_issue`, `list_comments`, `list_labels`, `list_statuses`, `list_assignable_users` → read `LocalTracker.Context` (mirrored issues) for all kinds.
- `create_issue`, `update_issue`, `move_issue`, `add_comment` → write Context **+** `Outbox.enqueue` **+** `Sync.Engine.request_sync(project, force: true)`.
- `GitHub.IssueAdapter` / `Linear.IssueAdapter` stop being the UI request path (become thin shims or are absorbed into the SyncDriver). Linear's `:not_supported_on_remote` is removed — all mutations are supported via the outbox.

### Orchestrator: behaviour `SymphonyElixir.Tracker`

- `fetch_candidate_issues/0`, `fetch_issues_by_states/1`, `fetch_issue_states_by_ids/1` → read from `LocalTracker.Context` regardless of WORKFLOW kind.
- `create_comment/2`, `update_issue_state/2` → write Context + outbox + force-sync.
- The poll cycle adds a step: `Sync.Engine.request_sync(project, force: pending_local_changes?)` before reading candidates.

### PRs and reconciler

- `DevServer.Reconciler` and Human-Review/merge detection read `tracker_pull_requests` locally (populated by PR-sync) instead of live `PullRequests.for_issue/2`.

### Component retirement/adjustment

- `GitHub.ReadCache`: no longer needed on the issue path (local DB is the truth). Kept only if still used pointwise; otherwise removed to reduce surface.
- `Context` gains `upsert_remote_issue/2`, `upsert_remote_comment/2`, `upsert_remote_labels/2`, `upsert_pull_requests/2` used only by the SyncEngine.
- The SyncEngine emits the same `Broadcaster` events when updating local data, so `TrackerChannel` pushes realtime updates after each pull/push.

### Compatibility

- Native `local` projects: no behavior change (no remote driver, empty outbox, sync no-op).
- Existing github/linear projects: first run backfills the local DB before the UI reads from it.

## Deletions, Multi-Project, Auth, Failures

- **Remote issue removed / out of scope:** if no pending local edit → archive locally (`archived_at` / `sync_status=archived`), never destructively delete (preserves history/sessions). With a pending local edit → keep and mark `conflict`.
- **`remote_origin` comment/label/relation that vanished:** removed on pull (when no local pending edit).
- **Local-created issue that fails to create remotely** after N attempts: `sync_status=error`, visible in UI, never disappears.
- **Multi-project:** sync is per `local_tracker_projects` row, serialized individually; multiple projects sync sequentially per heartbeat (never in parallel; respects the gateway). Identity: `(project_id, remote_id)`. Branch→issue / PR→issue mapping uses `branch_name`/references; ambiguous links log an `activity_event` warning and are not forced.
- **Auth:** tokens still come from WORKFLOW/env (GitHub token, Linear api_key). `assignee: me` resolves via `Viewer`, cached in `tracker_users`. Permission errors on push → `failed` outbox entry (no infinite retry), surfaced in UI.
- **Rate limit:** `{:rate_limited, _}` never fails an operation — only defers (push stays `pending`, pull resumes from cursor). UI unaffected (reads local).
- **Retry/backoff:** outbox entries back off by `attempts`; after the cap → `failed` + `last_error`.
- **Atomicity:** each issue upsert (fields + comments + labels + relations) runs in a transaction; the cursor only advances after a page succeeds.
- **Observability:** sync counters (pulled/pushed/conflicts/failed) and timestamps in `tracker_sync_state`, reflected in the StatusDashboard ("Last sync", "Outbox pending") and greppable logs (e.g. `Tracker sync: project=… pulled=… pushed=… conflicts=… failed=…`).
- **Reentrancy:** the SyncEngine ignores a new request for a project already syncing (coalesces `force`).
- **Migration/rollback:** additive migrations; a feature flag `tracker.sync_enabled` (default on) can revert to the old behavior (UI reads remote) without migrating data back. Mirrored data is reconstructible via a fresh full sync.

## Testing Strategy

- **Unit (no network):** `Sync.Merge` (LWW cases incl. conflict marking); `Sync.Outbox` (enqueue, coalesce by `dedup_key`, claim/complete, backoff, status transitions); `Sync.Engine` with a fake `Driver` (push→pull→pr-sync order, coalesced force-sync, rate-limit leaves `pending` and resumes, per-project serialization, cursor advances only on success); Context upserts idempotent (run twice = same state) and atomic.
- **Drivers:** `GitHub.SyncDriver` / `Linear.SyncDriver` with mocked `request_fun`/client (pattern from `github_client_test.exs`): per-field mapping (Section "Field & Entity Mapping"), pagination, `{:rate_limited, _}` translation; PR-sync link/state mapping.
- **Integration (adapters → local):** `Tracker.IssueAdapter` for github/linear reads from Context; `add_comment`/`move_issue` write local + enqueue outbox + schedule force-sync (no network). Orchestrator `fetch_candidate_issues` reads local candidates; `update_issue_state` enqueues outbox. Reconciler/Human-Review reads local `tracker_pull_requests`.
- **End-to-end (deterministic fake driver):** full backfill populates issues/comments/labels/PRs; incremental applies deltas; comment created while remote rate-limited stays `pending` then syncs; conflict (local + remote title edit) resolves by timestamp with `conflict` flag; remote deletion archives local without destroying session/PR.
- **Non-regression:** native `local` projects keep the current suite green (sync no-op); reuse existing mock infra; no network in tests; keep `mix test`, `mix credo`, `mix dialyzer`, `mix format` clean.

## Out of Scope (this SPEC)

- Webhooks / real-time push (polling on the orchestrator heartbeat only; webhooks may be a future enhancement reusing the public-preview-tunnel).
- Creating PRs from Symphony (PR-sync is pull-only).
- Milestones, reactions, and other secondary GitHub/Linear entities (can be added later following the same mapping pattern).

## Open Questions / Risks

- Per-field timestamps: GitHub/Linear expose `updatedAt` at the issue/comment granularity, not per field. The LWW base uses issue/comment `updatedAt`, which can over-attribute a remote change to all fields; acceptable given `field_lww` and the informational `conflict` flag.
- Large boards: backfill cost is bounded by `RequestGateway` (fail-fast + resume), but a very large project's first sync may take several heartbeats; the `bootstrapping` flag covers the UX.
- The two abstraction layers (orchestrator `Tracker` and UI `IssueAdapter`) both move to local reads; care is needed to keep their write paths funneling through the same outbox to avoid divergence.
