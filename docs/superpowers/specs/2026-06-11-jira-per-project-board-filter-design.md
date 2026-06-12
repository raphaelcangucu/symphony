# Per-Project Jira Board Filter (field / JQL) — Design

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

There are two distinct Jira read paths:

1. **Per-project board sync** (`Jira.IssueAdapter.list_issues/2`, used by both
   `Tracker.Sync.Engine` cold-start seeding and `Jira.SyncDriver.pull/2`) — the
   hard-coded JQL above. It ignores the `filters` argument and reads only
   `project_key` (and `issue_type`) from `tracker_config`. **This decides what's
   on the board (visibility).**
2. **Orchestrator dispatch** (`Tracker.Sync.LocalFirstTracker.fetch_candidate_issues/0`)
   — selects which mirrored issues to actually run an agent on. **This decides
   what gets executed.**

Concrete case: a user wants an `advising` project backed by Jira project **CDE**,
scoped to the **`Product = Inspire`** field (the advising product). That board
should show *all* Inspire work — including colleagues' issues — for visibility,
while only the user's own assigned issues are ever auto-executed.

Today, pointing a Symphony project at CDE mirrors the whole CDE board with no
field scoping. The fix is to make path (1) build its JQL from a small,
declarative per-project field/JQL filter.

## Visibility vs. execution (why this is safe)

Path (1) and path (2) are independent layers, so widening the board does **not**
widen what gets executed. The orchestrator gate is enforced by two operator
settings that **both default to `true`**:

```9:15:elixir/lib/symphony_elixir/settings/orchestration.ex
  - `require_assignee_match`: only auto-dispatch issues assigned to the
    connected provider identity (GitHub viewer login / Jira accountId / Linear
    user id). When off, assignee is ignored during candidate selection.

  Both default to `true` so a fresh instance is conservative: the orchestrator
  never picks up unlabeled or unassigned work without an explicit opt-out.
```

`LocalFirstTracker` applies the assignee gate per project, matching the
connected Jira `accountId` (resolved via `/myself`, or the global `jira.assignee`
literal) against each mirrored issue's `assignee_remote_id`:

```197:228:elixir/lib/symphony_elixir/tracker/sync/local_first_tracker.ex
  defp query_issues(project, states, filter) do
    project
    |> base_query()
    |> join(:inner, [issue], status in assoc(issue, :status))
    |> where([_issue, status], status.name in ^states)
    |> apply_assignee_filter(filter)
    |> Repo.all()
    |> IssueMapper.to_issues()
  end
```

So a `Product = Inspire` board can include colleagues' issues for tracking, and
they remain **view-only**: an agent only auto-starts an issue that is (a) assigned
to the user's accountId and (b) labeled `symphony:*`. This design adds no new
dispatch surface; it records the invariant and requires the two gates stay on.

## Goals

- Add a per-project, declarative Jira board filter to `tracker_config`:
  - a friendly `fields` map (e.g. `Product: Inspire`) compiled to AND-joined
    `"<field>" = "<value>"` equality clauses, and
  - a raw `jql` escape hatch (ANDed with the rest) for anything more complex.
- Always scope to the configured `project_key`; default ordering `created DESC`.
- Replace the single-page fetch with bounded pagination so a broad filter cannot
  silently truncate at 100 issues.
- Stand up the `advising` project: Jira `CDE` tracker scoped to `Product =
  Inspire` + GitHub repo `civitaslearning/advising` @ `pre-release` for PRs.
- Preserve the visibility/execution split: colleagues' Inspire issues are
  view-only; only the user's assigned, labeled issues are auto-dispatched.

## Non-Goals

- A UI-side "view filter" toggle in the React tracker app. Scoping happens
  server-side at sync time; the board *is* the working/tracking set.
- An assignee/involvement (`me` / `was_assignee` / `reporter` / `watcher`) board
  filter. The field/JQL filter replaces it (dropped per review).
- Changing the orchestrator dispatch path, the assignee-gate semantics, or the
  global `jira.assignee` config.
- Reworking the local-first sync engine, normalization, or status mapping.
- Per-project distinct Jira credentials (Symphony stays single-tenant for Jira).
- Jira Server/Data Center (Cloud API v3 only, unchanged).

## Approach (chosen)

**Structured `fields` map + raw `jql` escape hatch.** The common "field equals
value" case (Product = Inspire) is declarative and needs no JQL knowledge; the
`jql` field handles custom-field-id references, OR-groups, date ranges, etc. Both
are ANDed with `project = KEY`. This fits Symphony's portable project-YAML model.

Alternatives considered and rejected:

- **Raw JQL only.** Maximum flexibility but forces hand-written JQL and quoting
  for the common case.
- **Structured fields only.** Friendly but can't express custom-field-id
  references or boolean groups when a field name isn't directly JQL-queryable.
- **Named presets / assignee-involvement filter.** Dropped: the field filter is
  the requested mechanism and is strictly more general for this use.

## Design

### 1. Config schema (`tracker_config`)

Existing keys (`project_key` required, `issue_type` optional, default `Task`)
are unchanged. New optional keys consumed by `Jira.IssueAdapter`:

