# Claude Goal + Unified `goal` Tool — Design

**Date:** 2026-07-10  
**Status:** Approved for planning  
**Scope:** Authoring + execution goal support for Claude Code (native `/goal`), rename `manage_codex_goal` → `goal`, agent-neutral facade.

## Problem

Symphony already integrates Codex native goals (`thread/goal/*`) via `manage_codex_goal`, `GoalControl`, and authoring GoalPill. Claude and Cursor were treated as having no native goal primitive, so long-running work was injected as prompt “workflow guidance” (`agent_goal`) with UI `kind: "workflow"` and capabilities `["view"]`.

Claude Code v2.1.139+ ships a first-class `/goal` command: a session-scoped completion condition evaluated after each turn by a small fast model (Stop-hook wrapper). Cursor still has no native Goal Mode (staff: no ETA). Symphony should use Claude’s native primitive for both authoring and execution, and expose one assistant tool name for Codex and Claude.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Surfaces | **B** — execution **and** authoring |
| Claude integration | **C** — hybrid: inject `/goal` / `/goal clear` on the next CLI turn; Symphony mirrors state; does **not** reimplement the Haiku evaluator |
| Unsupported actions | **A** — unified tool surface; Claude `pause` / `resume` / `set_budget` → `unsupported_for_agent`; UI hides those controls |
| Code shape | **1** — `AgentGoal` facade + `Codex.GoalControl` / `Claude.GoalControl` adapters |
| Tool rename | Cutover clean: `manage_codex_goal` → `goal` (no long-lived alias) |
| Cursor | Remains prompt-only workflow; `goal` mutations return `unsupported_for_agent` |

## Non-goals

- Cursor native Goal Mode
- Claude dynamic workflows / `ultracode` orchestration
- Reimplementing Claude’s goal evaluator inside Symphony
- Changing Codex `thread/goal/*` semantics

## Architecture

```text
assistant tool: goal
        │
        ▼
   AgentGoal (facade)
        │
   ┌────┼────────────────┐
   ▼    ▼                ▼
Codex  Claude.GoalControl  Cursor → unsupported
GoalControl /              (mirror + pending
AuthoringGoalControl        /goal inject)
   │                         │
thread/goal/*         .symphony/claude-goal.json
                      + next-turn prompt prefix
                      → claude --print [--resume]
```

### New / changed modules

| Module | Role |
|--------|------|
| `SymphonyElixir.AgentGoal` | Resolve agent + `context` (`authoring` \| `execution`); dispatch actions; map `unsupported_for_agent` |
| `SymphonyElixir.Claude.GoalControl` | Local mirror + `pending_command` (`set` \| `clear` \| nil); get/set_objective/clear |
| `SymphonyElixir.Assistant.GoalTools` | Tool name `goal`; agent-neutral description; calls `AgentGoal` |
| `Claude.CodingAgent` / `CliRunner` | When pending command exists, prefix prompt file with `/goal <objective>` or `/goal clear`, then clear pending |
| `AuthoringGoalControl` | Stop hard-rejecting non-Codex; route Claude through `AgentGoal` / `Claude.GoalControl` |
| `IssueDispatch` / `AgentRunner` | Claude + goal → `Claude.GoalControl.set_objective` (not only `agent_goal` column) |
| `AgentExecution` | Active Claude mirror → `kind: "goal"`, capabilities `["get","edit","clear"]` (no pause/resume/budget) |
| Tracker UI | Enable authoring GoalPill / `/goal` for Claude; hide unsupported controls |

## Data model — Claude mirror

Workspace-scoped sidecars (fixed for v1):

- Execution: `.symphony/claude-goal.json`
- Authoring: `.symphony/claude-goal-authoring.json`

Separate files so authoring and execution never clobber each other (same pattern as Codex session role split).

Fields:

```json
{
  "status": "active | cleared | achieved",
  "objective": "string ≤ 4000 chars",
  "pending_command": "set | clear | null",
  "updated_at": "iso8601",
  "cli_session_id": "optional string"
}
```

- `set_objective`: write `status: active`, `objective`, `pending_command: set` (replace replaces objective and re-queues `set`).
- `clear`: `pending_command: clear`; after inject succeeds, `status: cleared`, objective cleared.
- `get`: read mirror; no CLI round-trip required.
- Optional: keep `issue.agent_goal` as a read mirror for Claude during transition; UI should prefer the sidecar.

## Data flow

### Execution

