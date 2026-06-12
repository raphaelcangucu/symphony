# Per-Project Jira "My Involvement" Board Filter — Design

- **Date:** 2026-06-11
- **Status:** Draft (pending spec review)
- **Author:** Symphony agent + raphaelcangucu
- **Related:** `docs/superpowers/plans/2026-06-01-jira-tracker-adapter.md`, `elixir/WORKFLOW.jira.example.md`

## Problem

Symphony already has a full Jira Cloud tracker adapter and auto-syncs Jira
issues into a project's local board (cold-start seed + recurring background
pull). But the per-project board sync pulls **every** issue in the configured
project, newest first, capped at one page of 100:

```18:35:elixir/lib/symphony_elixir/jira/issue_adapter.ex
  def list_issues(%Project{} = project, _filters) do
    body = %{
      "jql" => ~s|project = "#{project_key(project)}" ORDER BY created DESC|,
      "fields" => Query.issue_fields(),
      "maxResults" => 100
    }
```

There are two distinct Jira read paths, and only one of them supports an
assignee filter today:

1. **Orchestrator poll** (`Jira.Client.fetch_candidate_issues/0`) builds JQL with
   an optional `assignee = …` clause from the global `jira.assignee` config. This
   path filters, but it is the single-tenant global poll, not the per-project
   board.
2. **Per-project board sync** (`Jira.IssueAdapter.list_issues/2`, used by both
   `Tracker.Sync.Engine` cold-start seeding and `Jira.SyncDriver.pull/2`) has the
   hard-coded JQL above. It ignores the `filters` argument and reads only
   `project_key` (and `issue_type`) from `tracker_config`.

Concrete case: a user wants an `advising` project backed by Jira project **CDE**,
but only wants to see the issues they are involved in — including ones they
**handed off** (e.g. moved CDE-1075 to QA but still want to track it). Today,
pointing a Symphony project at CDE would mirror the whole CDE board.

The fix is to make path (2) build its JQL from a small, declarative per-project
filter expressing "issues I'm involved in."

## Goals

- Add a per-project, declarative Jira board filter to `tracker_config` that
  scopes the synced board to the user's involvement, OR'ing across roles:
  `assignee` (now), `assignee WAS` (handed off), `reporter`, `watcher`.
- Resolve "me" to JQL `currentUser()` so the filter follows whoever Symphony's
  Jira credentials authenticate as (no extra `/myself` round-trip, no watcher
  permission issues).
- Provide a raw `jql:` escape hatch for advanced per-project filters.
- Replace the single-page fetch with bounded pagination so an "include
  everything" filter cannot silently truncate at 100 issues.
- Stand up the `advising` project: Jira `CDE` tracker (with the filter) + GitHub
  repo `civitaslearning/advising` @ `pre-release` for source control / PRs.
- Keep watched/reported (non-assigned) issues **view-only** — they must not be
  auto-dispatched to a coding agent.

## Non-Goals

- A UI-side "view filter" toggle in the React tracker app. Scoping happens
  server-side at sync time; the board *is* the working/tracking set.
- Changing the orchestrator poll path or the global `jira.assignee` semantics.
- Reworking the local-first sync engine, normalization, or status mapping.
- Per-project distinct Jira credentials (Symphony stays single-tenant for Jira).
- Jira Server/Data Center (Cloud API v3 only, unchanged).

## Approach (chosen)

**Approach A — structured involvement filter + raw-JQL escape hatch.** A small
declarative block in `tracker_config` covers the common case; a raw `jql:` field
covers everything else. This fits Symphony's portable project-YAML model and
expresses the requested four-role union directly.

Alternatives considered and rejected:

- **B — raw JQL only.** Simplest to build but forces hand-written JQL and loses
  built-in `me` resolution + role defaults.
- **C — named presets** (`mine`, `mine_and_handed_off`, `all`). Simple UX but
  cannot cleanly express the exact four-role combination, and adds a closed
  vocabulary we would keep extending.

## Design

### 1. Config schema (`tracker_config`)

Existing keys (`project_key` required, `issue_type` optional, default `Task`)
are unchanged. New optional keys consumed by `Jira.IssueAdapter`:

```yaml
tracker:
  kind: jira
  config:
    project_key: CDE
    identity: me                  # "me" -> currentUser(); or a literal accountId string
    involvement:                  # roles OR'd together; omit/empty -> no filter (all issues)
      - assignee                  # assignee = ID
      - was_assignee              # assignee WAS ID  (handed-off issues)
      - reporter                  # reporter = ID
      - watcher                   # watcher = ID
    # jql: "<raw fragment>"       # optional escape hatch; replaces the involvement clause
    # order_by: "created DESC"    # optional; default "created DESC"
    # max_results: 500            # optional cap; default 500
```

**Backward compatibility:** when `involvement` is absent/empty **and** no raw
`jql` is set, the generated JQL is exactly `project = "KEY" ORDER BY created DESC`
— identical to today's behavior. Existing Jira projects are unaffected.

### 2. JQL builder

A pure, unit-testable builder (a new private module
`SymphonyElixir.Jira.IssueAdapter.Filter`, or a function group in `Query`)
produces the search JQL from a `Project`:

```
jql(project) =
  join(" AND ", reject_nil([
    "project = " <> quote(project_key),
    involvement_or_raw_clause(project)
  ])) <> " ORDER BY " <> order_by(project)
```

