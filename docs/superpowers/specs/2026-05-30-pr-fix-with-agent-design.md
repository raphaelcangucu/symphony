# Design: "Fix with agent" — re-dispatch a failed PR via Rework with CI failure context

Date: 2026-05-30
Status: Draft (awaiting review)
Scope: GitHub-backed projects only (PR linkage is GitHub-only today).

## Problem

When a PR linked to an issue has failing CI checks, the user has no way from the
Symphony tracker UI to ask the coding agent (Codex/Claude) to fix it. Today
agent dispatch is fully automatic (orchestrator polling), and the "Pull request"
tab is read-only.

The user wants: from the PR tab, trigger a fix where the agent is re-dispatched
**through the existing polling mechanism** (by moving the issue to `Rework`),
with the **CI failure details (including failing-job log excerpts)** delivered to
the agent prompt.

## Goals

1. A "Fix with agent" action on the PR tab, visible only when there is at least
   one failing check and the project is GitHub-backed.
2. On trigger: post a structured comment on the issue containing the failing
   checks and a tail excerpt of each failing job's log, then move the issue to
   `Rework`.
3. Re-dispatch happens via the **existing orchestrator polling** (no new manual
   dispatch path). The agent receives the failure context because the GitHub
   prompt template already renders `issue.comments`.

## Non-goals

- No standalone "re-run CI jobs" button (deferred; can be a later follow-up).
- No changes to the orchestrator dispatch loop or `PromptBuilder`.
- No support for non-GitHub trackers (local/linear) in this iteration.
- No persisted "failure context" column; the comment is the channel.

## Key decisions (from brainstorming)

- **Channel:** post a structured issue comment + move to `Rework`. Reuses the
  GitHub prompt template which already loops `issue.comments`.
- **Log excerpt:** tail-based — last N lines with ANSI/timestamp stripping and a
  per-job size cap. The failure summary reliably sits at the end of Actions logs
  (verified: vitest summary + `##[error]Process completed with exit code 1`).
- **Target state:** hardcoded `"Rework"` for now.

## Architecture

### Flow

1. User clicks **Fix with agent** in the PR tab (enabled only when a check
   failed).
2. Frontend `POST /api/tracker/v1/projects/:project_slug/issues/:identifier/pull_requests/fix`.
3. Backend action:
   1. Load project (`Context.get_project/1`); require GitHub tracker
      (`PullRequests.resolve_repo/1`). Else `422`/`supported:false`.
   2. Resolve related PRs + checks via `PullRequests.for_issue/3`.
   3. Select failing jobs (job `conclusion` in the failure set, see below).
   4. For each failing job (capped), fetch its log via new REST helper and
      extract a cleaned tail excerpt.
   5. Build a markdown comment (PR number/URL, per-job name + URL + excerpt).
   6. `IssueAdapter.dispatch(project, :add_comment, [identifier, body, %{}])`.
   7. `IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => "Rework"}])`.
   8. Return `{ ok: true, comment_posted: true, moved_to: "Rework", jobs: [...] }`.
4. Orchestrator polling sees the issue in `Rework` (an `active_state`) and
   re-dispatches; the agent's prompt includes the new comment.

### Failure detection

A job is "failing" when its `conclusion` (uppercased) is one of:
`FAILURE`, `TIMED_OUT`, `CANCELLED`, `STARTUP_FAILURE`, `ACTION_REQUIRED`.
`SKIPPED`, `NEUTRAL`, `SUCCESS` are not failures.

If no failing jobs are found, the action returns `422` with reason
`:no_failing_checks` (the UI should not have offered the button, but guard
anyway).

### Job id for the REST logs call

GitHub Actions job logs require a numeric job id:
`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` (302 → blob; followed).

