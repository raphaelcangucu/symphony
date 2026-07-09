# Assistant live turn resilience

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Supersedes (partial):** Non-goal in `2026-06-21-assistant-turn-session-tracking-design.md` that kept live token/tool streaming socket-bound for non-goal durable threads.

## Problem

Operators watching a durable assistant turn (especially Claude) often see only **“Crunching…”** with no command detail and no way to act, while the agent is busy on long work (e.g. `docker exec … pest --parallel`).

Root causes observed on thread `7999` (2026-07-09):

1. Live `assistant_delta` / `tool_call_*` pushes are bound to the **originating WebSocket** except for goal threads (which already fan out via PubSub).
2. In-flight tools are **not persisted** until turn end, so reconnect/history cannot rebuild “what’s running now.”
3. The working strip shows tool **name** only (or rotating verbs), not the Bash command; Bash rows default collapsed.
4. Claude turns ignore `{:codex_interrupt}` (Codex-only receive loop), so Stop does not kill the CLI process group.
5. `serve_restart` / TurnManager reconcile can mark DB `interrupted` while an orphan Claude/Bash process keeps running — UI and reality diverge.

## Goals

1. **Live visibility on every joined tab** for durable assistant threads (same fan-out pattern as goal threads).
2. **Reconnect survival:** join restores mid-turn tool snapshot; PubSub continues the stream.
3. **Act on it:** Stop turn (kills agent process group) and Kill command (cancels the active tool’s OS child when possible).
4. **Honest naming:** rename `SymphonyElixir.Assistant.CodexSession` → `AgentSession` (it already runs all agents).

## Non-goals

- Auto-resume after full BEAM restart (Resume stays manual).
- Persisting every token/delta to SQLite mid-turn.
- Adopting orphan OS processes after abrupt kill across restarts.
- Changing `/btw`, voice, or attachment flows.
- Auto-killing on stale-activity hint (hint only).

## Approach

**Extend goal-style PubSub to all durable turns**, keep a lightweight mid-turn snapshot in `metadata.current_turn`, and wire agent-agnostic interrupt/kill.

```
Agent CLI stream (Claude / Codex / Cursor / …)
  → AgentSession.relay_* (today: CodexSession.relay_codex_event)
  → turn_stream_opts push_stream
       ├─ push(originating socket)
       └─ PubSub broadcast (ALL durable threads)   # was goal-only
  → every AssistantChannel subscriber
       → ProjectAssistantPanel

Stop turn:
  UI → stop_turn → TurnManager → interrupt worker
    → CliRunner.kill_port (process group)
    → current_turn interrupted; clear active_tools
    → PubSub turn_status

Kill command:
  UI → kill_tool {tool_call_id}
    → best-effort kill of that tool’s OS child under the agent CLI
    → tool status canceled; turn stays running
    → if no child PID: toast + offer Stop turn
```

## Data model

No new table. Extend `assistant_threads.metadata["current_turn"]`:

| Key | Notes |
|-----|--------|
| (existing keys) | `status`, `trigger`, `prompt`, `agent_kind`, `model`, `effort`, `turn_id`, `session_id`, `error`, `interrupted_reason`, `started_at`, `finished_at`, … |
| `active_tools` | List of running tools: `id`, `name`, `arguments` summary (e.g. Bash command string), `started_at` |
| `last_activity_at` | ISO8601; updated on delta/tool events for stale hint |

Cleared on turn terminal status (`completed` / `failed` / `interrupted` / `canceled`).

Join / `last_turn` payload includes `active_tools` so the client can hydrate the streaming bubble without waiting for the next event.

## Backend changes

### Rename

- `SymphonyElixir.Assistant.CodexSession` → `SymphonyElixir.Assistant.AgentSession`
- File: `codex_session.ex` → `agent_session.ex`
- Update aliases, channel, controllers, tests (`CodexSession*` → `AgentSession*`)
- Prefer a clean rename (no long-lived deprecated alias) unless an external import requires a thin shim

### Streaming fan-out

In `AssistantChannel.turn_stream_opts/4`, fan out stream events over the per-thread PubSub topic for **all durable threads**, not only `goal_thread?`.

Reuse existing `GoalRun` / TurnManager PubSub helpers (same topic pattern as `{:goal_stream, event, payload}`). Non-originating channel processes already handle `{:goal_stream, …}` — generalize naming if needed (`{:turn_stream, event, payload}`) or keep the tuple and subscribe all durable joins.

Amend `2026-06-21-assistant-turn-session-tracking-design.md` non-goal: live streaming **does** go on PubSub for durable turns; lifecycle/status remains PubSub+DB as today.

### Snapshot updates

On `tool_call_started` / `tool_call_completed` / meaningful activity:

- Upsert/remove entries in `current_turn.active_tools`
- Bump `last_activity_at`
- Avoid writing on every text delta (throttle activity timestamp if needed)

### Stop turn

- Channel event: `stop_turn` (extend existing interrupt paths)
- Worker must handle interrupt for **Claude and Cursor** via `Agent.CliRunner.Base.kill_port/1` (process group), not only Codex’s `{:codex_interrupt}` receive loop
- Persist `interrupted` + reason; clear `active_tools`; PubSub `turn_status`

### Kill tool

- Channel event: `kill_tool` with `%{tool_call_id: …}`
- Best-effort: identify OS child for that tool (Claude Bash/docker child under the CLI process group); kill that subtree
- Mark that tool `canceled` in snapshot + push `tool_call_completed` (or dedicated canceled status)
- Turn remains `running`
- If child cannot be identified: return error payload; UI offers Stop turn

### Orphan honesty

- Boot `reconcile_orphaned_turns` remains: DB `interrupted (serve_restart)`
- UI must not show a fake running spinner when join says interrupted
- Web-only restart: workers may survive; PubSub + snapshot keep UI honest after channel rejoin (do not invent a second reconcile that kills live workers without an explicit Stop)

## Frontend changes

### Working strip (`WorkingIndicator`)

- Prefer command summary: `Running Bash · pest --parallel --shard=3/3 · 2:14`
- Fall back to rotating verbs only when there is no active tool
- Actions: **Stop** (turn) and **Kill** (active tool when `tool_call_id` known)

### Tool timeline

- Running Bash/shell tools **expanded by default**
- Per-running-tool **Kill**

### Reconnect / second tab

1. Join → `last_turn` + `active_tools` → rebuild streaming assistant message + working strip
2. Subscribe to thread PubSub → continue deltas/tools
3. Interrupted + `can_resume` → existing Resume banner (no auto-resume)

### Stale hint

- If `last_activity_at` older than ~2 minutes while `running`, soft copy: “No updates — Stop or Kill?” (no auto-kill)

## Testing

1. Non-goal durable turn: second channel receives `tool_call_started` via PubSub
2. Join mid-turn restores `active_tools` into streaming UI
3. Claude `stop_turn` kills port / marks interrupted
4. `kill_tool` cancels one tool and leaves turn running (or returns fallback error)
5. WorkingIndicator shows command string when active tool has arguments
6. Rename: existing session tests pass under `AgentSession`

## Rollout

- Single feature PR; metadata-only (no migration)
- Claude is the primary failure mode; Codex/Cursor share the same interrupt/kill contracts
- Update turn-session-tracking design doc non-goal in the same PR

## Success criteria

- Refreshing or opening a second tab mid-turn shows the live Bash/command (not only “Crunching…”)
- Stop ends Claude CLI + children and clears the running UI
- Kill cancels a stuck Pest/Bash when a child PID is available; otherwise Stop is offered
- `CodexSession` name is gone from the assistant turn path in favor of `AgentSession`
