# Design: PR follow-up monitor — automatic Rework / Done / Human Review transitions from PR signals

Date: 2026-06-10
Status: Draft (awaiting review)
Scope: GitHub-backed projects only (PR linkage and CI checks are GitHub-only today). Opt-in per project.

## Problem

After the coding agent opens a PR and the issue lands in a wait state (e.g.
`Human Review`), Symphony stops following the PR. Today a human must:

- notice that CI failed and click **Fix with agent** (PR tab) to send the issue
  back to `Rework`;
- notice that the PR was merged and drag the issue to `Done`;
- read automated review-bot comments (e.g. blocking findings posted as PR
  comments/reviews) and decide whether the agent should address them.

The user wants Symphony to follow the PR automatically and act on its behalf:

1. **CI failed because of the PR's changes** → move the issue to `Rework` with
   the pipeline errors attached (same channel as the existing "Fix with agent"
   button).
2. **PR merged** → move the issue to `Done` automatically.
3. **CI failed for unrelated/temporary reasons** (flaky infra, failure
   pre-existing on the base branch, third-party outage) → keep the issue in
   `Human Review` and surface a suggestion with a button to **re-run the failed
   jobs**.
4. **Automated review comments** (e.g. a review bot posting blocking findings,
   like GambaLabs/backend#3992) → if the findings are blocking *and* clearly
   within the agent's ability to fix without human input, move to `Rework` with
   the review content; otherwise keep in `Human Review` flagged for human
   attention.

## Goals

1. A background reconciler that watches issues in `wait_states` with linked
   PRs and reacts to PR signals (merge, concluded CI, new reviews/comments).
2. An LLM classification step — a short one-shot agent turn triggered from the
   reconciler tick (asynchronously) — that decides between
   `Rework` / stay-in-`Human Review` for CI failures and review findings.
3. A hard cap of **2 automatic returns to `Rework` per issue**; after that the
   issue stays in `Human Review` with a warning comment.
4. A **"Re-run failed jobs"** action (API + PR-tab button) wrapping GitHub's
   `rerun-failed-jobs` REST endpoint.
5. Monitor state surfaced in the PR tab (last verdict, action taken,
   rework counter).

## Non-goals

- No GitHub webhooks (polling only, consistent with the rest of Symphony).
- No automatic re-run of flaky jobs (the human clicks the suggested button).
- No automatic merge of green PRs.
- No support for non-GitHub trackers in this iteration (monitor is a no-op).
- No changes to how the agent consumes Rework context (`IssueDiscussion` +
  `PromptBuilder` already inject issue/PR comments at dispatch time).

## Key decisions (from brainstorming)

- **Where judgment runs:** inside the orchestrator's polling cycle — the
  reconciler detects a signal and spawns a short LLM classification session
  before moving the issue (user-selected over agent-side judgment).
- **Scope:** issues in `wait_states` (e.g. `Human Review`) that have at least
  one linked PR. Other states are untouched.
- **Loop guard:** max 2 automatic `Rework` transitions per issue (CI-caused and
  review-caused share the same counter); afterwards force `Human Review` with a
  warning.
- **Unrelated CI failures:** keep in `Human Review` + suggest re-run via button
  (no auto re-run; the user skipped that option, original request stands).
- **Conservative fallback:** any classifier error/timeout/parse failure is
  treated as `needs_human` — the monitor never moves an issue to `Rework` on
  uncertain output.

## Architecture

### New components

| Component | Kind | Responsibility |
|---|---|---|
| `SymphonyElixir.PullRequestMonitor.Reconciler` | GenServer under `OrchestratorSupervisor` | Periodic tick; gathers candidates; delegates to core |
| `SymphonyElixir.PullRequestMonitor` | Core module (mostly pure + adapters) | Event detection, verdict→action mapping, transition execution |
| `SymphonyElixir.PullRequestMonitor.Classifier` | Module | Builds prompt, runs one-shot LLM turn, parses strict JSON verdict |
| `SymphonyElixir.PullRequestMonitor.State` | Ecto schema + context | Per issue+PR monitor bookkeeping (`pull_request_monitor_states`) |
| `SymphonyElixir.GitHub.WorkflowRuns` | Module | `rerun_failed_jobs(repo, run_id)` via `Client.rest_post/3` |
| `SymphonyElixirWeb.Tracker.PullRequestRerunController` | Controller + route | `POST .../pull_requests/:number/rerun_failed` |
| PR tab UI additions | React (`tracker/src`) | Monitor status banner, "Re-run failed jobs" button |

### Reconciler flow (per tick)

Mirrors `DevServer.Reconciler` (defensive rescue/catch, injectable deps via
opts, `Logger.debug` on skips):

1. Skip entirely unless at least one project has `pr_monitor.enabled: true`.
2. `Tracker.fetch_issues_by_states(Config.wait_states())` → bounded issue set.
3. For each issue of an enabled GitHub project: resolve PRs via
   `PullRequests.for_project_issue/3` (reads go through the existing
   `ReadCache`/`RequestGateway` budget).
4. For each issue+PR pair, compute the **event** (see below) against the
   persisted monitor state.
5. `merged` events are applied synchronously (no LLM). Classification events
   spawn a `Task.Supervisor` task (bounded concurrency, e.g. max 2 concurrent
   classifications) so the tick never blocks on LLM latency.
6. Before applying any action, **re-read the issue state**; if it left the
   wait state (human moved it, another actor acted), discard the action.

Tick interval: `SYMPHONY_PR_MONITOR_INTERVAL_MS` exposed through
`SymphonyElixir.Config` (default: orchestrator `poll_interval_ms`, fallback
60s).

### Event detection and persistence

New table `pull_request_monitor_states` (unique on
`project_slug + identifier + pr_url`):

| Column | Type | Purpose |
|---|---|---|
| `project_slug` / `identifier` / `pr_url` | string | Key |
| `last_head_sha` | string | Head commit already evaluated |
| `last_checks_fingerprint` | string | Hash of sorted `{job_name, conclusion}` pairs processed for that SHA |
| `last_review_marker` | string | `created_at` of the newest review/comment already evaluated |
| `auto_rework_count` | integer, default 0 | Loop guard (shared CI + review) |
| `last_classification` | map (JSON) | Last verdict payload for UI/audit |
| `last_action` | string | `moved_to_rework` \| `moved_to_done` \| `kept_human_review` \| `limit_reached` |
| `last_action_at` | utc_datetime | UI display |
| timestamps | | |

Events derived per tick (first match wins, per PR):

1. **`:merged`** — `pr.merged == true` and `last_action != "moved_to_done"`.
2. **`:ci_failure`** — `pr.state in ["open", "draft"]`, checks rollup concluded
   as failure (`checks_state` ∈ FAILURE/ERROR and **no** job still
   `IN_PROGRESS`/`QUEUED`/`PENDING`), and `{head_sha, checks_fingerprint}`
   differs from the persisted pair. Failing-job detection reuses the
   `PullRequestFix` conclusion set (`FAILURE`, `TIMED_OUT`, `CANCELLED`,
   `STARTUP_FAILURE`, `ACTION_REQUIRED`).
3. **`:review_findings`** — newest entry in `pr.conversation` (kind `review`,
   or `comment` whose author is not the PR author) with `created_at` newer
   than `last_review_marker`. Workpad/evidence comments authored by Symphony
   itself are excluded (author == PR author or body starts with a known
   Symphony header).
4. Otherwise **no-op** (checks still running, nothing new).

`merged` short-circuits: a merged PR is never classified.

### LLM classification

`Classifier.classify(event, context, opts)` runs a **single, read-only,
one-shot agent turn** (Codex app-server, same plumbing as
`Assistant.CodexSession` turns) in a scratch workspace (no repo checkout, no
write tools, no dynamic tools). Injectable `classifier_fun` for tests.

Prompt inputs:

- Issue identifier, title, and description (truncated).
- PR title, head/base refs, list of changed files (`GET .../pulls/:n/files`,
  names + additions/deletions only, capped at 50 entries).
- For `:ci_failure`: failing job names + log tail per job via the existing
  `CheckLogs.failing_job_excerpt/3` (same caps as `PullRequestFix`: 3 jobs,
  200 lines / 8 KB each).
- For `:review_findings`: the review/comment body (capped at 8 KB), author,
  review state (e.g. `CHANGES_REQUESTED`).

Required output — strict JSON, last fenced JSON block in the reply is parsed:

```json
{
  "kind": "ci_failure" | "review",
  "verdict": "pr_caused" | "unrelated" | "fixable_by_agent" | "needs_human",
  "confidence": 0.0,
  "summary": "1-2 sentences explaining the judgment"
}
```

Guidance embedded in the prompt:

- `pr_caused`: the failure happens in code/tests touched by (or directly
  exercised by) the PR's changed files.
- `unrelated`: flaky/timeout/infra errors, failures in areas untouched by the
  PR, rate-limit/network errors, or checks already failing on the base branch.
- `fixable_by_agent`: blocking review findings with a clear, mechanical fix
  the agent can apply without product/architecture decisions.
- `needs_human`: anything requiring human judgment, credentials, or product
  decisions — and the default on low confidence (< 0.6).

Failure handling: timeout (configurable, default 120s), JSON parse error, or
unknown verdict → treated as `needs_human` and logged.

### Verdict → action mapping

Executed by `PullRequestMonitor.apply_action/3` (pure decision + adapter
calls), all transitions via `IssueAdapter.dispatch/3` (local-first → outbox →
remote), comments via `add_comment`:

| Event + verdict | Action | Comment posted on the issue |
|---|---|---|
| `:merged` | `move_issue → Done` (config `pr_monitor.done_on_merge`, default true) | `## PR merged — issue completed` (PR number/URL) |
| `:ci_failure` + `pr_caused`, counter < max | `move_issue → Rework`; `auto_rework_count += 1` | Reuses `PullRequestFix.build_comment/1` body (jobs + log tails) prefixed with the monitor header and attempt counter (`attempt 1/2`) |
| `:ci_failure` + `pr_caused`, counter ≥ max | stay; `last_action = limit_reached` | `## CI failure — automatic fix limit reached` + summary, asks for human review |
| `:ci_failure` + `unrelated` | stay in `Human Review` | `## CI failure — likely unrelated to this PR` + LLM summary + suggestion to re-run failed jobs |
| `:review_findings` + `fixable_by_agent`, counter < max | `move_issue → Rework`; counter += 1 | `## Review feedback — automated fix requested` + quoted review body |
| `:review_findings` + `fixable_by_agent`, counter ≥ max | stay; `limit_reached` | limit-reached comment |
| `:review_findings` + `needs_human` | stay | `## Review feedback — needs human attention` + LLM summary |
| any + `needs_human` (incl. classifier failure) | stay | needs-human comment (only when there is a new event; never repeated for the same fingerprint/marker) |

The fingerprint/marker is persisted **when the event is consumed** (before the
async classification completes) so the same signal is never classified twice,
even across restarts. The rework state name reuses the `PullRequestFix`
constant (`"Rework"`); `Done` state name is `"Done"` (consistent with
`PullRequestMergeController`).

### Re-run failed jobs

Backend:

- `SymphonyElixir.GitHub.WorkflowRuns.rerun_failed_jobs(repo, run_id, opts)` →
  `Client.rest_post("/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs")`.
  Returns `:ok` on 201, `{:error, ...}` otherwise.
- Run ids are parsed from the pipeline `url` already returned by
  `PullRequests` (`.../actions/runs/(\d+)`); pipelines without a workflow-run
  URL are skipped.
- `POST /api/tracker/v1/projects/:project_slug/issues/:identifier/pull_requests/:number/rerun_failed`
  re-resolves the PR, collects distinct failing run ids, calls
  `rerun_failed_jobs/3` for each, returns `{ data: { reruns: [...] } }`.
  Errors through the existing `TrackerErrors` renderer.

Frontend (`tracker/src`):

- `services/pullRequests.ts`: `rerunFailedJobs(projectSlug, identifier, prNumber)`.
- `PullRequestTab.tsx`: **Re-run failed jobs** button next to **Fix with
  agent**, gated on `hasFailingChecks`; spinner while in flight; toast +
  refetch on completion.

### Monitor status in the UI

- `GET .../pull_requests` response gains an optional `monitor` entry per PR
  (serialized `pull_request_monitor_states` row: `last_action`,
  `last_classification.summary`, `auto_rework_count`, `last_action_at`).
- `PullRequestTab.tsx` renders a banner when `monitor` is present, e.g.:
  - "CI failure attributed to this PR — sent to Rework (attempt 1/2)."
  - "CI failure looks unrelated — consider re-running the failed jobs." (with
    the re-run button inline)
  - "PR merged — issue moved to Done."
  - "Automatic fix limit reached — human review required."

## Configuration

Per project, `workflow_markdown` front matter (resolved via `ProjectConfig`,
defaults via `SymphonyElixir.Config`):

```yaml
pr_monitor:
  enabled: true          # default: false (opt-in)
  max_auto_rework: 2     # default: 2
  done_on_merge: true    # default: true
```

Process level (`.env.example` updated):

- `SYMPHONY_PR_MONITOR_INTERVAL_MS` — tick interval (default: poll interval).

## Error handling / edge cases

- **Multiple linked PRs:** each PR tracked independently. `Done` fires when
  any non-draft linked PR is merged. CI/review events are evaluated per PR;
  the issue-level `auto_rework_count` is the max across rows.
- **Issue moved while classifying:** re-check the issue's current state right
  before `move_issue`; abort silently if it is no longer in a wait state.
- **Orchestrator already running the issue:** wait-state issues are not
  dispatched, but guard anyway — skip action if the orchestrator reports the
  issue as running/claimed.
- **GitHub errors / rate limit:** log at debug, retry naturally next tick
  (state unchanged ⇒ no event loss; fingerprint only persisted on consume).
- **Comment posts but move fails:** same posture as `PullRequestFix` — comment
  stands as context, error logged, retried manually by a human (the event is
  marked consumed to avoid comment spam).
- **Non-GitHub projects / missing token:** monitor no-op
  (`PullRequests.available?/0` guard).
- **Restart safety:** all bookkeeping is in SQLite; the reconciler is
  stateless between ticks.

## Testing

- **Event detection (pure):** fingerprint/marker computation; merged
  short-circuit; in-progress checks produce no event; new review by non-author
  produces `:review_findings`; Symphony-authored comments excluded.
- **Verdict→action mapping (pure):** table-driven tests for every row above,
  including counter boundaries (1→2, 2→limit) and stale-issue abort.
- **Classifier:** JSON parsing (valid, fenced, malformed → `needs_human`),
  prompt construction caps; LLM call behind injected `classifier_fun`.
- **Reconciler:** stubbed `pull_request_reader`, `classifier_fun`,
  `issue_mover` (same seam style as `DevServer.Reconciler` tests); disabled
  project ⇒ no calls.
- **WorkflowRuns + rerun controller:** injected `request_fun` asserting path;
  controller success envelope and error rendering.
- **Frontend:** service unit tests (`rerunFailedJobs`); PR tab renders banner
  from `monitor` payload; re-run button gated on failing checks.
- Quality gates: `make all` (elixir), `mix specs.check`, tracker test suite.

## Risks / open points

- **LLM misclassification:** mitigated by the conservative fallback, the
  confidence floor, the 2-attempt cap, and the audit comment trail. Worst case
  equals today's behavior (human handles it).
- **Comment volume:** one comment per consumed event; fingerprints prevent
  repeats. Review bots that edit comments in place (instead of posting new
  ones) may not produce a new marker — acceptable for v1.
- **Classification cost/latency:** one short turn per concluded failing
  CI run or new review; bounded by concurrency cap and event dedupe.
- **State names hardcoded** (`Rework`, `Done`): consistent with
  `PullRequestFix` / `PullRequestMergeController`; revisit if a project needs
  different names (same known limitation already documented in the
  fix-with-agent spec).
- **Issue-level counter across PRs:** an adversarial mix of PRs could consume
  attempts quickly; acceptable, the cap is a safety valve, not a quota.

## Out-of-scope follow-ups

- Auto re-run of flaky jobs (one retry before involving the human).
- Webhook-driven updates instead of polling.
- Auto-merge of green approved PRs (`Merging` state automation).
- Classifier feedback loop (learning from human overrides).