The `CheckRun.databaseId` equals the `/job/{id}` segment of `detailsUrl`
(verified on PR #509: `databaseId 78427907850` == URL `/job/78427907850`).

- Add `databaseId` to the `CheckRun` GraphQL selection in
  `SymphonyElixir.GitHub.PullRequests` (`@pr_fields`).
- Expose it on the job map as `job_id` (integer | nil) from `check_run_to_job/1`.
- Fallback: if `databaseId` is absent, parse the `/job/(\d+)` group from `url`.
- If neither yields an id, include the job in the comment without a log excerpt
  (name + URL only).

## Components

### Backend

#### 1. `SymphonyElixir.GitHub.Client` — REST GET helper (new public fn)

```elixir
@spec rest_get(String.t(), keyword()) ::
        {:ok, %{status: pos_integer(), body: term(), headers: list()}} | {:error, term()}
def rest_get(path, opts \\ [])
```

- Builds `https://api.github.com#{path}`.
- Reuses `require_token/0` and the same auth header pattern
  (`Authorization: Bearer`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`).
- Follows redirects (Req default) so the Actions logs blob is fetched.
- Returns the body as a string for log endpoints.
- Injectable `request_fun` for tests (mirror `graphql/3`'s test seam).

#### 2. `SymphonyElixir.GitHub.CheckLogs` (new module)

```elixir
@spec failing_job_excerpt(String.t(), pos_integer(), keyword()) ::
        {:ok, String.t()} | {:error, term()}
def failing_job_excerpt(repo, job_id, opts \\ [])
```

- Calls `Client.rest_get("/repos/#{owner}/#{repo}/actions/jobs/#{job_id}/logs")`.
- Cleans + tails the log (pure function, unit-tested):
  - strip leading ISO timestamp prefix per line (`^\S+T\S+Z\s`),
  - strip ANSI escape sequences,
  - take last `@max_lines` lines (default 200),
  - cap to `@max_bytes` (default 8 KB) from the end,
  - return trimmed text.
- Constants: `@max_lines 200`, `@max_bytes 8_192`, `@max_jobs 3` (cap enforced by caller).

#### 3. `SymphonyElixir.PullRequestFix` (new module) — orchestration

```elixir
@spec request_fix(Project.t(), String.t()) ::
        {:ok, %{comment: map(), status: String.t(), jobs: [map()]}}
        | {:error, term()}
def request_fix(project, identifier)
```

- Guards GitHub project (`PullRequests.resolve_repo/1`).
- `PullRequests.for_issue/3` → pick PRs with failing jobs.
- Builds the comment body (pure `build_comment/1` for unit tests).
- Posts comment + moves to `Rework` via `IssueAdapter.dispatch/3`.
- `@rework_state "Rework"` module constant.
- Caps: up to `@max_jobs` failing jobs total across PRs; per-job excerpt from
  `CheckLogs`.

Comment body shape (markdown):

```
## CI failure — automated fix requested

Symphony detected failing checks on the linked pull request(s).

### PR #509 — docs: add llms.txt
<url>

**Failing checks:**

#### vitest / test — FAILURE
<job url>

```log
<cleaned tail excerpt>
```
```

#### 4. `SymphonyElixirWeb.Tracker.PullRequestFixController` (new) + route

- Route under the existing tracker scope:
  `POST /projects/:project_slug/issues/:identifier/pull_requests/fix`.
- `create/2`: `Context.get_project/1` → `PullRequestFix.request_fix/2` →
  JSON `{ data: %{ moved_to, comment_posted, jobs } }`.
- Errors via existing `TrackerErrors.render/2`
  (`:no_failing_checks`, `:not_supported_on_remote`, etc.).

### Frontend (`tracker/src`)

#### 5. Service: `services/pullRequests.ts`

```ts
export async function requestPullRequestFix(
  projectSlug: string,
  identifier: string,
): Promise<PullRequestFixResult>
```

- `http.post(trackerPath('/projects/.../issues/.../pull_requests/fix'))`.
- Follows the `comments.ts` / `terminal.ts` POST pattern.

#### 6. UI: PR tab button

- In `components/issues/issue-detail/PullRequestTab.tsx` (or `pull-request/PullRequestPanel.tsx`),
  add a **Fix with agent** button next to **Refresh**.
- Enabled only when `result.supported && result.available` and at least one job
  has a failing conclusion (compute a `hasFailingChecks` helper from the
  existing PR data).
- While in flight: disabled + spinner. On success: toast + trigger PR refetch
  (the issue will move to Rework and re-dispatch on the next poll).
- On error: toast with message.

## Error handling

- Non-GitHub project → `not_supported`; button hidden, endpoint returns
  `supported: false`.
- No GitHub token (`PullRequests.available?/0` false) → `422` available:false;
  button hidden.
- Log fetch failure for a specific job → include the job in the comment with a
  note (`_(log unavailable)_`) instead of failing the whole action.
- Comment posts but `move_issue` fails → return `{:error, :move_failed}` after
  the comment; surface a toast so the user can move manually. (Comment already
  records context.)
- All external calls use `with`/tagged tuples; no raised exceptions leak to the
  controller.

## Testing

- `GitHub.CheckLogs`: pure `clean_and_tail/1` unit tests (timestamp strip, ANSI
  strip, line cap, byte cap); `failing_job_excerpt/3` with injected
  `request_fun` returning a captured log fixture (assert excerpt contains the
  error region, excludes early noise).
- `GitHub.Client.rest_get/2`: injected `request_fun`, asserts URL + headers,
  redirect-followed body returned.
- `PullRequests`: `parse_pr_node/1` now exposes `job_id`; add assertion. Existing
  tests still pass.
- `PullRequestFix`: `build_comment/1` pure test (markdown shape, multiple jobs,
  job without excerpt). `request_fix/2` with a stub adapter asserting
  `add_comment` then `move_issue("Rework")` order, and `:no_failing_checks`
  guard.
- Controller test: success envelope; `not_supported`/`no_failing_checks` errors.
- Frontend: service unit test for `requestPullRequestFix`; component test that
  the button is gated on failing checks and POSTs on click.

## Risks / open points

- **Comment noise:** repeated clicks post repeated comments. Mitigation: disable
  button while issue is already in `Rework` (frontend) — acceptable for v1.
- **Log size:** capped per job and per job-count; comment stays well under the
  GitHub 65,536-char limit.
- **databaseId ≠ job id assumption:** verified for Actions check runs; fallback
  to URL parsing covers edge cases; no-excerpt fallback covers the rest.
- **Rework hardcoded:** projects whose dispatch state isn't named `Rework` won't
  re-dispatch correctly; revisit if a second project needs a different name.

## Out-of-scope follow-ups

- Standalone "re-run failed CI jobs" button (REST
  `actions/runs/{id}/rerun-failed-jobs`).
- Optional free-text instruction box appended to the comment.
- `PromptBuilder` `ci_failures` variable as an alternative/again-on-every-dispatch channel.