```yaml
tracker:
  kind: jira
  config:
    project_key: CDE
    fields:                       # field = value equality clauses, AND-joined
      Product: Inspire
    # jql: '<raw fragment>'       # optional; ANDed with project + fields
    # order_by: "created DESC"    # optional; default "created DESC"
    # max_results: 500            # optional cap; default 500
```

**Backward compatibility:** when `fields` is absent/empty **and** no raw `jql` is
set, the generated JQL is exactly `project = "KEY" ORDER BY created DESC` —
identical to today's behavior. Existing Jira projects are unaffected.

### 2. JQL builder

A pure, unit-testable builder (a new private module
`SymphonyElixir.Jira.IssueAdapter.Filter`, or a function group in `Query`)
produces the search JQL from a `Project`:

```
jql(project) =
  join(" AND ", reject_nil([
    "project = " <> quote(project_key),
    field_clauses(project),     # each: "<name>" = "<value>", AND-joined
    raw_jql_clause(project)     # "(" <> jql <> ")" when present
  ])) <> " ORDER BY " <> order_by(project)
```

- **`fields` map → clauses:** for each `{name => value}`, emit
  `quote(name) <> " = " <> quote(value)`. Names and values are JQL-quoted with
  embedded quotes escaped (reuse the existing `quote_jql` style helper). Multiple
  entries are AND-joined. Non-string/empty keys or values are dropped.
- **`jql` escape hatch:** when a non-empty `jql` string is configured, wrap it in
  parentheses and AND it with the rest. `fields` and `jql` may be combined.
- **`order_by`:** default `created DESC`; configurable via `order_by`.

For the advising project (`fields: { Product: Inspire }`) this yields:

```
project = "CDE" AND "Product" = "Inspire" ORDER BY created DESC
```

**Custom-field reference note:** `Product` is a Jira **custom field**. Referencing
it by name (`"Product" = …`) works when the field name is unique in the
instance; otherwise the field's id is required (`cf[NNNNN] = "Inspire"`), which is
expressed via the `jql` escape hatch. The correct reference for CDE's `Product`
field is resolved/verified against live Jira (`GET /rest/api/3/field`) when the
`advising` project is wired up; the config shape supports either form.

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

### 5. The `advising` project bundle

A portable project YAML (imported via the existing project import flow /
`SymphonyElixir.LocalTracker.Projects.import_yaml/1`) describing:

- `tracker.kind: jira`, `tracker.config: { project_key: CDE, fields: { Product:
  Inspire } }` (or `jql: 'cf[NNNNN] = "Inspire"'` if the name isn't directly
  queryable).
- `repositories`: `civitaslearning/advising`, `default_branch: pre-release`,
  `selected_branch: pre-release`, `role: primary`.
- `workflow_statuses` mapped from CDE's Jira statuses (status category →
  Symphony category via the existing `Query.category_for/1` mapping), and
  `setup.workflow_markdown` instructing PRs against `civitaslearning/advising`
  base `pre-release` with the `Symphony-Issue: {{ issue.identifier }}` marker
  (Jira key), so the GitHub PR driver associates PRs to the Jira-tracked issue.
- The instance keeps `require_assignee_match` + `require_symphony_label` on
  (defaults), and optionally sets the global `jira.assignee: me` for an explicit
  dispatch gate. (`provider_assignee_config("jira")` reads the global `jira:`
  section, not per-project `tracker_config`, so the dispatch gate is instance-wide.)

PR association for a Jira-tracked project works because
`Tracker.Sync.Engine.finish_with_pull/4` pulls PRs via the GitHub `pr_driver`
regardless of tracker kind, keyed by the issue marker.

## Edge cases & error handling

- **Empty/whitespace `fields` keys or values** → dropped; an all-empty map
  contributes no clause.
- **`jql` present but empty/whitespace** → treated as absent.
- **Field names/values with embedded quotes** → escaped via the `quote_jql` helper.
- **Cap reached** → return the first `max_results` issues, log a truncation
  warning; never error solely due to volume.
- **Existing error mapping** (`401/403/404/429/5xx/400`) is preserved unchanged.

## Testing plan

Unit tests (no HTTP; stub `:jira_client_module` / inject `request_fun`):

- JQL builder: single field; multiple fields AND-joined; `fields` + `jql`
  combined; `jql` only; neither → bare `project = "KEY" ORDER BY created DESC`
  (back-compat); quote/escape of names and values; custom `order_by`.
- `list_issues/2` pagination: two-page `/search/jql` response concatenated in
  order; cap truncation stops paging and warns.
- `Project.changeset/2`: `jira` config missing `project_key` → invalid; present
  → valid.
- Regression: existing `issue_adapter_test` and `sync_driver_test` still pass
  with default (no-filter) config.

Full gate before handoff: `cd elixir && make all` and `cd elixir && mix specs.check`.

## Out of scope (called out, not silently skipped)

- React tracker UI filter controls.
- Multi-tenant / per-project Jira credentials.
- Translating arbitrary Jira saved filters or board configurations.
- Changing the orchestrator dispatch path or global `jira.assignee` semantics.
- Assignee/involvement board filtering (dropped in favor of the field/JQL filter).
