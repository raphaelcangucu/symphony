# GitHub Polling, Caching & Rate-Limit Design

- **Date:** 2026-05-30
- **Status:** Implemented (branch `feat/github-polling-rate-limit`)
- **Author:** Symphony engineering
- **Related:** `elixir/lib/symphony_elixir/github/client.ex`, `elixir/lib/symphony_elixir/orchestrator.ex`, `elixir/lib/symphony_elixir/local_tracker/viewer.ex`, `tracker/src/hooks/useTrackerPolling.ts`

## 1. Problem

The Symphony tracker board went blank with the error:

```json
{ "error": { "code": "github_network_error", "message": "Failed to reach GitHub. Try again in a moment." } }
```

Investigation showed GitHub was reachable and the token valid. The real cause: the
GitHub **GraphQL API rate limit was fully exhausted** (`5000/5000`,
`type: "RATE_LIMIT"`, `code: "graphql_rate_limit"`). Two distinct defects:

1. **Misclassification.** A GraphQL `errors` payload (including rate-limit) is folded into
   `{:network_error, _}` in `Viewer.resolve/1`, rendered as a misleading
   "Failed to reach GitHub" `503`. The operator cannot tell a rate-limit from a network
   outage, and there is no reset-time guidance.
2. **Excessive GraphQL consumption.** The orchestrator polls every 30s and, each cycle,
   calls `IssueDiscussion.enrich_issues/3` which issues **one GraphQL request per candidate
   issue** (`@pr_discussion_query`), plus per-label admission queries. Frontend hooks
   independently poll backend endpoints that re-hit GitHub (PR/branch status), duplicating
   work. With a handful of issues this exhausts the 5000-point/hour budget.

## 2. Goals

- Surface rate-limiting accurately, with reset time and automatic recovery.
- Drastically cut GitHub GraphQL consumption without losing autonomous task pickup.
- Stop the frontend from making any requests while the site is not focused.
- Deduplicate GitHub reads between the orchestrator and frontend-serving endpoints via a
  single shared 60s cache (one source of truth).
- Give the operator a visible signal of whether polling is active or idle.

## 3. Non-goals

- Changing the agent execution / dispatch lifecycle beyond *when* PR-discussion enrichment runs.
- Migrating away from GitHub Projects v2 GraphQL.
- Multi-node/cluster presence. Symphony runs as a single local node.
- Linear adapter changes (out of scope; this is GitHub-specific, but shared modules stay adapter-agnostic).

## 4. Decisions (locked with operator)

| Topic | Decision |
|---|---|
| Backend orchestrator | **Keep polling, every 60s** (default `poll_interval_ms` 30s → 60s) so task pickup is never missed. |
| Dedup mechanism | **Shared server-side read-through cache, 60s TTL**, single-flight, used by orchestrator + controllers. Not Phoenix.Presence. |
| Frontend polling | **Gated on strict window focus** (not mere visibility). No requests while unfocused. |
| PR-discussion enrichment | **Lazy** — never in the poll cycle. Enrich one issue at dispatch time (agent context) and on issue-open in the UI (cache-backed). |
| Visual indicator | Board refresh control shows **active vs idle** polling state. |

### 4.1 Consequence (explicitly accepted)

While unfocused, the **frontend** issues zero requests; the **backend** still polls every
60s, so new issues are picked up within ~60s. In-flight agents are event-driven
(`{:codex_worker_update, …}`, `{:DOWN, …}`) and keep running/reporting regardless of focus.

## 5. Part 1 — Accurate rate-limit classification

### 5.1 `GitHub.Client.graphql/3`

Today a `200` response whose body contains a non-empty `errors` array becomes
`{:error, {:github_graphql_errors, errors}}` indiscriminately. Add rate-limit detection
**before** that generic mapping:

- Inspect the decoded body's `errors` for any entry with
  `type == "RATE_LIMIT"` or `code` in (`"graphql_rate_limit"`, `"RATE_LIMITED"`).
- Inspect response headers (the `request_fun` result already carries them) for
  `x-ratelimit-remaining: "0"`; parse `x-ratelimit-reset` (unix seconds) into a `DateTime`.
- On rate-limit, return `{:error, {:rate_limited, %{reset_at: DateTime.t() | nil}}}`.
- A `403`/`429` HTTP status with the same headers maps to `{:rate_limited, …}` as well
  (GitHub uses 403 for secondary limits).

