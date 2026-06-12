# Declarative PR↔Issue Association (source-control contract + marker + workpad) — Design

- **Date:** 2026-06-11
- **Status:** Draft (pending spec review)
- **Author:** Symphony agent + raphaelcangucu
- **Related:** `docs/superpowers/specs/2026-06-01-multi-pr-issue-association-design.md`, `docs/superpowers/plans/2026-06-10-pr-monitor.md`

## Problem

Symphony discovers the PR(s) implementing a tracker issue by **inferring** the
link from GitHub's native signals plus **heuristic branch/title guessing**. All
of these are unreliable:

1. `closedByPullRequestsReferences` only registers when the PR uses a closing
   keyword **and** targets the repo's default branch. Gamba PRs target
   `dev`/`development`, so it stays empty.
2. `linkedBranches` is empty unless someone links the branch in the GitHub UI.
3. Cross-referenced timeline events require a `#<number>` mention in the PR
   body. A title like `1857: Daily tip limit` (no `#`) produces no event.
4. The branch search guesses prefixes (`codex/<number>`) and, after a recent
   patch, `symphony/<number>` + a title-number search. This is still guessing.

Concrete failing case: issue **GAM-2** (GitHub `GambaLabs/frontend#1857`) was
implemented by **`GambaLabs/frontend#1866`** (branch `feat/DailyTipLimit`) and
**`GambaLabs/backend#3997`** (branch `symphony/1857`). Both were opened by an
external tool ("Made with Cursor"). None of the native signals fired and the
branch names matched no guessed prefix, so Symphony surfaced **nothing**.

The root issue is **relying on inference**. The fix is to **declare an explicit
contract** that whoever opens the PR follows, and that discovery reads
deterministically — instead of guessing.

## Goals

- Replace heuristic discovery with a **deterministic, declared association**:
  an explicit machine-readable marker plus a parseable workpad registry.
- Make the branch/PR-title/marker conventions an **explicit per-project
  contract** consumed by **both** the agent prompt and the discovery code (one
  source of truth).
- Persist discovered associations (incl. the head branch) so they survive and
  are visible even when live GitHub linkage returns nothing.
- **Reconcile detection back onto the task**: when the background monitor
  detects PRs, update the task's PR list (DB) **and** the `symphony:prs` workpad
  block, idempotently.
- Surface GAM-2's two PRs (`frontend#1866`, `backend#3997`) via the marker /
  workpad path.

## Non-Goals

- Changing issue polling to be multi-repo (only PR association is cross-repo).
- Forcing humans who open ad-hoc PRs to follow the convention. We make
  Symphony's finalizer and the documented agent workflow follow it; legacy/ad-hoc
  PRs are still caught by the native-GitHub fallback (best effort).
- Reworking the local-first sync engine.

## Approach (chosen)

**Declared contract + dual-write.** A new `source_control` section in the
project's `workflow_markdown` declares the conventions. Whoever opens the PR
writes a machine-readable **marker** in the PR body **and** a structured **PR
block** in the `## Codex Workpad` comment. Discovery unions, in deterministic
order, the DB cache → workpad parse → exact marker search → native GitHub
fallback, deduped by URL.

### Considered alternatives

- **Workpad-only:** simplest, but a PR opened without touching the workpad
  (e.g. agent crash before workpad update) would be missed. Rejected as sole
  mechanism; kept as one of the union sources.
- **Marker-only:** robust and searchable, but no durable human-readable record
  on the issue. Rejected as sole mechanism; kept as one of the union sources.
- **Keep heuristic search:** rejected — it is the very fragility we are
  removing. Demoted to a thin last-resort fallback (or removed).

## The Contract — `source_control` front-matter section

New optional section in `workflow_markdown`. Code-level defaults apply when
omitted (so existing projects keep working). Read via
`ProjectConfig.front_matter_section/2` (reads raw front matter, like
`dev_server`/`pr_monitor`/`hooks` already do — no schema change required;
`reject_forbidden_sections`/`validate_workflow_config` do not reject unknown
sections).

```yaml
source_control:
  branch_pattern: "symphony/{issue}"   # consistency only; NOT the link signal
  pr_title_pattern: "{issue}: {title}"
  issue_marker_key: "Symphony-Issue"    # the machine-readable association key
```

- `{issue}` interpolates the Symphony issue **identifier** (e.g. `GAM-2`),
  downcased for branch patterns.
- Defaults (in a new `ProjectConfig` accessor module/functions):
  `branch_pattern: "symphony/{issue}"`, `pr_title_pattern: "{issue}: {title}"`,
  `issue_marker_key: "Symphony-Issue"`.

