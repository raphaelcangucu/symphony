# Assistant Channel Baseline Stabilization Plan

**Goal:** Make Assistant Channel tests deterministic under the current opt-in native Goal contract and asynchronous channel execution.

## Task 1: Isolate native Goal configuration

- [x] Configure Goal-enabled tests with the repository's fake Codex app server.
- [x] Add explicit Goal enablement only to scenarios that activate or dispatch a goal.
- [x] Preserve coverage for disabled/default goal metadata.

## Task 2: Model resumable native Goal state

- [x] Give direct `goal_resume` fixtures a persisted native Codex thread id.
- [x] Keep the exact-thread assertions for issue-session and non-issue scopes.

## Task 3: Remove timing flakes

- [x] Give database-backed asynchronous dispatch/reply assertions bounded timeouts.
- [x] Let observer sockets receive durable turn streams while the originating socket owns the worker.
- [x] Publish native Goal updates immediately without losing them to an early authoritative lookup.
- [x] Re-run each previously failing non-Goal case in isolation.

## Task 4: Verify and commit

- [x] Run the complete Assistant Channel test file (`72 tests, 0 failures`).
- [x] Review the diff and commit the focused stabilization.
