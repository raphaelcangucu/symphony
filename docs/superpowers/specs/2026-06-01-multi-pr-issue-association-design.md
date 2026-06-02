# Multi-PR Issue Association (front + back, cross-repo) — Design

- **Date:** 2026-06-01
- **Status:** Approved (pending spec review)
- **Author:** Symphony agent + raphaelcangucu
- **Related:** `docs/superpowers/specs/2026-06-01-local-first-tracker-sync-design.md`, `docs/superpowers/specs/2026-06-01-github-api-rest-fallback-design.md`

## Problem

A tracker issue can be implemented by more than one Pull Request living in
different repositories (e.g. a front-end PR in `clouapp/front` and a back-end PR
in `clouapp/back`). Today Symphony does **not** surface these correctly:

1. The `/pull_requests` endpoint resolves PRs **live** from GitHub using a
   **priority chain** (`closedByPullRequestsReferences` → linked branch →
   same-repo cross-references) that **short-circuits** instead of unioning, so a
   second PR on a different branch/strategy is dropped.
2. Cross-repository PRs are **explicitly filtered out**
   (`isCrossRepository: false`) and PR discovery only queries the single
   `tracker_config["repo"]`. A PR in `clouapp/back` can never link to an issue
   registered in `clouapp/front`.
3. There is **no persistence** of discovered associations and **no manual
   link** path. When the GitHub App lacks access to the other repo (observed:
   **404 on `clouapp/back/pull/277`**), there is no way to show the PR at all.

Concrete failing case: issue **#510** (`clouapp/front`) is implemented by PR
**`clouapp/back#277`**, but `/issues/510/pull_requests` shows nothing.

## Goals

- An issue can show **one or more** associated PRs, including PRs in a
  **different repository** than the issue.
- Associations are **persisted** in the database so they survive across requests
  and remain visible even when live discovery returns nothing (e.g. 404 / no App
  access to the other repo).
- Support **both** automatic discovery (when the App has access) **and** a
  **manual link** path (paste a PR URL) as a reliable fallback/override.
- Fix issue **#510** to show `clouapp/back#277`.

## Non-Goals

- Configuring multiple tracker repos per project for issue polling (out of
  scope; only PR association is cross-repo here).
- Pushing PR associations back to the remote tracker (pull-only, local).
- Reworking the background sync engine's source-of-truth model (the design spec
  for local-first sync remains the long-term direction; here we only wire the
  read endpoint to merge live + persisted).

## Approach (chosen)

**Both** automatic cross-repo discovery **and** manual link, persisted in the
existing `tracker_pull_requests` table, with the `/pull_requests` endpoint
**merging live discovery with persisted rows** (dedupe by URL) on each request.

### Considered alternatives

- **Manual-only:** robust against 404 but misses PRs the App *can* see
  automatically. Rejected — we want automatic when possible.
- **Local-first (table is sole source of truth):** larger change to the read
  path and background sync; deferred to the local-first sync spec. Rejected for
  now in favor of the lower-risk merge approach.
- **Multi-repo project config:** heavier; changes issue polling semantics.
  Out of scope.

## Data Model

Extend table `tracker_pull_requests` (migration + `PullRequestRecord` schema).
The table already allows many rows per `issue_id` (FK + `unique_index
[issue_id, remote_id]`).

New columns:

| Column   | Type     | Notes |
|----------|----------|-------|
| `repo`   | `string` | `owner/name`, e.g. `clouapp/back`. Nullable. Backfilled from `url` for existing rows. |
| `origin` | `string` | `"auto"` (default) or `"manual"`. Records how the link was created. |

Behavior changes:

- **Dedupe key is the PR `url`** (a bare `number` collides across repos).
- For **manual** links without a GitHub GraphQL node id (e.g. 404), set
  `remote_id = url` so the existing `unique_index [issue_id, remote_id]` still
  holds.
- `state` validation gains **`"unknown"`** for manual PRs that could not be
  enriched (no App access). Allowed states become `open | closed | merged |
  unknown`.

`IssueRecord` gains `has_many(:pull_requests, PullRequestRecord, foreign_key:
:issue_id)` for ergonomic loading (optional but used by the controller).

## Components & Data Flow

### A. Automatic discovery — `GitHub.PullRequests`

File: `elixir/lib/symphony_elixir/github/pull_requests.ex`

- Replace the priority short-circuit (`resolve_from_issue/4`,
  `resolve_without_closing_refs/4`) with a **union** of all three strategies:
  closing refs + branch PRs + cross-referenced PRs. Dedupe by URL, then sort.