New `ProjectConfig` accessors (each with `@spec`):
`source_control_branch_pattern/1`, `source_control_pr_title_pattern/1`,
`source_control_issue_marker_key/1`, plus a struct field `:source_control`.

## The Marker (the "field")

A trailer line appended to the PR body by whoever opens the PR:

```
Symphony-Issue: GAM-2
```

- Carries the **Symphony identifier** (decision: identifier, not the GitHub
  `repo#number`). Discovery resolves `GAM-2 → remote_number 1857` via
  `Context.get_issue/2`.
- Parsed by a new pure module `GitHub.IssueMarker`:
  - `marker_line(key, identifier) :: String.t()` — builds `"<key>: <identifier>"`.
  - `extract(body, key) :: [String.t()]` — returns identifiers found in a body
    (line-anchored, case-insensitive key, tolerant of surrounding whitespace).

### Marker-based discovery (deterministic)

`GitHub.PullRequests` gains marker discovery over the project's **configured
repos** (`IssueRepo.candidate_repos/2`):

1. For each configured repo, REST search candidates:
   `repo:<owner>/<name> type:pr <identifier>` (GitHub tokenizes, so this is a
   *candidate* query, not the source of truth).
2. For each candidate, fetch the PR (existing `for_pull_request/3`) and
   **confirm** the exact marker via `IssueMarker.extract(body, key)` matching
   the issue identifier. Only confirmed PRs are kept.

This is deterministic: the link is the explicit marker we wrote, verified
against the fetched body — never a guessed branch prefix.

## The Workpad PR block

Inside the single `## Codex Workpad` comment, a machine-readable sentinel block
(in addition to the existing human `### Outcome` line):

```
<!-- symphony:prs
- repo: GambaLabs/frontend
  number: 1866
  branch: feat/DailyTipLimit
  url: https://github.com/GambaLabs/frontend/pull/1866
- repo: GambaLabs/backend
  number: 3997
  branch: symphony/1857
  url: https://github.com/GambaLabs/backend/pull/3997
-->
```

- HTML comment so it is invisible in rendered markdown but trivially parseable.
- New pure module `Workpad.PullRequestBlock`:
  - `render(prs) :: String.t()` — builds the block from a list of PR maps.
  - `parse(body) :: [pr_ref()]` — extracts `%{repo, number, branch, url}` list;
    returns `[]` when the block is absent or malformed (never raises).
- The workpad skill doc (`.claude/skills/workpad/SKILL.md`) is updated to define
  this block and instruct agents to maintain it.

## Discovery rewrite — `for_project_issue/3`

File: `elixir/lib/symphony_elixir/github/pull_requests.ex`

Union these sources (dedupe by URL, then `sort_prs/1`, then
`annotate_branch_status_per_repo/2`):

1. **DB** — persisted `tracker_pull_requests` rows for the issue
   (`Tracker.Sync.PullRequests` reader).
2. **Workpad** — read the issue's `## Codex Workpad` comment body from the
   synced local comments (`Context.get_issue/2` comments; the workpad is synced
   like any issue comment), run `Workpad.PullRequestBlock.parse/1`, and enrich
   each ref via `for_pull_request/3`.
3. **Marker** — marker-based discovery (above).
4. **Native GitHub** — the existing `for_issue/3` strategies (closing/linked/
   cross-ref), as a fallback for legacy/ad-hoc PRs.

The previous prefix/title heuristic (`branch_search_prefixes/3`,
`search_prs_by_title/3` added earlier this session) is **removed**; deterministic
marker search replaces it. The native-GitHub fallback remains for legacy PRs.

PRs discovered live (workpad/marker/native) are **persisted** (`origin: "auto"`)
so subsequent reads hit the DB cache first.

## Reconciliation / write-back on detection (PR monitor)

When the background `PullRequestMonitor` detects PRs for an issue, it does not
just read — it **reconciles them onto the task**. This is the loop-closer for
externally-opened PRs (the Cursor case): once detected, they become part of the
task's durable PR list.

Where: in `PullRequestMonitor.process_issue/3`, right after the discovery reader
returns `{:ok, prs}` (before per-PR event processing). Runs only when
`pr_monitor_enabled?` and the issue is in a wait state (the reconciler's existing
gate), so there is no contention with a running agent. **The read endpoint does
NOT mutate the workpad** — it only persists to the DB (existing behavior).

Steps (all idempotent):

1. **DB upsert** — upsert each discovered PR into `tracker_pull_requests`
   (`origin: "auto"`, with `repo`, `number`, `url`, `head_branch`,
   `state`) via the store helper. This is the list the tracker UI shows.
