# Execution mode mid-run + approval agent label

**Date:** 2026-07-11  
**Scope:** Tracker assistant composer (workspace/issue chat) and issue execution composer  
**Status:** Approved for planning

## Problem

1. The Build / YOLO / Plan menu is disabled while a turn is running (`disabled={isRunning || catalogLoading}` in `ProjectAssistantPanel`, and `controlsDisabled || agentRunActive` in `ExecutionControlComposer`). Operators cannot switch to YOLO when a command-approval card is open.
2. The command-approval title string uses `{{agent}}`, but `CommandApprovalCard` (and the context-chip label helper) call `t(...)` without an `agent` interpolation value, so the UI shows the literal `{{agent}}`.

## Goals

- Allow changing execution mode while a turn is running.
- When switching **to YOLO** mid-run: apply YOLO approval behavior for the **current** turn (auto-approve pending + future approvals while mode stays YOLO).
- Ensure the **next** `send_message` / dispatch uses the selected `execution_mode` (already wired via `executionModeRef` / composer mode state).
- Show the real agent name in the approval card title (and matching context chip label).

## Non-goals

- Mid-run sandbox elevation/restriction (Codex/Claude sandbox and Claude `--force` / permission mode are fixed at turn start). Full YOLO sandbox (`danger-full-access`) applies on the **next** turn after switching to YOLO.
- Live backend reconfiguration of the coding-agent session (`set_execution_mode` channel event).
- Changing agent selection mid-run (agent menu can stay locked while running).

## Approach

**Client-side mode unlock + YOLO auto-approval** (no new Phoenix channel events).

### Execution mode menu

- `ProjectAssistantPanel`: `ExecutionModeMenu` `disabled` becomes `catalogLoading` only (remove `isRunning`).
- `ExecutionControlComposer`: allow mode changes while `agentRunActive` (keep other control disables as today). Mode state already feeds resume/dispatch payloads.

### Mid-run YOLO behavior

Maintain the selected mode in existing React state / refs.

When the operator selects **YOLO** while a turn is running:

1. If there is a `pendingApproval`, immediately `submit_approval` with `action: "approve"` for that request and clear the card on success.
2. While `executionMode === "yolo"` and a turn is running, incoming `approval_required` events are auto-approved via the same channel push **without** rendering the approval card.

When the operator selects **build** or **plan** while a turn is running:

- Stop auto-approving. Subsequent `approval_required` events show the card again.
- Do not attempt to tighten sandbox mid-turn; plan/build restrictions for write/network apply on the next turn.

### Next turn

No new wiring required for message sends: `dispatchSend` already includes `execution_mode: executionModeRef.current` when executable context is present. Keep `executionModeRef` in sync on every `onChange` (already done).

Issue execution composer continues to pass the selected mode on resume/dispatch as today.

### Approval agent label

- In `CommandApprovalCard`, call:
  `t("assistant.panel.commandApproval.title", { agent: agentDisplayName(request.agent) })`.
- In `contextRefForApprovalRequest`, pass the same interpolation so the chip label matches.
- `agentDisplayName` already maps `claude` → `Claude`, `cursor` → `Cursor`, else `Codex`.

## Error handling

- If auto-approve `submit_approval` fails (e.g. request already gone), clear local pending state for that id and surface the existing channel error path if one is already used for manual approve; do not leave a stuck card for a request the server no longer has.
- Mode UI stays enabled even if auto-approve fails; operator can still Approve/Cancel manually if a card is shown after falling back.

## Testing

- Unit/UI: mode menu enabled while `isRunning` / `agentRunActive`.
- Unit/UI: switching to YOLO with a pending approval triggers `submit_approval` approve and removes the card.
- Unit/UI: while mode is YOLO and running, `approval_required` does not render the card and pushes approve.
- Unit/UI: switching back to Build while running shows the next approval card.
- Unit/UI: approval title renders `Codex wants to run a command` / `Claude wants to run a command` (existing expectations in `ProjectAssistantPanel.test.tsx`).
- Unit/UI: context chip label also interpolates the agent name.

## Out of scope follow-ups

- Persisting mid-run mode changes onto thread metadata via a dedicated channel event.
- Auto-steering or restarting the live agent session to apply sandbox YOLO immediately.
