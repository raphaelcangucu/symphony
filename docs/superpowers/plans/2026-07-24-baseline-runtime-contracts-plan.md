# Baseline Runtime Contracts Stabilization Plan

**Goal:** Resolve the remaining isolated workspace, knowledge-base, dev-server, and public-routing failures whose root causes have been reproduced.

**Approach:** Keep current production behavior where tests describe superseded contracts, repair incomplete fixtures where setup no longer reaches the behavior under test, and fix the public-host range validation regression in production.

## Task 1: Align workspace inventory consumers

- [x] Update the streaming inventory test to include the project segment root and the issue workspace.
- [x] Update the display-name controller test to accept an existing empty project root emitted by inventory.
- [x] Run both focused test files.

## Task 2: Align knowledge-base branch behavior

- [x] Update `GitFlow.sync_branch/2` coverage to assert synchronization of the checkout's current branch.
- [x] Run the focused Git flow tests.

## Task 3: Stabilize dev-server lifecycle coverage

- [x] Expect stale persisted `ready` records without a live instance to reconcile to `crashed`.
- [x] Create the configured `front` working directory before testing crashed-instance replacement.
- [x] Run the focused dev-server facade and manager tests.

## Task 4: Restore public-host port validation

- [x] Make registered hosts proxy only when their port is within the configured dev-server range.
- [x] Preserve disabled-tunnel pass-through and enabled-tunnel namespace routing.
- [x] Run the focused public-host plug tests.

## Task 5: Verify and commit

- [x] Run all focused files together (`95 tests, 0 failures`).
- [x] Review the diff for unrelated changes.
- [x] Commit the stabilization as one scoped change.
