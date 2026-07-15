# Split agent / model / effort fields + reuse on session & workspace create

**Date:** 2026-07-14  
**Scope:** Tracker Summary (issue detail), `StartIssueSessionDialog`, `NewStandaloneWorkspaceDialog`; shared field wrappers over composer menus; Elixir thread create persistence for mode/model/effort  
**Status:** Implemented  
**Supersedes:** earlier draft in this file that only covered agent chips + execution mode on Novo workspace (option B)

## Problem

1. **Issue detail Summary** exposes agent / model / effort as a single “EXECUÇÃO” control (`InlineExecutionSettingsEditor`) that opens a popover with all three menus. Operators want **three separate fields**, matching the composer’s separate agent / model / effort controls.
2. **Issue session create** uses `AgentChip` + `ExecutionModeMenu` but not model/effort.
3. **Standalone workspace create** already creates a `project_session` thread in the same API call, but the dialog has no agent / model / effort / mode UI (API accepts `agent_kind` only; no `execution_mode` / model / effort).

Composer already owns reusable menus (`AgentMenu`, `ModelMenu`, `EffortMenu`) and `ExecutionSettingsPicker` composes them. Summary and create dialogs should reuse those primitives instead of chips or a nested popover.

## Goals

- Summary: replace the single EXECUÇÃO field with **three `Field`s** — Agente, Model, Effort — each with its own menu.
- Extract thin reusable field wrappers around composer menus so Summary, issue-session create, and workspace create share the same controls.
- Issue-session create and workspace create: **agent + model + effort + execution mode**.
- Persist create-time choices on the session thread so the composer can hydrate.
- Keep per-field **inherit** (`null`) on Summary (existing issue settings behavior).

## Non-goals

- Sidebar new-session flow.
- Changing Issue Create / Settings / Project agent pickers beyond making `ExecutionSettingsPicker` compose the new wrappers (behavior stays).
- Mid-run model/effort changes beyond what composer already does.
- Working-tree / branch UI (separate work).
- Reintroducing `AgentChip` rows on create dialogs.

## Decisions

| Topic | Choice |
|-------|--------|
| Approach | **A** — typed field wrappers over composer menus |
| Summary layout | Three separate `Field`s (Agente / Model / Effort); remove EXECUÇÃO popover |
| Create dialogs | Agent + model + effort + `ExecutionModeMenu` |
| Workspace create | Same four controls (workspace create = new session) |
| Leaf widgets | `AgentMenu`, `ModelMenu`, `EffortMenu` / `DerivedThinkingMenu`, `ExecutionModeMenu` |
| Chips | Not used on these surfaces |
| Summary inherit | Keep `allowInherit` / `null` per field |
| Create defaults | Agent: issue agent or `codex`; mode: `build`; model/effort: catalog defaults for selected agent |
| Agent persistence | Thread `agent_kind` |
| Mode / model / effort persistence | Thread `metadata["execution_mode" \| "model" \| "effort"]` at create |

## Architecture

### Shared field components

**Paths:** `tracker/src/components/assistant/` next to existing menus (`AgentMenu`, `ModelMenu`, …).

| Component | Wraps | Notes |
|-----------|--------|------|
| `AgentSettingsField` | `AgentMenu` | Props: bundle, agent, onChange, disabled, allowInherit?, inheritLabel? |
| `ModelSettingsField` | `ModelMenu` or inheritable variant | Depends on catalog for resolved agent |
| `EffortSettingsField` | `EffortMenu` / `DerivedThinkingMenu` | Same effort rules as `ExecutionSettingsPicker` |
| `ExecutionModeField` | `ExecutionModeMenu` | Create dialogs only |

Optional thin layout helpers may wrap with a label for create dialogs; Summary uses existing `Field` for labels.

**`ExecutionSettingsPicker`:** refactor to render the three settings fields (non-compact path). Compact chip mode can remain for surfaces that still want one chip (if any); Summary no longer uses it via `InlineExecutionSettingsEditor`.

