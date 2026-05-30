# Design: "Update branch" — detect behind-base PRs and merge base in from the PR tab

Date: 2026-05-30
Status: Draft (awaiting review)
Scope: GitHub-backed projects only.

## Problem

A PR linked to an issue can be behind its base branch (e.g. `feat/508` behind
`homolog`). Before asking the agent to fix CI, the user often needs to update the
PR branch with the base. Today the PR tab shows no behind/ahead status and offers
no way to update the branch.

The user wants: detect when a PR's branch is behind its base, show an "Update
branch" button on that PR, perform the update (merge base in), then refresh so the
CI/CD pipeline status can be followed as it re-runs.

## Goals

1. Per-PR detection of "behind base" using a reliable, immediate signal.
2. An "Update branch" button shown only when the PR is behind its base.
3. Clicking it merges the base into the PR branch via the GitHub API, then
   refreshes the PR data so CI status updates are followed.

## Non-goals

- No rebase option (GitHub has no public API to rebase a PR branch; explicitly
  decided to ship merge-only, no dropdown).
- No support for cross-fork PR head branches (detection degrades to "no button").
- No changes to the orchestrator or agent dispatch.
- Non-GitHub trackers unaffected (PR tab already degrades to `supported:false`).

## Key decisions (from brainstorming)