- **Stop filtering** `isCrossRepository`: include cross-referenced PR sources
  regardless of repo. Add `repository { nameWithOwner }` to `@pr_fields` and
  surface it as `repo` on each returned PR map. When `source` is `null` (no
  access), skip the node gracefully (no crash).
- Each returned PR map gains a `"repo"` key (owner/name) derived from
  `repository.nameWithOwner` (fallback: parse from PR `url`).

### B. Persisted store helpers

File: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` (+
`pull_requests.ex` reader)

- `upsert_pull_requests/2` extended to persist `repo` and `origin` (default
  `"auto"` for discovered PRs). Upsert keyed by `(issue_id, remote_id)`.
- A `link_manual/2` (or controller-level insert) for manual links with
  `origin: "manual"`, `remote_id = url`.
- An `unlink/2` to delete a manual association by URL.
- A reader `list_for_issue/1` returning all persisted PR rows for an issue.

### C. Read endpoint — `PullRequestController.index`

File: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_controller.ex`

On `GET .../issues/:identifier/pull_requests`:

1. Live discover via `PullRequests.for_issue(repo, identifier)` (now unioned +
   cross-repo). On error, log and continue with `[]`.
2. **Persist** discovered PRs (`origin: "auto"`) via the store helper.
3. Load **all** persisted rows for the issue (auto + manual).
4. **Merge** live + persisted, dedupe by `url`:
   - Live entry wins for fields that benefit from freshness (CI status, state,
     title).
   - Persisted-only entries (e.g. manual `clouapp/back#277` not visible live)
     are kept.
5. Return `data` with each PR carrying `repo` and `origin`.

### D. Manual link/unlink endpoints

File: `router.ex` + new controller actions (or `PullRequestController`).

- `POST .../issues/:identifier/pull_requests/link` body `{ "url": "..." }`:
  - Parse `owner/repo` + `number` from the URL (validate it's a GitHub PR URL;
    fail fast with a clear error otherwise).
  - Best-effort enrich title/state from GitHub. On 404/no access, store
    `state: "unknown"`, `title: "#<number>"`.
  - Insert with `origin: "manual"`. Return the created PR.
- `DELETE .../issues/:identifier/pull_requests/link` body `{ "url": "..." }`:
  - Delete the matching `origin: "manual"` row for the issue.

### E. Frontend — Pull Requests tab

Files: `tracker/src/services/pullRequests.ts`,
`tracker/src/hooks/useIssuePullRequests.ts`,
`tracker/src/components/issues/issue-detail/PullRequestTab.tsx`

- Service: add `linkPullRequest(url)` and `unlinkPullRequest(url)`.
- Tab UI:
  - A "Vincular PR" input + button (paste URL → link → refresh list).
  - Each PR row shows a **repo badge** (`clouapp/front` / `clouapp/back`).
  - Manual PRs show a remove ("x") control calling unlink.
- Types updated to include `repo` and `origin`.

### F. Presenter / JSON shape

File: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` (PR
serialization) — include `repo` and `origin` keys.

## Fixing Issue #510

After implementation, link `clouapp/back#277 → #510` via the manual path:

- Preferred: a small `mix` task or one-off CLI invocation hitting the manual
  link logic; or a direct DB insert in dev if the App lacks `clouapp/back`
  access. The row: `issue_id = <510>`, `repo = "clouapp/back"`, `number = 277`,
  `url = "https://github.com/clouapp/back/pull/277"`, `origin = "manual"`,
  `state = "unknown"` (or enriched if access exists), `remote_id = url`.

## Error Handling

- Live discovery failure → log warning, fall back to persisted-only list.
- Invalid manual URL → `422`/clear error; do not insert.
- Manual link enrich 404/no access → store with `state: "unknown"`; surface in
  UI without CI status.
- Duplicate manual link (same URL) → idempotent (upsert / no-op), not an error.

## Testing

Elixir:
- `pull_requests_test.exs`: union of strategies returns multiple PRs across
  branches; cross-repo PRs are **now included** (update/replace the existing
  "ignore cross-repo" expectation); dedupe by URL.
- PR URL parser: valid/invalid GitHub PR URLs.
- Manual link: enrich success vs 404 (`state: "unknown"`).
- Controller merge: live + persisted dedupe by URL; persisted-only manual PR
  remains visible when live returns `[]`.
- Store: upsert persists `repo`/`origin`; unlink removes manual row.
- Migration: backfill `repo` from `url`; default `origin = "auto"`.

Frontend:
- `PullRequestTab` renders multiple PRs with repo badges; link/unlink flows.

Gates: `make all` (format, lint, coverage, dialyzer), `mix specs.check`.

## Open Questions

- None blocking. Repo badge styling follows existing tab conventions.