- **identity → ID token:** `"me"` (or absent) → `currentUser()`; a literal
  string → JQL-quoted accountId (`"…"`, embedded quotes escaped).
- **role → clause:**
  - `assignee` → `assignee = ID`
  - `was_assignee` → `assignee WAS ID`
  - `reporter` → `reporter = ID`
  - `watcher` → `watcher = ID`
- **involvement clause:** non-empty roles → `"(" <> join(" OR ", clauses) <> ")"`.
  Unknown role values are ignored.
- **raw `jql` override:** when a non-empty `jql` string is configured, it
  replaces the involvement clause (still wrapped in parentheses and ANDed with
  `project = KEY`). `involvement`/`identity` are then ignored.
- **order_by:** default `created DESC`; configurable via `order_by`.

For the advising project (`identity: me`, all four roles) this yields:

```
project = "CDE" AND (assignee = currentUser() OR assignee WAS currentUser() OR reporter = currentUser() OR watcher = currentUser()) ORDER BY created DESC
```

### 3. Pagination + cap

Replace the single `maxResults: 100` request with a `nextPageToken` loop against
`POST /rest/api/3/search/jql` (the same paging contract `Jira.Client` already
uses for the orchestrator poll):

- Page size 100; request body carries `jql`, `fields` (`Query.issue_fields/0`),
  `maxResults`, and `nextPageToken` on subsequent pages.
- Accumulate `issues` in order until `isLast == true`/`nextPageToken == nil`, or
  until the accumulated count reaches `max_results` (default 500). When the cap
  truncates results, log a single structured warning with project slug + cap.
- Each page's `issues` are normalized via `Query.normalize_issue/2` (unchanged).
- On any page error, return the mapped `{:error, …}` (existing `map_error/1`).

### 4. Wiring + validation

- `LocalTracker.Project.changeset/2`: add `"jira" -> validate_config_keys(…, ["project_key"])`
  so a Jira project without a `project_key` fails fast (today only `github` and
  `linear` configs are validated).
- No new registration points: `Jira.IssueAdapter`, `Jira.SyncDriver`, and the
  sync engine routing already exist; this change is internal to `list_issues/2`.
- The `filters` argument to `list_issues/2` stays out of scope: the sync engine
  passes `[]`, and synced projects read the board from the local DB, not live
  Jira. (Noted explicitly so future UI-driven filtering has a clear seam.)

### 5. Safety: view-only tracking

Issues surfaced only because of `was_assignee` / `reporter` / `watcher` (i.e. not
currently assigned to the user) must not be auto-worked:

- Agent dispatch is driven by `symphony:*` routing labels and the user moving a
  card into Todo/active states. Mirrored Jira issues do not carry `symphony:*`
  labels unless explicitly added, and remain in their Jira status until the user
  acts. So a "watching CDE-1075 in QA" card is display/tracking only.
- This is an existing property of the dispatch path; the design adds no new
  dispatch surface. The spec records it as an explicit invariant to preserve.

### 6. The `advising` project bundle

A portable project YAML (imported via the existing project import flow /
`SymphonyElixir.LocalTracker.Projects.import_yaml/1`) describing:

- `tracker.kind: jira`, `tracker.config: { project_key: CDE, identity: me,
  involvement: [assignee, was_assignee, reporter, watcher] }`.
- `repositories`: `civitaslearning/advising`, `default_branch: pre-release`,
  `selected_branch: pre-release`, `role: primary`.
- `workflow_statuses` mapped from CDE's Jira statuses (status category →
  Symphony category via the existing `Query.category_for/1` mapping), and
  `setup.workflow_markdown` instructing PRs against `civitaslearning/advising`
  base `pre-release` with the `Symphony-Issue: {{ issue.identifier }}` marker
  (Jira key), so the GitHub PR driver associates PRs to the Jira-tracked issue.

PR association for a Jira-tracked project works because
`Tracker.Sync.Engine.finish_with_pull/4` pulls PRs via the GitHub
`pr_driver` regardless of tracker kind, keyed by the issue marker.

## Edge cases & error handling

- **Empty/whitespace `involvement` entries** and unknown role strings → dropped.
- **`jql` present but empty/whitespace** → treated as absent (falls back to
  involvement or no filter).
- **`identity` literal with embedded quotes** → escaped via the existing
  `quote_jql` style helper.
- **Cap reached** → return the first `max_results` issues, log a truncation
  warning; never error solely due to volume.
- **Existing error mapping** (`401/403/404/429/5xx/400`) is preserved unchanged.

## Testing plan

Unit tests (no HTTP; stub `:jira_client_module` / inject `request_fun`):

- JQL builder: each single role; all four roles OR'd; `me` → `currentUser()`;
  literal accountId → quoted; raw `jql` override; empty involvement → no filter
  clause (back-compat); custom `order_by`.
- `list_issues/2` pagination: two-page `/search/jql` response concatenated in
  order; cap truncation stops paging and warns.
- `Project.changeset/2`: `jira` config missing `project_key` → invalid; present
  → valid.
- Regression: existing `issue_adapter_test` and `sync_driver_test` still pass
  with default (no-involvement) config.

Full gate before handoff: `cd elixir && make all` and `cd elixir && mix specs.check`.

## Out of scope (called out, not silently skipped)

- React tracker UI filter controls.
- Multi-tenant / per-project Jira credentials.
- Translating arbitrary Jira saved filters or board configs.
- Changing the orchestrator poll path or global `jira.assignee`.