1. Operator or `goal` tool calls `set_objective` with a verifiable condition (≤ 4000 characters).
2. `AgentGoal` → `Claude.GoalControl.set_objective` updates mirror + `pending_command: set`.
3. Next `Claude.CodingAgent.run_turn` reads pending, prefixes the prompt file with `/goal <objective>`, clears pending.
4. Claude Code registers its session Stop-hook evaluator; Symphony does not re-check the condition.
5. Later turns use `--resume <cli_session_id>`. If mirror is still `active` and pending is nil, do **not** re-inject `/goal`.
6. `clear` queues `pending_command: clear` → next turn prefixes `/goal clear` → mirror `cleared`.
7. If `--resume` fails (`resume_session_not_found`), start a fresh session id and, if mirror is still `active`, re-queue `pending_command: set` so the condition is restored (aligned with Claude docs: condition carries on resume; Symphony must re-apply when the CLI session is lost).
8. `achieved`: best-effort if transcript/events expose a signal; otherwise mirror stays `active` until explicit clear or replace. No pause/resume/token budget.

### Authoring

Same mirror mechanics scoped to the authoring role. `set_goal_mode`, GoalPill, and `goal` with `context: authoring` go through `AuthoringGoalControl` → `AgentGoal` → Claude path. Continuation stays in the assistant runner (does **not** dispatch the orchestrator). Codex authoring path unchanged underneath.

### Codex

Unchanged: `thread/goal/*` via existing `GoalControl` / `AuthoringGoalControl` / `CodingAgent.manage_goal`. Only tool name and facade routing change.

## Tool contract — `goal`

**Rename:** `manage_codex_goal` → `goal` (clean cutover; update DynamicTool, ToolExecutor lists, agent prompts, tests).

| Action | Codex | Claude | Cursor |
|--------|-------|--------|--------|
| `get` | native | mirror | workflow view / nil |
| `set_objective` | `thread/goal/set` | mirror + pending `/goal` | `unsupported_for_agent` |
| `clear` | `thread/goal/clear` | pending `/goal clear` | `unsupported_for_agent` |
| `pause` | native | `unsupported_for_agent` | `unsupported_for_agent` |
| `resume` | native | `unsupported_for_agent` | `unsupported_for_agent` |
| `set_budget` | native (execution only) | `unsupported_for_agent` | `unsupported_for_agent` |

Params: `action`, `identifier?`, `context` (`authoring` \| `execution`), `objective?`, `token_budget?`.

Defaults: issue-bound chat → `context: authoring`; project chat → `context: execution` (same as today).

## UI

- Authoring GoalPill and `/goal` slash: enabled for **Codex and Claude** (remove Codex-only gates).
- Execution GoalPill: Claude with active mirror → `kind: "goal"`, `source: "native"` or `"claude"`, capabilities `get` / `edit` / `clear`; hide pause / resume / budget.
- Issue create long-running mode: label Claude as **goal** when feature is available (not “workflow”).
- `dispatch_coding_agent` with `goal`: Claude → `Claude.GoalControl.set_objective`.
- Version gate: if probed `claude --version` &lt; `2.1.139`, `set_objective` fails with `claude_goal_unsupported_version` and a clear message. v1 is fail-fast only (no silent fallback to prompt workflow).

## Errors

| Case | Result |
|------|--------|
| Claude &lt; 2.1.139 | `{:error, :claude_goal_unsupported_version}` |
| `pause` / `resume` / `set_budget` on Claude | `{:error, :unsupported_for_agent}` |
| Cursor `set_objective` via `goal` | `{:error, :unsupported_for_agent}` |
| Empty objective | `{:error, :empty_objective}` |
| Objective &gt; 4000 chars | `{:error, :objective_too_long}` |
| Clear with no goal | idempotent success (`cleared`) |
| Hooks disabled / trust dialog (CLI) | surface CLI failure; document limitation |
| Resume session lost | new session id + re-inject `/goal` if mirror still active |

## Testing (TDD outline)

1. Rename: tool specs / lists / `do_execute` → `goal`; GoalTools + DynamicTool tests.
2. `Claude.GoalControl`: set → mirror + pending; clear → pending clear; get; unsupported actions.
3. CliRunner / CodingAgent: pending set prefixes `/goal …`; clear prefixes `/goal clear`; no pending → no prefix; resume-miss re-queues set when active.
4. `AgentGoal` routing: codex vs claude vs cursor.
5. Authoring: Claude `set_goal_mode` / continue no longer returns `:goal_not_native`.
6. `AgentExecution`: Claude active mirror → `kind: "goal"`, caps without pause.
7. Dispatch: Claude + goal → Claude GoalControl path.
8. UI/unit: GoalPill / capabilities for Claude; slash not Codex-only.

## References

- Claude Code `/goal`: https://code.claude.com/docs/en/goal (requires v2.1.139+)
- Claude dynamic workflows (out of scope): https://code.claude.com/docs/en/workflows
- Codex goals: `thread/goal/set|get|clear` via app-server; Symphony `Codex.GoalControl`
- Cursor: no first-class Goal Mode (forum May–Jun 2026); keep workflow prompt path

## Open points for the implementation plan (not blockers)

- UI `source` field: use `"claude"` for Claude goals (keeps `"native"` = Codex app-server)
- `achieved` detection: v1 ships clear/replace only; transcript parsing is a follow-up
- Version probe: extend `AgentAvailability` to parse semver from `claude --version` and compare to `2.1.139`
