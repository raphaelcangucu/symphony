# Unit Lifecycle Baseline Plan

**Goal:** Restore the remaining focused AppServer, Codex Goal, TurnManager, and dashboard lifecycle contracts.

## Task 1: Repair fake app-server lifecycles

- [x] Account for the mandatory `initialized` notification in the approval-required fixture.
- [x] Keep the Goal fake alive through the authoritative terminal state.

## Task 2: Preserve interruption completion notifications

- [x] Notify the originating caller when an explicit interruption removes the live turn before its worker can finish.
- [x] Keep the interrupted durable state and active-tool cleanup unchanged.

## Task 3: Follow the current supervisor topology

- [x] Stop and restart `Orchestrator.RunnerSupervisor` in the dashboard isolation test.

## Task 4: Verify and commit

- [x] Run the four focused test files together (`110 tests, 0 failures`).
- [x] Review and commit the focused changes.
