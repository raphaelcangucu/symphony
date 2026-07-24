# Focused Test Isolation Plan

**Goal:** Eliminate cross-test state, process, cache, timing, and filesystem interference exposed by earlier suite runs, validating one test file or narrow test filter at a time under WSL.

**WSL constraint:** Never run the complete suite, a test directory, or a large multi-file batch. The user confirmed that broad test runs can exhaust and crash WSL.

## Task 1: Isolate global configuration and caches

- [x] Run the backup Mix task from a temporary cwd with an isolated database env.
- [x] Clear the project-index hotpath cache around controller tests.
- [x] Reset tracker state before JIRA attachment fixtures.

## Task 2: Isolate long-lived dev-server state

- [x] Terminate dynamic dev-server instances before Manager tests.
- [x] Apply the same cleanup to preview-runner Manager tests.
- [x] Keep the reservation table reset after process cleanup.

## Task 3: Remove load-sensitive fixtures

- [x] Allow scheduler delay when asserting retry due times.
- [x] Give Goal resume assertions enough time under the full suite load.
- [x] Give each Inventory workspace its own bare Git origin.
- [x] Preserve interruption broadcast ordering before caller completion notification.

## Task 4: Verify and commit

- [x] Run the previously failing focused files before the WSL constraint was clarified (`175 tests, 0 failures`).
- [x] Re-run the four failures from the interrupted broad run one test at a time.
- [x] Disable the initial orchestrator poll in the transition unit test to remove its startup race.
- [x] Give the asynchronous document-change assertion an explicit timeout.
- [x] Record the permanent WSL test-safety rule in `elixir/AGENTS.md`.
- [x] Review and commit the isolation fixes.
