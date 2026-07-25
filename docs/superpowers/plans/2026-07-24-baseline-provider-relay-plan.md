# Provider Relay Baseline Plan

**Goal:** Preserve provider-native tool identity and Goal updates across Agent Session relays.

## Task 1: Normalize nested Claude/Cursor tool items

- [x] Read tool id, name, input, result content, and error state from `params.item`.
- [x] Keep started/completed events on the same provider id so the timeline merges them.
- [x] Preserve existing flat Codex event handling.

## Task 2: Isolate the Codex Goal relay workspace

- [x] Configure the Goal relay test's temporary workspace as the active workflow root.
- [x] Restore the previous workflow path during teardown.

## Task 3: Verify and commit

- [x] Run Claude and Goal relay tests together (`9 tests, 0 failures`).
- [x] Review and commit the focused changes.