- **Detection:** REST `GET /repos/{owner}/{repo}/compare/{base}...{head}` →
  `behind_by`. `behind_by > 0` ⇒ show the button. `mergeStateStatus`/`mergeable`
  are rejected because GitHub computes them lazily and they return `UNKNOWN`
  immediately after a push (verified on PR #509).
- **Update method:** merge only, via `PUT /repos/{owner}/{repo}/pulls/{number}/update-branch`.
- **Button visibility:** whenever `base_behind_by > 0` (covers `behind` and
  `diverged`).
- **Post-update:** refetch the PR list; the existing 20s poll continues to track
  CI as it re-runs on the new head.

## Architecture

### Detection / data flow

1. After `PullRequests.for_issue/3` resolves PRs, enrich each OPEN/DRAFT,
   same-repo PR with `base_behind_by` (integer) via a new
   `GitHub.BranchStatus.behind_by/4` (uses `Client.rest_get` on the compare
   endpoint). Closed/merged PRs and PRs missing `head_ref`/`base_ref` are skipped
   (`base_behind_by: nil`).
2. Enrichment failures (network/permission/compare error) are swallowed →
   `base_behind_by: nil` (no button), never failing the PR list.
3. The PR JSON gains `base_behind_by`; the frontend normalizes it to
   `baseBehindBy` (number | null). Permission to update is not pre-checked; if the
   user lacks rights, the update call surfaces the GitHub error as a toast.

### Update action

1. New endpoint `POST .../issues/:identifier/pull_requests/:number/update_branch`.
2. `PullRequestBranchUpdate.update/2` resolves the repo from the project and calls
   `PUT /repos/{owner}/{repo}/pulls/{number}/update-branch` (merge).
3. GitHub returns `202 Accepted` (async merge) → `{:ok, :accepted}`. A `422`
   means a conflict or already-up-to-date → mapped to `:update_branch_conflict`.
4. The controller returns `{ data: %{ updated: true } }` on 202; `TrackerErrors`
   renders mapped failures.

### Frontend flow

1. `PullRequestPanel` receives `projectSlug`, `issueIdentifier`, and `onRefresh`
   (wired down from `IssueDrawer` → `PullRequestTab`).
2. When `pr.baseBehindBy != null && pr.baseBehindBy > 0`, render an **Update
   branch** button (with the behind count, e.g. "Update branch (1 behind)").
3. On click: disable + spinner, call `updatePullRequestBranch(...)`, toast success
   ("Branch update started — following CI…"), then `onRefresh()`. On error, toast
   the message. The 20s poll keeps refreshing behind/CI state afterward.

## Components

### Backend — create
- `elixir/lib/symphony_elixir/github/branch_status.ex` — `behind_by/4`.
- `elixir/lib/symphony_elixir/pull_request_branch_update.ex` — `update/2`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_branch_controller.ex`.
- Tests for each.

### Backend — modify
- `elixir/lib/symphony_elixir/github/client.ex` — add `rest_put/3` (mirrors
  `rest_get/2`; `Req.put`, same auth headers, JSON body).
- `elixir/lib/symphony_elixir/github/pull_requests.ex` — add `base_behind_by` to
  the PR map (default `nil`); add a public `annotate_branch_status/3` that maps
  over PRs and fills the field via `BranchStatus`; call it at the end of
  `for_issue/3`.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` — map
  `:update_branch_conflict` (422) and `:branch_up_to_date` (200/422 → 422 with a
  clear message).
- `elixir/lib/symphony_elixir_web/router.ex` — add the route.

### Frontend — modify
- `tracker/src/types/pull-request.ts` — add `baseBehindBy: number | null` to
  `PullRequest`; add `UpdateBranchResult`.
- `tracker/src/services/pullRequests.ts` — normalize the two new fields in
  `normalizePullRequest`; add `updatePullRequestBranch(projectSlug, identifier, number)`.
- `tracker/src/components/issues/pull-request/PullRequestPanel.tsx` — the button.
- `tracker/src/components/issues/issue-detail/PullRequestTab.tsx` — pass
  `projectSlug`, `issueIdentifier`, `onRefresh` to each `PullRequestPanel`.
- `tracker/src/components/issues/IssueDrawer.tsx` — already passes `projectSlug`
  to `PullRequestTab` (from the prior feature); no change beyond confirming.

## API/contract details

- `GitHub.BranchStatus.behind_by(repo, base, head, opts)` →
  `{:ok, non_neg_integer()}` | `{:error, term()}`. Parses the compare JSON
  `behind_by`.
- Compare path: `/repos/#{owner}/#{name}/compare/#{base}...#{head}` (URL-encode
  branch segments). Only called for same-repo heads.
- `PullRequestBranchUpdate.update(project, number)` →
  `{:ok, :accepted}` | `{:error, :update_branch_conflict}` |
  `{:error, term()}`.
- Update path: `/repos/#{owner}/#{name}/pulls/#{number}/update-branch`, PUT, body
  `%{}` (merge default). 202 → ok; 422 → conflict; other non-2xx → `{:github_api_status, code}`.
- New PR JSON key: `base_behind_by` (int | null).

## Error handling

- Detection never fails the PR list (errors → `nil`).
- Update conflict (422) → toast "Could not update — resolve conflicts on GitHub".
- No token / non-GitHub project → existing tab gating hides the feature; endpoint
  returns the existing errors.
- Double-click guarded by the button's in-flight disabled state.

## Testing

- `BranchStatus.behind_by/4`: injected `request_fun` returning a compare body with
  `behind_by`; assert parsed int; error propagation.
- `Client.rest_put/3`: injected `request_fun`; assert PUT url/headers/body; 202 ok,
  422 mapped.
- `PullRequests`: `annotate_branch_status/3` fills `base_behind_by` for open PRs
  and leaves merged/closed as `nil`; failures → `nil`. Existing tests still pass
  (new key present with default).
- `PullRequestBranchUpdate.update/2`: stub client → 202 → `{:ok, :accepted}`; 422 →
  `{:error, :update_branch_conflict}`.
- Controller: success envelope `{ data: %{ updated: true } }`; conflict → 422.
- Frontend: `normalizePullRequest` maps `base_behind_by`; service POST test;
  `PullRequestPanel` shows the button only when `baseBehindBy > 0` and POSTs +
  calls `onRefresh` on click.

## Risks / open points

- **Extra REST calls:** one compare call per open PR per PR-tab poll (20s). PR tab
  usually shows 1 PR; acceptable. If it becomes noisy, cache by head SHA later.
- **202 is async:** behind count won't drop instantly; the poll reconciles it. The
  toast communicates "started".
- **Cross-fork PRs:** compare with a fork head needs `owner:branch`; v1 skips
  (no button) for cross-repo heads — acceptable for the current single-repo flow.
- **update-branch 422 ambiguity:** GitHub returns 422 both for conflicts and
  "already up to date"; we surface a single conflict-style message. Acceptable.

## Out-of-scope follow-ups

- Rebase support (API cherry-pick approach or local git + force-push).
- Caching behind status by head SHA to cut compare calls.
- Showing ahead/behind counts as a passive badge even when not behind.
