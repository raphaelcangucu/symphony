# PR Merge Actions Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools (package manager, test runner, linter).

**Goal:** Add merge and force-merge actions to the issue PR tab, and move the task to `Done` after a successful merge.

**Architecture:** Add a backend merge boundary that calls GitHub's PR merge REST endpoint and then reuses the existing tracker `move_issue` flow to mark the issue `Done`. Add a frontend service and panel controls for merge method selection plus a force option. Keep GitHub-specific behavior server-side so status updates and API error mapping stay consistent.

**Tech Stack:** Phoenix/Elixir, GitHub REST API, React, TypeScript, Vitest, ExUnit.

---

## File Map

- Create: `elixir/lib/symphony_elixir/pull_request_merge.ex` owns GitHub PR merge calls and response mapping.
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_merge_controller.ex` owns the merge endpoint and issue move-to-done orchestration.
- Create: `elixir/test/symphony_elixir/pull_request_merge_test.exs` covers merge payloads and GitHub error mapping.
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_merge_controller_test.exs` covers endpoint success and task status update.
- Modify: `elixir/lib/symphony_elixir_web/router.ex` to add the merge route.
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex` to expose clear merge-specific error codes.
- Modify: `tracker/src/types/pull-request.ts` to add merge method/result types.
- Modify: `tracker/src/services/pullRequests.ts` to add `mergePullRequest`.
- Modify: `tracker/src/services/__tests__/pullRequests.updateBranch.test.ts` to cover the merge service.
- Modify: `tracker/src/components/issues/pull-request/PullRequestPanel.tsx` to render merge controls.
- Modify: `tracker/src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx` to cover merge UI behavior.

## Task 1: Backend Merge Boundary

**Files:**
- Create: `elixir/test/symphony_elixir/pull_request_merge_test.exs`
- Create: `elixir/lib/symphony_elixir/pull_request_merge.ex`

- [ ] **Step 1: Write the failing tests**

Test cases:
- `merge/4` sends `PUT /repos/:owner/:repo/pulls/:number/merge`.
- `"merge"`, `"squash"`, and `"rebase"` are accepted methods.
- `bypass: true` is preserved as user intent for the endpoint response/logical flow, but the GitHub REST merge payload does not include an unsupported bypass field; GitHub applies admin/bypass permissions based on the token actor.
- invalid methods return `{:error, :invalid_merge_method}`.
- GitHub `405`, `409`, and `422` map to clear merge errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/pull_request_merge_test.exs`

Expected: FAIL because `SymphonyElixir.PullRequestMerge` is not defined.

- [ ] **Step 3: Implement `PullRequestMerge`**

Add a focused module with:
- `@type method :: :merge | :squash | :rebase`
- `@spec merge(Project.t(), pos_integer(), method() | String.t(), keyword()) :: {:ok, map()} | {:error, term()}`
- project/repo validation via existing `PullRequests.resolve_repo/1` and `RepoSpec.split/1`
- client injection via `:client_module`
- REST body with `merge_method`; do not send unsupported bypass fields to GitHub

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/pull_request_merge_test.exs`

Expected: PASS.

## Task 2: Backend Endpoint And Done Transition

**Files:**
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/pull_request_merge_controller_test.exs`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/pull_request_merge_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`

- [ ] **Step 1: Write the failing controller tests**

Test cases:
- successful `POST /api/tracker/v1/projects/:project_slug/issues/:identifier/pull_requests/:number/merge` returns `%{"merged" => true}`.
- successful merge dispatches the existing issue move flow with status `"Done"`.
- invalid PR number returns `invalid_pr_number`.
- invalid merge method returns `invalid_merge_method`.
- blocked/forbidden GitHub merge responses surface merge-specific error codes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/pull_request_merge_controller_test.exs`

Expected: FAIL because route/controller are missing.

- [ ] **Step 3: Implement route, controller, and error mapping**

Add:
- route under the existing PR routes
- controller parsing `method` defaulting to `"merge"` and `bypass` defaulting to `false`
- `with` chain: parse PR number, load project, call `PullRequestMerge.merge/4`, dispatch `IssueAdapter.move_issue` to `%{"status" => "Done"}`
- JSON response containing merge result and presented updated issue
- errors in `TrackerErrors` for invalid method and merge blocked/conflict/forbidden cases

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/pull_request_merge_controller_test.exs`

Expected: PASS.

## Task 3: Frontend Service

**Files:**
- Modify: `tracker/src/types/pull-request.ts`
- Modify: `tracker/src/services/pullRequests.ts`
- Modify: `tracker/src/services/__tests__/pullRequests.updateBranch.test.ts`

- [ ] **Step 1: Write the failing service test**

Test cases:
- `mergePullRequest("macro-markets", "508", 509, { method: "squash", bypass: true })` posts to `/merge` with `{ method: "squash", bypass: true }`.
- it rejects invalid PR numbers before calling HTTP.
- it rejects blank project slug or issue identifier before calling HTTP.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm test -- src/services/__tests__/pullRequests.updateBranch.test.ts`

Expected: FAIL because `mergePullRequest` is not exported.

- [ ] **Step 3: Implement service and types**

Add:
- `PullRequestMergeMethod = "merge" | "squash" | "rebase"`
- `MergePullRequestInput`
- `MergePullRequestResult`
- `mergePullRequest(projectSlug, identifier, number, input)` using existing path conventions and validation

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm test -- src/services/__tests__/pullRequests.updateBranch.test.ts`

Expected: PASS.

## Task 4: Frontend Panel Controls

**Files:**
- Modify: `tracker/src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`
- Modify: `tracker/src/components/issues/pull-request/PullRequestPanel.tsx`

- [ ] **Step 1: Write failing UI tests**

Test cases:
- open PRs show merge method selection and `Merge`.
- clicking `Merge` calls `mergePullRequest` with the selected method and `bypass: false`, then refreshes.
- clicking `Force merge` calls `mergePullRequest` with `bypass: true`.
- merged/closed/draft PRs do not show merge actions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npm test -- src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`

Expected: FAIL because merge controls are missing.

- [ ] **Step 3: Implement panel controls**

Add:
- `merging` state and `mergeMethod` state
- guard `canMerge = pr.state === "open"`
- method select with accessible label
- `Merge` and `Force merge` buttons
- toasts for success/failure and `onRefresh()` after success

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npm test -- src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`

Expected: PASS.

## Task 5: Focused Verification

**Files:**
- All changed files

- [ ] **Step 1: Run backend targeted tests**

Run:
- `cd elixir && mix test test/symphony_elixir/pull_request_merge_test.exs test/symphony_elixir_web/controllers/tracker/pull_request_merge_controller_test.exs`
- `cd elixir && mix specs.check`

Expected: PASS.

- [ ] **Step 2: Run frontend targeted tests**

Run:
- `cd tracker && npm test -- src/services/__tests__/pullRequests.updateBranch.test.ts src/components/issues/pull-request/__tests__/PullRequestPanel.updateBranch.test.tsx`
- `cd tracker && npm run build`

Expected: PASS.

## Self-Review

- Spec coverage: merge, force/admin bypass, method selection, and move-to-`Done` are covered by Tasks 1-4.
- Placeholder scan: no placeholder work remains; all tasks identify concrete files, behavior, and commands.
- Type consistency: frontend method union matches backend accepted methods; controller defaults to `merge`.