2. **Workpad block merge** — resolve the issue id, read the current
   `## Codex Workpad` body from the synced comments,
   `Workpad.PullRequestBlock.upsert_block(body, prs)` to insert/replace **only**
   the `symphony:prs` block (all other sections preserved), and write back via
   `Tracker.upsert_workpad/2` **only when the merged body differs** from the
   current one (no-op otherwise → no comment churn / sync storm).
   - If no workpad comment exists yet, create a minimal one: a `## Codex Workpad`
     header followed by the `symphony:prs` block.

`Workpad.PullRequestBlock` therefore exposes `upsert_block(body, prs) ::
String.t()` in addition to `render/1` and `parse/1`.

Errors here are best-effort and logged: a failed DB upsert or workpad write must
not block the monitor's event processing (merge/CI/review handling) for the PR.

## Who writes the marker + workpad

- **Finalizer** (`RunContract.Finalizer`): `pr_body/1` appends the marker
  trailer using the project's `issue_marker_key`; after opening PRs the run
  records them to the workpad block and to the DB (the orchestrator already
  calls `record_run_pull_requests/2`).
- **Agent prompt** (`workflow_markdown` body): instruct Codex/Cursor to (a)
  include the `Symphony-Issue: <identifier>` trailer when opening a PR and (b)
  add/update the `symphony:prs` workpad block. Covers agent-opened PRs (the
  Cursor case here). The gamba workflow body + the example workflows are
  updated.

## Data Model

Extend `tracker_pull_requests` (migration + `Tracker.Sync.PullRequestRecord`):

| Column        | Type     | Notes |
|---------------|----------|-------|
| `head_branch` | `string` | PR head branch, nullable. Backfill left null for existing rows. |

`repo`, `origin`, `url`, `number`, `remote_id`, `state` already exist. The
marker/workpad writers set `head_branch` when known. Persistence dedupe stays
keyed on `(project_id, issue_identifier, remote_id)`.

## Components summary (files)

**Create (Elixir):**
- `elixir/lib/symphony_elixir/github/issue_marker.ex` — marker build/extract.
- `elixir/lib/symphony_elixir/workpad/pull_request_block.ex` — render/parse.
- `elixir/priv/repo/migrations/<ts>_add_head_branch_to_tracker_pull_requests.exs`.
- Tests for each new module + discovery union.

**Modify (Elixir):**
- `elixir/lib/symphony_elixir/project_config.ex` — `:source_control` field +
  accessors + defaults.
- `elixir/lib/symphony_elixir/github/pull_requests.ex` — union discovery;
  marker search; drop prefix/title heuristic.
- `elixir/lib/symphony_elixir/run_contract/finalizer.ex` — marker in `pr_body/1`.
- `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex` +
  `local_store.ex` + `pull_requests.ex` — persist/read `head_branch`.
- `elixir/lib/symphony_elixir/orchestrator.ex` — write workpad PR block on
  publish (where `record_run_pull_requests/2` runs).
- `elixir/lib/symphony_elixir/pull_request_monitor.ex` — reconcile detected PRs
  onto the task (DB upsert + idempotent workpad block merge) in
  `process_issue/3`.

**Modify (docs/config):**
- `.claude/skills/workpad/SKILL.md` — define the `symphony:prs` block.
- `gamba-project.yaml` (workflow body) + `elixir/WORKFLOW.*.example.md` —
  document `source_control` + agent instructions.
- `elixir/README.md` — `source_control` config contract.

## Error Handling

- Workpad/marker parse failures → treated as "no result" (return `[]`), never
  crash; other union sources still contribute.
- Marker candidate search 404/no access → skip that repo, continue.
- Missing `source_control` section → code defaults apply.
- Identifier→remote_number resolution failure → marker source yields `[]`;
  native fallback still runs.

## Testing

Elixir:
- `IssueMarker`: build line; extract single/multiple/absent/case-variant.
- `Workpad.PullRequestBlock`: render round-trips parse; absent/malformed → `[]`;
  `upsert_block/2` inserts when absent, replaces in place when present, and
  preserves all other workpad sections.
- `PullRequestMonitor` reconciliation: detected PRs are upserted to the DB with
  `head_branch`; workpad block is written when content changed and **not**
  written when unchanged (idempotent); workpad/DB failures do not block event
  processing.
- `PullRequests.for_project_issue/3`: unions DB + workpad + marker + native,
  dedupe by URL; GAM-2 fixture (frontend#1866 via title-candidate→marker,
  backend#3997 via `symphony/1857` branch candidate→marker) returns both.
- `Finalizer.pr_body/1`: includes the marker trailer with the configured key.
- `ProjectConfig`: `source_control` accessors return config values + defaults.
- Migration: `head_branch` column present; existing rows null.

Gates: `make all` (format, lint, coverage, dialyzer), `mix specs.check`.

## Open Questions

- None blocking. Branch/title patterns are advisory (consistency); the marker is
  authoritative.