New error tuple added to the public contract: `{:rate_limited, %{reset_at: DateTime.t() | nil}}`.

### 5.2 `LocalTracker.Viewer`

- Extend `viewer_error` type with `{:rate_limited, map()}`.
- In `resolve/1`, match `{:error, {:rate_limited, info}}` and return it **before** the
  catch-all `{:network_error, reason}` clause.
- Rate-limit errors must **not** be cached (same as other errors today).

### 5.3 `SymphonyElixirWeb.TrackerErrors`

Add a clause:

```elixir
def render(conn, {:rate_limited, info}) do
  error(conn, 429, "github_rate_limited", rate_limited_message(info))
end
```

`rate_limited_message/1` includes the reset time when known, e.g.
`"GitHub API rate limit exceeded. Access resets at 23:13 UTC (in ~2 min)."` and a generic
fallback when `reset_at` is nil. Response envelope keeps the existing shape and MAY include
`error.reset_at` (ISO 8601) for the frontend to schedule a retry.

### 5.4 Frontend

- `tracker/src/services/viewer.ts`: add `"github_rate_limited"` to `VIEWER_ERROR_CODES`;
  surface `reset_at` if present.
- `tracker/src/pages/TokenGatePage.tsx`: add a `case "github_rate_limited"` with an accurate
  message + reset countdown, and **auto-retry** the viewer query at `reset_at` (fallback: 60s).

## 6. Part 2 — Shared GitHub read cache (single source of truth)

### 6.1 `SymphonyElixir.GitHub.ReadCache`

A new ETS-backed GenServer mirroring the `LocalTracker.Viewer.Server` pattern.

- **API:**
  - `fetch(key, ttl_ms \\ 60_000, fun)` — read-through. On fresh hit, return cached value.
    On miss/expiry, run `fun` (which performs the GitHub call), store `{value, expires_at}`,
    return it. Only `{:ok, _}` results are cached; `{:error, _}` is returned without caching.
  - `invalidate(key)` and `invalidate_all/0`.
- **Single-flight:** concurrent misses for the same key coalesce. Implemented by the
  GenServer tracking in-flight keys and queuing callers (or via a per-key `Task` registered
  in state); the GitHub call runs once and the result fans out. This is the core dedup that
  prevents orchestrator + frontend from both calling GitHub for the same resource.
- **Keys (logical, not raw query hashes):**
  - `:board_items` — the project-items poll result set.
  - `{:issue_pr_discussion, repo, number}` — lazy PR-discussion enrichment for one issue.
  - `{:branch_status, repo, branch}` / `{:issue_pull_requests, repo, number}` — frontend
    PR/branch status reads.
- **TTL:** default 60s, configurable via `Config` (`github_read_cache_ttl_ms`), aligned with
  the poll interval.

### 6.2 Wiring

- `GitHub.Client` read paths used by both orchestrator and controllers route through
  `ReadCache.fetch/3`. Writes (`update_issue_state`, `create_comment`, PR merge, admissions)
  **invalidate** affected keys (at minimum `:board_items` and the touched
  `{:issue_pr_discussion, …}`), so a mutation is never masked by stale cache.
- The orchestrator's `fetch_candidate_issues` / `fetch_issues_by_states` board read is cached
  under `:board_items`. A 60s poll that lands on a warm cache performs **zero** GitHub calls
  for the item list.

### 6.3 Backend poll interval

- `Config @default_poll_interval_ms`: `30_000` → `60_000`.
- `WORKFLOW.md` documentation updated to note the new default and that it aligns with the
  read-cache TTL.

## 7. Part 3 — Lazy PR-discussion enrichment

### 7.1 Remove enrichment from the poll path

- `GitHub.Client.do_poll_project_items/5` and `do_fetch_issues_by_ids/5` stop calling
  `IssueDiscussion.enrich_issues/3`. The poll path returns issues with only the comments
  already present in the items query (`comments(last: 30)` on the issue itself).
- This eliminates the per-candidate `@pr_discussion_query` calls every cycle (the N-multiplier).

### 7.2 Enrich at dispatch (agent context preserved)

- The agent prompt template (`github/tracker.ex`) renders `issue.comments` as
  "Recent discussion (issue + PR)". To preserve this for the **dispatched** issue only,
  enrich that single issue immediately before dispatch.
- Add `IssueDiscussion.enrich_issue/3` (singular) or reuse `enrich_issues/3` with a one-element
  list, routed through `ReadCache` under `{:issue_pr_discussion, repo, number}`.
