# GitHub Project Status Source Design

**Status:** Draft  
**Date:** 2026-05-28  
**Scope:** Remove the custom GitHub `Symphony State` field and make the GitHub Project board `Status` field the only workflow state source.

---

## 1. Problem

The GitHub adapter currently treats a custom `Symphony State` single-select field as the authoritative issue state and optionally syncs the built-in GitHub Project `Status` field. Macro Markets now has the same workflow states in both fields, which creates two sources of truth.

This caused a real rework miss: the visible board `Status` was moved to `Rework`, but `Symphony State` stayed on `Human Review`, so Symphony continued to treat the issue as waiting instead of dispatching the rework flow.

---

## 2. Goal

Make the GitHub Project `Status` field the single source of truth for GitHub workflow control:

1. Poll issues by the Project `Status` field.
2. Move issues by updating only the Project `Status` field.
3. Remove `Symphony State` creation, fallback, sync, and documentation as a runtime concept.
4. Update Macro Markets workflow config to use only board statuses.
5. Document the recommended GitHub Project status setup in the GitHub Projects skill.
6. Add configurable status transitions after a normal agent execution completes.

---

## 3. Non-goals

- Migrating historical GitHub Project item values out of `Symphony State`; the field can remain on GitHub temporarily but Symphony should ignore it.
- Changing local, Linear, or memory tracker storage semantics beyond shared completion-transition config if needed.
- Redesigning the Macro Markets workflow states.
- Making failed agent runs advance workflow state.

---

## 4. Workflow Contract

GitHub workflows should rely on the board's `Status` single-select field. The recommended options are:

1. `Backlog`
2. `Todo`
3. `In Progress`
4. `Human Review`
5. `Rework`
6. `Merging`
7. `Done`
8. `Cancelled`
9. `Duplicate`

Macro Markets should remove `status_field: Symphony State`, `native_status_field`, and `sync_native_status` from `WORKFLOW.macromarkets.example.md`. The workflow should keep `tracker.field_states`, `tracker.active_states`, `tracker.wait_states`, and `tracker.terminal_states` as the declarative list of valid board statuses.

---

## 5. GitHub Adapter Design

The adapter should resolve the GitHub Project `Status` field during bootstrap for both `project.mode: existing` and `project.mode: auto`.

For existing projects:

- Read the project by ID.
- Resolve `field(name: "Status")` as a single-select field.
- Cache its field ID and option IDs as the only state metadata.
- Fail fast if `Status` is missing or is not a single-select field.

For auto-created projects:

- Create or load the GitHub Project.
- Resolve its built-in `Status` field.
- Attempt to reconcile required options from `tracker.field_states`.
- If GitHub rejects native `Status` option changes, fail with a clear setup message listing the missing statuses and pointing to the GitHub Projects skill instructions.

Polling should extract only the `Status` field value. It should not fall back to `Symphony State` because fallback would preserve the same split-brain failure mode.

State updates should send one `updateProjectV2ItemFieldValue` mutation against the cached `Status` field. The code path that updates both custom and native fields should be removed.

---

## 6. Setup Guidance

Update `.codex/skills/github-projects/SKILL.md` with a Symphony Project setup section:

- The board must have a single-select `Status` field with the recommended options.
- Humans should move cards by changing `Status`; no separate Symphony-specific state field is needed.
- Include GraphQL snippets or `gh` commands to inspect fields and options.
- Include an explicit checklist for adding missing statuses before starting Symphony.
- Mention that Symphony will validate the board at startup and report exact missing options when setup is incomplete.

---

## 7. Completion Transitions

Add a configurable map that lets workflows control status changes after a normal agent execution completes.

Example:

```yaml
agent:
  completion_transitions:
    Todo: Human Review
    In Progress: Human Review
    Rework: Human Review
    Merging: Done
```

Behavior:

1. The transition runs only after an agent process exits normally.
2. The orchestrator refreshes the issue state before applying a transition.
3. If the current state is present in `agent.completion_transitions`, Symphony updates the issue to the configured destination.
4. If the current state is missing from the map, Symphony leaves the state unchanged and uses the existing continuation/retry behavior.
5. Failed or crashed agent runs never trigger completion transitions.
6. Invalid transition config should fail fast during workflow validation with a clear message.

For Macro Markets, the expected map is:

- `Todo` -> `Human Review`
- `In Progress` -> `Human Review`
- `Rework` -> `Human Review`
- `Merging` -> `Done`

---

## 8. Error Handling

- Missing `Status` field: fail startup with instructions to create/configure the Project `Status` field.
- Missing required status option: attempt setup when possible; otherwise fail with the missing option names.
- Unknown completion-transition source or destination: fail workflow validation and list valid states.
- GitHub mutation failure while applying a completion transition: log the error and leave the issue claim retryable instead of silently dropping the workflow update.

---

## 9. Testing

Add focused tests for:

1. Existing-project bootstrap caches `Status` metadata and no longer requires `Symphony State`.
2. Auto-bootstrap resolves `Status` and reports missing/uneditable options clearly.
3. Polling ignores `Symphony State` and uses only `Status`.
4. `update_issue_state` mutates only the `Status` field.
5. Macro Markets workflow parsing accepts the new config and no longer references `Symphony State`.
6. Completion transitions update state after normal agent completion.
7. Completion transitions do not run after failed agent exits.
8. Invalid completion-transition maps fail validation.

Run targeted Elixir tests while iterating, then the relevant repo gates before handoff.

---

## 10. Self-review

- No placeholders remain.
- The design removes `Symphony State` as a runtime concept instead of adding another fallback.
- Macro Markets setup and code behavior point to the same single source of truth: GitHub Project `Status`.
- The API limitation around native `Status` option mutation is handled by setup attempts plus explicit errors.
- Completion transitions are configurable and only run after normal agent completion.
