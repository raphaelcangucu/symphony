# Issue Detail Sidebar: Editable Labels/Assignee + Clone/Delete — Design

Date: 2026-06-03
Status: Proposed (awaiting spec review)
Topic: Make the issue detail sidebar editable (labels, assignee) and add task
actions (clone, delete), following the local-first → remote-sync pattern.

## Problem

The issue detail view (`tracker/src/components/issues/IssueDrawer.tsx` →
`SummaryTab.tsx`) already renders a right-hand sidebar (`<aside>`) showing
Status, Priority, Assignee, Updated and Labels. Today everything in that sidebar
is **read-only**. Users want to:

- Edit **Labels** from the sidebar.
- Set/change the **Assignee** from the sidebar.
- Run task **actions** from the sidebar: **Clone** (duplicate) and **Delete**.

`Delete` already exists end-to-end (UI dropdown → `DELETE` route → local +
GitHub remote push). `Clone` and editing labels/assignee after creation do
**not** exist:

- No HTTP path changes labels after creation (`update` ignores labels).
- `assignee_id` is locally mutable, but no sync driver pushes `issue/update`, so
  the change never reaches the remote.
- No clone/duplicate endpoint exists for issues.
- For GitHub-backed projects with sync enabled, `form_options` is served by the
  **local** adapter, which returns `[]` assignable users and only labels already
  present locally — so the editors would have empty/partial option lists.

## Goals

- Edit labels and assignee inline in the existing sidebar, local-first.
- Changes sync to the GitHub remote (Projects v2 / underlying repo issue).
- Clone a task: copy title + description + priority + labels + assignee; status
  resets to the board's initial status; new identifier; syncs as a remote create.
- Surface Clone + Delete as explicit actions in the sidebar.
- Populate the editors with the **remote** label/assignee catalog for
  remote-backed projects.

## Non-goals

- **Transfer task** (dropped from scope).
- Remote push of label/assignee updates for **Linear/Jira** — those keep current
  behavior (`unsupported_push`); local edits still persist. No regression.
- Changing Status/Priority from the sidebar (out of scope; Status already moves
  via the board / move endpoint).

## Architecture & data flow

The write path reuses the existing local-first chain:

```
SummaryTab editor → services/issues.ts (PATCH update / POST clone)
  → IssueController → IssueAdapter.dispatch → LocalFirstAdapter
    → LocalTracker.IssueAdapter + Context (SQLite write, source of truth)
    → mark_dirty + Outbox enqueue (issue/update or issue/create)
  → Tracker.Sync.Engine push → GitHub.SyncDriver → GitHub.IssueAdapter (GraphQL)
```

### 1. Editable Labels + Assignee (backend)