- Hook point (chosen): the GitHub `Tracker` adapter's single-issue fetch path used at dispatch
  performs the enrichment, keeping all GitHub logic inside the adapter and the orchestrator
  agnostic. Net cost: **1 enrichment call per dispatched issue** instead of N per poll.

### 7.3 Enrich on issue-open (UI)

- The issue drawer/detail fetch (single-issue endpoint) requests enrichment through the same
  cached key, so opening an issue shows PR discussion without a per-poll cost and dedups with
  any dispatch-time enrichment within the TTL.

## 8. Part 4 — Frontend focus gating + indicator

### 8.1 Focus source of truth

- New `useWindowFocus()` hook (or `FocusProvider` + context) — the single source of truth.
- **Strict focus:** active iff `document.hasFocus()` is true *and* `document.visibilityState
  === "visible"`. Listens to `focus`, `blur`, and `visibilitychange`. Visible-but-unfocused
  (another window clicked) counts as **inactive**.

### 8.2 Gate all polling hooks

Convert every interval-based hook to pause when inactive and refetch immediately on
re-activation (the pattern already in `useAgentExecutions`):

- `useTrackerPolling` (board), `useIssuePullRequests`, `useIssueEditor`, `useIssueDevServers`,
  and `useAgentExecutions` (already gated on visibility → tighten to strict focus for consistency).
- A shared helper `useFocusedInterval(callback, intervalMs)` centralizes: skip tick while
  inactive, fire once on activation, clear on unmount.

### 8.3 Polling indicator on the board

- `ProjectHeader` gains a polling-state prop (e.g. `pollingActive: boolean`) derived from
  `useWindowFocus()`.
- The existing `RefreshCw` control communicates state:
  - **Active:** subtle "live" affordance (e.g. green status dot / `aria-label="Polling active"`).
  - **Idle:** muted dot + `aria-label="Polling paused (window not focused)"`, with a tooltip.
  - **Syncing:** unchanged spinner during an in-flight refetch.
- Manual refresh remains available and works regardless of focus.

## 9. Error handling

- Cache stores only successes; transient GitHub errors fall through to existing handling and
  are never cached.
- Rate-limit errors propagate the new `{:rate_limited, …}` tuple end-to-end; the orchestrator
  logs at `warning` (not `error`) and skips the cycle without poisoning the cache.
- Single-flight must release in-flight keys on `fun` crash/timeout so a failed call cannot
  wedge a key.

## 10. Testing

**Backend (ExUnit):**
- `Client.graphql/3`: rate-limit body and `403/429 + x-ratelimit-remaining: 0` headers map to
  `{:rate_limited, %{reset_at: …}}`; non-rate-limit errors still map to `{:github_graphql_errors, …}`.
- `Viewer`: `{:rate_limited, …}` returned and not cached.
- `TrackerErrors`: renders `429 github_rate_limited` with reset message; envelope includes `reset_at`.
- `ReadCache`: hit/miss/expiry; single-flight coalescing (one underlying call for concurrent
  misses); errors not cached; invalidation on key; in-flight release on `fun` raise.
- Orchestrator/Client poll path: no `@pr_discussion_query` issued during polling; `:board_items`
  served from cache on warm reads.
- Dispatch enrichment: exactly one enrichment call per dispatched issue; agent prompt still
  includes PR discussion.

**Frontend (Vitest/RTL):**
- `useWindowFocus`: active only when focused AND visible; transitions on focus/blur/visibility.
- `useFocusedInterval`: no ticks while inactive; immediate fire on activation; cleanup.
- Gated hooks issue no fetches while unfocused.
- `TokenGatePage`: `github_rate_limited` message + countdown + auto-retry at reset.
- `ProjectHeader`: active/idle/syncing rendering and accessible labels.

## 11. Rollout & risk

- All changes are behind existing config; default poll interval and cache TTL are configurable.
- Risk: stale board during the 60s TTL — acceptable; manual refresh forces a cache-busting read.
- Risk: lazy enrichment changes agent input timing — mitigated by enriching the dispatched
  issue synchronously before run.
- Risk: single-flight bug wedging a key — mitigated by mandatory in-flight release on
  success/error/crash and a covering test.

## 12. Open questions

None outstanding. Defaults chosen: poll 60s, cache TTL 60s, strict focus, lazy enrichment.
