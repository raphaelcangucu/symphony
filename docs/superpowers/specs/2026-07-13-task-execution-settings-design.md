# Per-task execution settings (agent / model / reasoning effort)

**Date:** 2026-07-13  
**Scope:** Tracker issue create/summary, user + project settings, execution composer; Elixir orchestrator resolve path and `issue_agent_settings`  
**Status:** Approved for planning

## Problem

Operators can pick agent on a task (Summary / create) and pick agent / model / reasoning effort in the execution composer, but those surfaces are not a shared source of truth for the orchestrator:

- Model and reasoning effort are only written on dispatch into `issue_agent_settings`; they are not editable on create/summary.
- The execution composer seeds from browser `sessionStorage`, not from persisted task settings, so auto-dispatch and manual dispatch can drift.
- Agent is primarily driven by `symphony:<kind>` labels, while `issue_agent_settings.agent_kind` is written on dispatch but not used as the primary resolve signal.
- User Settings expose a default agent (and model pins that are largely UI-only); Project defaults for model/effort are incomplete relative to the resolve chain the orchestrator needs.
- Composer already has reusable agent/model/effort menus (`ComposerToolbar` / `ModelMenu`), but Create, Summary, and Settings do not reuse them.

## Goals

- On **Create** and **Summary**, choose **agent**, **model**, and **reasoning effort** for that task, using the same picker UX as the composer.
- Persist those values so the **orchestrator** uses them on autonomous runs.
- **Inherit per field:** each of agent / model / effort may be unset independently.
- Expose the same picker for **defaults** in **User Settings** and **Project Settings**.
- **Shared source of truth** between Summary and Execution composer (hydrate + persist the same store).
- Make `issue_agent_settings` the primary store for agent/model/effort; keep `symphony:*` labels as **mirror + fallback**.

## Non-goals

- Execution mode (`plan` / `build` / `yolo`) in Create/Summary/Settings — remains composer/dispatch-only.
- First-class remote tracker columns for model/effort (GitHub/Jira/Linear native fields).
- Encoding model/effort as labels.
- Changing coding-agent sandbox mid-run.

## Decisions

| Topic | Choice |
|-------|--------|
| UI surfaces | Create + Summary (+ Settings defaults + Execution composer) |
| Inherit | Per field (nullable independently) |
| Defaults | User Settings **and** Project Settings |
| Composer relationship | Shared source of truth with task settings |
| Persistence approach | Extend existing `issue_agent_settings` |
| Agent primary store | `issue_agent_settings.agent_kind` |
| Labels | Write-through mirror; read fallback when settings agent is empty |

## Architecture

### Persistence

**Task (source of truth):** `local_tracker_issue_agent_settings` keyed by `project_slug` + `identifier`:

| Field | Meaning |
|-------|---------|
| `agent_kind` | Pinned agent, or `null` = inherit |
| `model` | Pinned model, or `null` = inherit |
| `effort` | Pinned reasoning effort, or `null` = inherit |
| `mode` | Unchanged; still dispatch/composer-only for this feature |

**Label mirror:** On write of `agent_kind`:

- Non-null → upsert/sync `symphony:<kind>` (and clear other agent kind labels as today).
- `null` (inherit) → remove agent-kind labels when previously mirrored from settings.

**Label fallback:** If `agent_kind` in settings is empty, resolve from existing `symphony:*` label (legacy issues). Optional backfill into settings on read/write paths.

**User defaults:** Extend Settings.Agents (and related AgentModels) so the operator sets default agent + model/effort (per agent where catalogs differ). These feed the resolve chain when task/project leave a field unset.

**Project defaults:** Project config / workflow (or project settings API) stores default agent + model/effort for the project.

### Resolution (orchestrator)

Fields resolve **independently**.

**Agent:**

1. `issue_agent_settings.agent_kind`
2. Label `symphony:*` (fallback)
3. Project default agent
4. User default agent
5. `"codex"`

**Model / effort:**

1. `issue_agent_settings.model` / `.effort`
2. Project defaults
3. User defaults
4. CLI / catalog default (omit adapter opts so the agent CLI picks)

`AgentRunner.merge_agent_settings_opts/2` (and `issue_agent_kind/1`) must implement this chain. User/project model defaults leave the “Settings UI only” gap and enter the run path.

### API

- **Create issue:** optional `agent`, `model`, `effort` → write settings (+ mirror agent label).
- **GET issue:** expose pinned `agent` / `model` / `effort` (null = inherit) and optionally effective resolved values for display.
- **PATCH issue / dedicated settings PATCH:** write `issue_agent_settings`; omitted fields unchanged; explicit `null` clears to inherit.
- **User settings + project settings:** read/write default agent/model/effort.
- **Dispatch:** continues to accept agent/model/effort but reads/writes the same store (no separate composer-only persistence story).

Validation: fail fast on invalid agent/model/effort with clear errors.

### Label sync failure

Settings write succeeds first. Label mirror is best-effort on remote trackers; on failure, log and keep the settings pin (do not roll back).

## UI

### Shared component

Extract a controlled picker from the composer toolbar (recommended name: `ExecutionSettingsPicker`, or export `ComposerToolbar` + `AgentMenu` / `EffortMenu` alongside existing `ModelMenu`):

- Props: `agent`, `model`, `effort` (nullable where inherit is allowed), catalog `bundle`, change callbacks.
- `allowInherit` for Create/Summary/task; Settings uses explicit defaults (or clear → unset), not task-style “Inherit from project”.
- Same menus as composer: Agent, Model, Effort / DerivedThinking for models without explicit efforts.

### Surfaces

| Surface | Behavior |
|---------|----------|
| **Create issue** | Picker with inherit; omitted fields not sent / stored as null |
| **Summary** | Replaces `InlineAgentEditor`; save via same settings write path (inline-editor UX) |
| **User Settings** | Same picker for personal defaults |
| **Project Settings** | Same picker for project defaults |
| **Execution composer** | Seed from `issue_agent_settings`; changes persist to that store (shared SoT). Execution mode menu stays local to composer |

When agent changes, re-normalize model/effort against the new agent catalog (same behavior as `AssistantComposer` today).

Catalog loading: reuse assistant catalog fetch/cache; disable or fall back to cached catalog when offline.

## Error handling

- Backend validates agent/model/effort; reject unknown values.
- Partial PATCH: omitted ≠ clear; `null` = inherit.
- Summary save failure: keep draft + error feedback (existing inline editor pattern).
- Remote label mirror failure: settings remain authoritative.

## Testing

**Elixir (targeted files/cases):**

- Resolve chain for agent (settings → label → project → user).
- Resolve chain for model/effort (settings → project → user → omit).
- Write path mirrors label; inherit clears mirror.
- `AgentRunner` merges opts from settings + defaults.

**Tracker (targeted files/cases):**

- Picker inherit vs settings mode.
- Create payload includes optional agent/model/effort.
- Summary save hits settings API.
- Execution composer hydrates from settings and persists changes.

**WSL:** run one narrowly targeted test file or filter at a time.

## Out of scope follow-ups (explicit)

- Surfacing execution mode on Summary/Settings.
- Automatic migration job to backfill all legacy label-only issues into settings (optional backfill on touch is enough for v1).
- Making remote trackers own model/effort as native fields.
