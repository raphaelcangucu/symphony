# PR #7 Six Independent Mobile Tasks Implementation Plan

> **For Codex:** Execute this plan test-first with focused checks only. Do not
> run the complete local suite in WSL.

**Goal:** Remove comparison as a Dev10x Mobile product feature, make evidence
generic and task-scoped, and validate the app by creating six independent
top-level tasks through the app: three rich sessions and three orchestrator
dispatches.

**Architecture:** The mobile product uses only ordinary task, assistant
session, orchestrator, terminal, preview, and evidence RPCs. Each task owns its
settings, logs, workspace, and evidence. A local E2E harness coordinates and
compares six app-driven tasks outside product runtime and writes a local
manifest/report.

**Design:** `docs/superpowers/specs/2026-07-28-pr-7-six-independent-mobile-tasks-design.md`

---

## Task 1: Remove comparison from task creation and task detail

**Modify:**

- `mobile/src/features/tasks/CreateTaskScreen.test.tsx`
- `mobile/src/features/tasks/CreateTaskScreen.tsx`
- `mobile/src/features/tasks/CreateTaskRoute.tsx`
- `mobile/src/features/tasks/IssueScreen.test.tsx`
- `mobile/src/features/tasks/IssueScreen.tsx`
- `mobile/src/features/tasks/IssueRoute.test.tsx`
- `mobile/src/features/tasks/IssueRoute.tsx`
- `mobile/app/h/[hostId]/tasks.tsx`

**Delete:**

- `mobile/src/dev10x/tasks/dev10x-comparison-navigation.ts`
- `mobile/src/features/comparisons/comparison-task.test.ts`
- `mobile/src/features/comparisons/comparison-task.ts`
- `mobile/app/codex/issue/[projectSlug]/[identifier]/comparison.tsx`

### Steps

1. Change focused tests to assert that New Task has one ordinary task path and
   no comparison option, marker, matrix, or parent copy.
2. Change task-detail tests to assert normal task actions only and remove
   `Run/Open comparison`.
3. Run the focused tests and confirm RED.
4. Remove `taskKind`, comparison description decoration/parsing, comparison
   actions/routes, and the inherited tasks-list navigation hook.
5. Run the focused tests and confirm GREEN.

**Focused verification:**

```bash
cd mobile
npx vitest run \
  src/features/tasks/CreateTaskScreen.test.tsx \
  src/features/tasks/IssueScreen.test.tsx \
  src/features/tasks/IssueRoute.test.tsx
```

## Task 2: Make agent/model/effort ordinary task settings

**Modify:**

- `mobile/src/features/tasks/CreateTaskScreen.test.tsx`
- `mobile/src/features/tasks/CreateTaskScreen.tsx`
- `mobile/src/features/tasks/CreateTaskRoute.tsx`
- `mobile/src/features/tasks/IssueScreen.test.tsx`
- `mobile/src/features/tasks/IssueScreen.tsx`
- `mobile/src/features/tasks/IssueRoute.tsx`

**Reuse:**

- `mobile/src/features/sessions/NewSessionScreen.tsx`
- `mobile/src/api/contracts.ts`
- `mobile/src/api/client.ts`

### Steps

1. Add RED tests for selecting an available agent, model, and effort from the
   selected project's assistant catalog.
2. Add RED task-detail tests that show requested settings and provide a
   deterministic session action even when the task has no thread yet.
3. Load `assistantCatalog(projectSlug)` in the task route and pass normalized
   choices to the screen.
4. Reuse the existing session selector labels and compatibility rules; do not
   hard-code the six E2E agents in product UI.
5. Submit `agent`, `model`, and `effort` on the one normal `createIssue` call.
6. Route `Start session` to the existing issue-session creation experience,
   prefilled with project/task/settings; existing threads route directly to
   rich chat.
7. Keep orchestrator dispatch as the existing explicit normal task action.
8. Run focused tests and TypeScript checking for touched files.

## Task 3: Remove the comparison coordinator and RPC surface

**Modify:**

- `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex`
- `elixir/test/symphony_elixir/mobile_rpc/dispatcher_test.exs`

**Delete:**

- `elixir/lib/symphony_elixir/mobile_rpc/comparison_service.ex`
- `elixir/lib/symphony_elixir/mobile_rpc/methods/comparisons.ex`
- `elixir/lib/symphony_elixir/mobile_comparison/`
- `elixir/test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs`
- `elixir/test/symphony_elixir/mobile_comparison/`
- `mobile/src/features/comparisons/`

### Steps

1. Add a dispatcher assertion that `comparisons.*` is absent from advertised
   capabilities and returns `method_not_allowed`.
2. Run the focused dispatcher test and confirm RED.
3. Remove comparison modules from the default dispatcher allowlist.
4. Delete all comparison service, contract, presenter, subscription, decision,
   session starter, and collector modules and their tests.
5. Delete the React Native comparison client, hook, contract, screen, route,
   and tests.
6. Run `rg` to prove no product import or RPC name remains.
7. Run the focused dispatcher/evidence tests and confirm GREEN.

**Focused verification:**

```bash
cd elixir
mix test \
  test/symphony_elixir/mobile_rpc/dispatcher_test.exs \
  test/symphony_elixir/mobile_rpc/methods/evidence_test.exs
```

## Task 4: Add generic task-scoped evidence in Dev10x Mobile

**Create:**

- `mobile/src/features/evidence/rpc-evidence.ts`
- `mobile/src/features/evidence/rpc-evidence.test.ts`
- `mobile/src/features/evidence/useTaskEvidence.ts`
- `mobile/src/features/evidence/useTaskEvidence.test.tsx`
- `mobile/src/features/evidence/TaskEvidenceRoute.tsx`
- `mobile/src/features/evidence/TaskEvidenceScreen.tsx`
- `mobile/src/features/evidence/TaskEvidenceScreen.test.tsx`
- `mobile/app/codex/issue/[projectSlug]/[identifier]/evidence/index.tsx`