**Catalog:** parents that need model/effort load `fetchAssistantCatalogBundle(projectSlug)` (Summary can load on mount or when fields mount; Create dialogs load when open).

### Summary (issue detail)

- In `SummaryTab`, replace the single `Field` + `InlineExecutionSettingsEditor` with three `Field`s.
- Each field commits through the existing `onSaveExecutionSettings({ agent, model, effort })` path (partial updates: change one field, send full triple with unchanged siblings).
- Remove or deprecate `InlineExecutionSettingsEditor` once unused.
- Labels: reuse / add i18n keys for Agente, Model, Effort (pt-BR / en), not a single “EXECUÇÃO” label for the group.

### `StartIssueSessionDialog`

- Remove `AgentChip` row.
- Add `AgentSettingsField` + `ModelSettingsField` + `EffortSettingsField` + `ExecutionModeField` (or labeled `ExecutionModeMenu`).
- Keep title, working-tree radios, branches, instructions as today.
- Create payload: existing `agentKind` / `executionMode` plus `model` / `effort`.

### `NewStandaloneWorkspaceDialog`

- After name (before branches): same four controls as session create (no Summary-style inherit required — concrete agent).
- Pass `agentKind`, `model`, `effort`, `executionMode` to `createStandaloneWorkspace`.

### API / backend

**Issue session create** (`assistant/threads` / `createIssueSession`):

- Accept and forward `model`, `effort` (and existing `execution_mode`).
- `History.create_issue_session_thread/3`: write `metadata["model"]`, `metadata["effort"]` alongside existing `execution_mode`.

**Workspace create** (`POST .../workspaces`):

- Accept `agent_kind`, `execution_mode`, `model`, `effort`.
- `History.create_workspace_session_thread/3`: set `agent_kind`; merge mode/model/effort into metadata (same normalization helpers as issue session).

**Hydration:** session shell / composer for `issue_session` and `project_session` reads thread `agent_kind` + metadata mode/model/effort into `settingsSeed` / mode state (wire if not already present).

### Testing

- Summary: three fields render; changing agent/model/effort calls save with expected payload; inherit still works.
- Shared fields: unit tests for callbacks / disabled (targeted).
- Start session + Novo workspace: create requests include agent, mode, model, effort.
- Elixir: create issue session and workspace persist metadata keys; agent_kind on thread.

## File map (expected)

| File | Change |
|------|--------|
| New `AgentSettingsField` / `ModelSettingsField` / `EffortSettingsField` (+ optional `ExecutionModeField`) | Extract wrappers |
| `ExecutionSettingsPicker.tsx` | Compose wrappers |
| `SummaryTab.tsx` | Three Fields; drop popover editor |
| `InlineExecutionSettingsEditor.tsx` | Remove or leave unused → delete if unused |
| `StartIssueSessionDialog.tsx` | Menus instead of chips; model/effort |
| `NewStandaloneWorkspaceDialog.tsx` | Four controls + API args |
| `createIssueSession.ts` / `assistantThreads.ts` / `worktrees.ts` | Payload fields |
| `history.ex` + worktree / threads controllers | Persist metadata |
| Composer / session panel hydrate | Seed from thread metadata |
| Locales en + pt-BR | Field labels |
| Targeted tests | As above |

## Risks

- **Hydration gap:** if composer ignores thread metadata model/effort, create-time picks won’t stick until first turn — must wire seed path.
- **Partial save races** on Summary if three fields save independently quickly — send full triple each time (current editor pattern).
- **Catalog load latency** on Summary — show loading/disabled menus briefly, same as popover did on open (prefer load once when Summary mounts).

## Open follow-ups (out of scope)

- Apply the same three Fields to Issue Create if product wants parity with Summary layout (Create already uses non-compact `ExecutionSettingsPicker`).
- Sidebar new session.