- `LocalTracker.Context.update_issue/3`: accept `label_ids` (full replace of the
  issue's label set via `local_tracker_issue_labels`) in addition to the already
  mutable `assignee_id`. Implement a `set_issue_labels/3` helper (reuse
  `ensure_label`/`ensure_issue_label_idempotent` patterns) that diffs and applies
  the desired label set. Label ids may be names (local) or remote ids; resolve to
  local label rows by name/remote_id.
- `LocalFirstAdapter.to_dirty_field/1`: add `:labels` so label edits are marked
  dirty for LWW; `assignee_id` is already handled. The existing
  `update_issue/3` already enqueues an `issue/update` outbox entry.
- `GitHub.SyncDriver.push/2`: add a clause for
  `%OutboxEntry{entity_type: "issue", operation: "update"}` that calls a new
  `GitHub.IssueAdapter` update path.
- `GitHub.IssueAdapter`: replace the `update_issue/3` stub
  (`{:error, :not_supported_on_remote}`) with a real implementation that, given
  the payload's `assignee_id` and/or `label_ids`:
  - Resolves the underlying GitHub **issue content node id** for the identifier
    (the project item id is not the issue node id — a new query/helper is needed,
    reusing repo-metadata + identifier resolution patterns already in the
    adapter).
  - Applies labels via `addLabelsToLabelable` / `removeLabelsFromLabelable` (or
    `updateIssue { labelIds }`), resolving label ids from repo metadata like
    `create_issue` already does with `resolve_label_ids`.
  - Applies assignee via `addAssigneesToAssignable` / `removeAssigneesFromAssignable`
    (or `updateIssue { assigneeIds }`), resolving the user node id from
    `list_assignable_users`.
  - Only mutates the fields present in the payload (partial update).

### 2. form_options for remote-backed projects

`IssueController.form_options/2` (or `LocalFirstAdapter.list_labels/1` +
`list_assignable_users/1`) must return the **remote** catalog when the project is
remote-backed. Approach: have `form_options` resolve labels/assignees through the
remote adapter (`IssueAdapter.remote_for(kind)`) when present, falling back to the
local adapter on error/empty so pure-local projects keep working. Statuses stay
local. This keeps reads fast elsewhere (only `form_options` hits the remote).

### 3. Clone / Duplicate task (backend)

- New route: `POST /api/tracker/v1/projects/:project_slug/issues/:identifier/clone`
  → `IssueController.clone/2` → `IssueAdapter.dispatch(project, :clone_issue, [identifier])`.
- `LocalTracker.Context.clone_issue/2`: load the source issue + its labels +
  assignee + priority + title + description; create a new issue (reuse
  `create_issue` internals) with status = board initial (`@default_issue_status`),
  new identifier, copied labels/assignee/priority, optionally title prefixed with
  a marker (decision below). Returns the new `IssueRecord`.
- `LocalFirstAdapter.clone_issue/2`: persist locally then enqueue an
  `issue/create` outbox entry (GitHub push already supports `issue/create`) so the
  clone is created on the remote too.
- Title convention for clones: copy the title **verbatim** (no "Copy of" prefix)
  — chosen for cleanliness; revisit if duplicates become confusing.

### 4. Frontend

- `services/issues.ts`: add
  - `updateIssue(projectSlug, identifier, { labelIds?, assigneeId? })` → PATCH
    `/issues/:identifier` (serialize `label_ids`, `assignee_id`; `null` clears
    assignee).
  - `cloneIssue(projectSlug, identifier)` → POST `/issues/:identifier/clone`,
    returns the new `Issue`.
- `SummaryTab.tsx` sidebar:
  - **Labels** field → trigger opens a popover with checkboxes built from
    `form_options.labels`; apply on close/confirm; optimistic local update then
    `updateIssue`.
  - **Assignee** field → combobox from `form_options.assignees` plus an
    "Unassigned" option; optimistic update then `updateIssue`.
  - New **Actions** section at the bottom: **Clone task** (calls `cloneIssue`,
    then navigates to / opens the new issue) and **Delete task** (reuses existing
    delete handler wired through `IssueDrawer`/`IssueDetailRoute`).
  - Load options via a small hook reusing `getIssueFormOptions` (lazily, when an
    editor opens) to avoid extra fetches on every drawer open.
- Board list (`useWorkspace` issues) is refreshed/patched so edits and the new
  cloned issue appear without a manual reload (reuse existing `setIssues` flow as
  `IssueDetailRoute` already does for delete).

## Error handling

- Backend mutations return existing `tracker_error` atoms; controller renders via
  `TrackerErrors`. Remote push failures are retried by the sync engine/outbox as
  today; local state remains the source of truth.
- Frontend: optimistic update with rollback + `toast.error` on failure (matching
  the existing delete/archive pattern in `IssueDetailRoute`).
- `clone_issue` of a missing identifier → `:issue_not_found`.

## Testing

Backend (ExUnit, fake remote adapter pattern from `issue_controller_test.exs`):

- `Context.update_issue` applies/removes labels and sets/clears `assignee_id`.
- `Context.clone_issue` copies fields + labels + assignee, resets status, mints a
  new identifier.
- `LocalFirstAdapter` marks `:labels` dirty and enqueues `issue/update`; clone
  enqueues `issue/create`.
- `GitHub.SyncDriver.push` handles `issue/update`; `GitHub.IssueAdapter.update_issue`
  issues the expected GraphQL mutations (via fake client).
- `form_options` returns remote labels/assignees for a remote-backed project.

Frontend (Vitest/RTL, following existing `__tests__` patterns):

- SummaryTab: edit labels, change assignee, clear assignee, clone, delete —
  asserting service calls + optimistic UI.

## Open decisions captured

- Linear/Jira label/assignee update push: intentionally left `unsupported_push`.
- Clone title: verbatim copy (no prefix).
- Clone status: board initial status (`@default_issue_status`).