**Modify:**

- `mobile/src/features/evidence/EvidenceArtifactRoute.tsx`
- `mobile/src/features/evidence/EvidenceArtifactScreen.tsx`
- `mobile/src/features/evidence/EvidenceArtifactScreen.test.tsx`
- `mobile/src/features/evidence/EvidenceGallery.tsx`
- `mobile/src/features/evidence/EvidenceGallery.test.tsx`
- `mobile/src/features/evidence/evidence-contract.ts`
- `mobile/src/features/evidence/evidence-contract.test.ts`
- `mobile/src/features/evidence/downloadEvidenceArtifact.ts`
- `mobile/src/features/tasks/IssueRoute.tsx`
- `mobile/src/features/tasks/IssueScreen.tsx`
- `mobile/src/features/tasks/IssueScreen.test.tsx`
- `mobile/app/codex/issue/[projectSlug]/[identifier]/evidence/[runId].tsx`

### Steps

1. Add RED contract tests for ordinary task evidence records, multiple
   attempts, execution path, requested/resolved provenance, and artifact
   counts.
2. Add RED RPC/hook tests for `evidence.list`, host/task-scoped query keys,
   refetch after task/evidence events, reconnect, cached/offline labeling, and
   cancellation.
3. Add RED screen tests for latest-run summary, all-attempt grouping, empty,
   loading, offline, error, and artifact states.
4. Implement a task-scoped evidence query using only
   `hostId/projectSlug/identifier`; do not import comparison types/hooks.
5. Add the Evidence summary and `Open evidence` action to ordinary task detail.
6. Refactor the gallery route to load the requested `runId` directly from the
   task's evidence list.
7. Route session records to rich chat and orchestrator records to their
   execution log; retain terminal and preview actions.
8. Preserve encrypted chunked downloads and host/task/run/content cache
   isolation.
9. Finish native video controls and image/report/trace handling with stable
   loading/error behavior.
10. Run only focused evidence/task tests.

## Task 5: Keep the mock server generic

**Modify:**

- `mobile/scripts/mock-server-rpc-handlers.ts`
- `mobile/scripts/mock-server-task-state.ts`
- `mobile/src/rpc/mock-server-rpc-handlers.test.ts`
- `mobile/e2e/mock-server-smoke.sh`

### Steps

1. Add RED tests for independent normal task creation, issue-session creation,
   orchestrator dispatch, logs, and task-scoped `evidence.list`.
2. Delete comparison parent/child/matrix handlers and fixtures.
3. Keep deterministic generic evidence artifacts for development and UI
   construction only.
4. Update the lightweight mock smoke flow to exercise one normal task without
   claiming official E2E evidence.
5. Run focused mock RPC tests.

## Task 6: Instrument the real six-task E2E outside product code

**Create:**

- `mobile/e2e/real-six-task-matrix.sh`
- `mobile/e2e/lib/android-ui.sh`
- `mobile/e2e/lib/six-task-report.sh`

**Modify:**

- `benchmarks/landing-page-agent-comparison/src/collect.mjs`
- `benchmarks/landing-page-agent-comparison/src/capture-visuals.mjs`
- `benchmarks/landing-page-agent-comparison/tests/collect.test.mjs`
- `mobile/e2e/android-smoke.sh`

### Steps

1. Add a focused harness test that rejects parent IDs, child relations, duplicate
   task IDs, missing logs, missing provenance, and missing evidence.
2. Extract reusable bounded Android UI helpers without changing product code.
3. Drive the app six times to create six ordinary top-level tasks with the same
   prompt and the requested agent/model/effort.
4. For Codex/Cursor/Claude session tasks, start issue sessions in rich chat and
   record the three real thread IDs.
5. For Codex/Cursor/Claude orchestrator tasks, use the visible dispatch action
   and record the three real execution IDs.
6. Wait with bounded polling and explicit failure diagnostics; never hide a
   failed/timed-out run or redispatch it silently.
7. Visit in the app, for each task: task detail, appropriate log, evidence,
   terminal, and preview.
8. Capture a continuous Android video plus task screenshots and a redacted UI
   interaction trace.
9. Write a local manifest and comparison report keyed by the six ordinary task
   IDs. Keep both outside product runtime/state.
10. Validate media codec/duration/frames and evidence links.

Do not run this real-provider matrix until focused implementation checks and
the targeted Android build pass.

## Task 7: Focused validation and PR #7 delivery

### Focused local validation

Run:

```bash
cd mobile
npx vitest run \
  src/features/tasks/CreateTaskScreen.test.tsx \
  src/features/tasks/IssueScreen.test.tsx \
  src/features/tasks/IssueRoute.test.tsx \
  src/features/evidence \
  src/rpc/mock-server-rpc-handlers.test.ts
```

Run:

```bash
cd elixir
mix test \
  test/symphony_elixir/mobile_rpc/dispatcher_test.exs \
  test/symphony_elixir/mobile_rpc/methods/evidence_test.exs
```

Run the targeted Android release build and directed six-task E2E only after the
focused tests pass. Do not run `make all` or the complete local unit suite in
WSL.

### Delivery updates

1. Replace stale comparison-parent media in the existing Gist.
2. Publish the continuous six-task app video and principal task/evidence/log
   screenshots.
3. Update PR #7 with the six independent task IDs, three session thread IDs,
   three orchestrator execution IDs, provenance, checks, evidence links,
   screenshots, video, recovery notes, and external final comparison.
4. Remove language that presents comparison as product functionality.
5. Confirm PR checks are green and the branch is mergeable.
