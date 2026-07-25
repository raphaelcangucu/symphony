# Agent Session Workspace Baseline Plan

**Goal:** Restore deterministic Agent Session coverage under fail-closed workspace ownership.

## Task 1: Keep file-change fixtures in the configured root

- [x] Configure the file-change test workflow to use its temporary workspace root.
- [x] Restore the previous workflow path during teardown.
- [x] Verify targeted diff capture and escape rejection both reach the relay.

## Task 2: Align structured symlink errors

- [x] Assert the explicit workspace symlink escape tuple and paths.
- [x] Verify the runner is never invoked after the revalidation failure.

## Task 3: Verify and commit

- [x] Run both focused test files (`36 tests, 0 failures`).
- [x] Review and commit the focused changes.
