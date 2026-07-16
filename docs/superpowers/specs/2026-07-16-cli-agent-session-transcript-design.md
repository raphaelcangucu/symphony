# CLI agent session transcript (Cursor + Claude) — Observability + Autonomous parity

**Date:** 2026-07-16  
**Status:** Draft (ready for review)  
**Primary surfaces:** Orchestrator headless runs (`Cursor.CliRunner`, `Claude.AppServer.CliRunner`),
`SessionLogChannel` / Autonomous execution chat, Observability agent executions  
**Related:**  
[`2026-07-16-cursor-plan-interactive-ux-design.md`](./2026-07-16-cursor-plan-interactive-ux-design.md)
(ACP / interactive Plan — out of scope here; orchestrator stays `--print`),  
[`2026-07-09-assistant-live-turn-resilience-design.md`](./2026-07-09-assistant-live-turn-resilience-design.md)
(`turn_stream` for assistant threads — not reused for issue execution in v1)

## 1. Problem

Headless Cursor (and the same pattern for Claude Code) **do progress** under the
orchestrator, but operators cannot see turn/tool evolution the way they can with
Codex:

1. **Autonomous transcript** — `SessionLogChannel` polls external JSONL
   (`~/.cursor/projects/.../agent-transcripts` or `~/.claude/projects/...`).
   With `--print --stream-json`, that file is often missing, late, or keyed to
   the wrong workspace encoding, so the UI shows empty / “execution details
   unavailable” while the process is alive.
2. **Observability** — CLI events are folded into generic `:notification`
   snapshots (`last_event: "notification"`, weak `last_message`), not
   tool-level / turn-level updates like Codex’s typed events.
3. **Task settings** — runs must keep using the **agent + model + effort**
   chosen on the issue (`local_tracker_issue_agent_settings` + existing
   resolution). Bridging transcript must not invent defaults that override the
   task, and Observability should continue to surface the model/agent that the
   task actually selected.

Observed shape (Advising CDE-1180): Cursor live for minutes, Workpad + status
moves landed, `vibe up` / Docker in flight — Autonomous blank; Observability
only coarse notifications.

## 2. Goals

1. **Symphony-owned transcript** for Cursor and Claude headless turns under
   `<workspace>/.symphony/<agent>-session.jsonl`, written from `stream-json`
   as events arrive.
2. **`SessionLog` resolve prefers** that Symphony file (fallback to external
   JSONL for interactive / legacy paths).
3. **Typed orchestrator events** from the same `process_event` path so
   Observability gets meaningful `last_event` / `last_message` / tool
   progression (parity with Codex’s coarse live status, not a second UI).
4. **Honor task agent settings** — every turn uses the issue’s resolved
   `agent_kind`, `model`, and `effort`; sidecar + snapshots record what was
   used.

## 3. Non-goals

- Phoenix push of `"entries"` (Approach 2) — keep 500ms poll like Codex.
- Wiring assistant `turn_stream` into issue execution.
- ACP / Plan permissions / CreatePlan cards (separate Cursor Plan UX spec).
- Changing Codex rollout / SessionLog path.
- OpenCode (unless trivial later; not required for this ship).
- Persisting `agent_session_id` on the issue row (follow-up if join still
  fails after Symphony transcript exists).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| Approach | **Bridge único** — one producer from CliRunner `on_event` / `process_event` |
| Agents | **Cursor + Claude** (same gap) |
| Transcript location | `<workspace>/.symphony/cursor-session.jsonl` / `claude-session.jsonl` |
| Resolve order | Symphony JSONL first → external projects JSONL fallback |
| Observability | Enrich existing `codex_worker_update` / `RunUpdate` with typed events |
| Task settings | **Source of truth** remains `AgentRunner.agent_settings_opts/1` + `issue_agent_kind/1`; no hardcoding in the bridge |
| Sidecar | Optional `.symphony/<agent>-session.json` with `{path, session_id, model, effort, started_at}` |
| UI contracts | No tracker Phoenix API change; reuse `SessionLogChannel` + `AgentExecution` snapshots |

## 5. Architecture

```
cursor-agent / claude --print --stream-json (stdout)
        │
        ▼
CliRunner.process_event  (Cursor | Claude)
        │
        ├─► Agent.SessionTranscript.append(agent, workspace, entry)
        │         └─► <workspace>/.symphony/<agent>-session.jsonl
        │                    ▲
        │                    └── SessionLogChannel (poll) → Autonomous transcript
        │
        └─► typed on_event (:tool_call_started | :notification | :turn_completed | …)
                  └─► CodingAgent → AgentRunner → Orchestrator.RunUpdate
                            └─► AgentExecution Broadcaster → Observability
```

Task settings flow (unchanged ownership, explicit contract):

```
issue agent settings (DB) + label + project + user defaults
        │
        ▼
AgentRunner.issue_agent_kind / agent_settings_opts
        │
        ▼
CodingAgent.start_session / run_turn opts (:model, :effort, :agent_kind)
        │
        ├─► CliRunner CLI flags (--model, effort encoding per agent)
        └─► SessionTranscript sidecar metadata (what was used)
```

## 6. Components

### 6.1 Shared — `SymphonyElixir.Agent.SessionTranscript`

- `append(agent_kind, workspace, entry)` — ensure `.symphony/`, append one
  NDJSON line (best-effort; never fail the turn).
- `path(agent_kind, workspace)` → `.symphony/cursor-session.jsonl` |
  `.symphony/claude-session.jsonl`.
- `write_sidecar(agent_kind, workspace, meta)` — optional JSON pointer used by
  SessionLog resolve (mirror Codex `.symphony/codex-session.json` idea).
- Entry shape: already UI-facing maps that each agent’s `SessionLog.parse_*`
  can consume (or write the same normalized shape both parsers accept).

### 6.2 Cursor

- `Cursor.CliRunner.process_event/3` — after mapping stream-json, append
  transcript entry + keep/emit typed bridge events.
- `Cursor.SessionLog.resolve_log_path/2` — prefer Symphony path / sidecar;
  fallback `~/.cursor/projects/<encoded>/agent-transcripts/**/*.jsonl`.
- `Cursor.CodingAgent` — prefer typed emit (`:tool_call_started`,
  `:tool_call_completed`, assistant text as `:notification` with stable
  payload) instead of wrapping everything as opaque `:notification`.

### 6.3 Claude

- `Claude.AppServer.CliRunner.process_event/3` — same append + typed emit.
- `Claude.SessionLog.resolve_log_path/2` — prefer Symphony path / sidecar;
  fallback `~/.claude/projects/<encoded>/*.jsonl`.
- `Claude.CodingAgent` / app-server turn `on_event` — align typed events into
  the shared orchestrator path.

### 6.4 Facade

- `SymphonyElixir.SessionLog.resolve_log_path/2` — public API unchanged;
  adapters change internal resolve only.

### 6.5 Task agent settings (must not regress)

Resolution stays in `AgentRunner`:

1. Per-issue `AgentSettings` (`agent_kind`, `model`, `effort`)
2. Issue label agent preference
3. Project defaults
4. User/global defaults (`Settings.Agents` / `Settings.AgentEfforts`)

Rules for this work:

- Bridge code **must not** pick model/effort; it only records what the runner
  already received in turn opts.
- CliRunner flags continue to omit invalid/`auto` model per existing Cursor
  rules; effort follows each agent’s encoding (Cursor: often in model slug;
  Claude: explicit effort opt).
- Orchestrator `dispatch_running_entry` already stores `agent_kind` + `model`
  for Observability badges — keep that wired from `agent_settings_opts`.
- Sidecar meta should include `agent_kind`, `model`, `effort` used for the
  turn so Operators can correlate transcript file ↔ task config.

## 7. Data flow

1. Dispatch selects agent/model/effort from the issue.
2. `CliRunner.run_turn` streams NDJSON.
3. Each event → normalize entry → `SessionTranscript.append` → typed
   `on_event`.
4. `SessionLogChannel` resolves Symphony JSONL → poll → Autonomous UI.
5. `RunUpdate.integrate` updates live execution → Observability.

On turn start (once): write/update sidecar with session id + settings used.

## 8. Error handling

| Case | Behavior |
|------|----------|
| Missing `.symphony/` | create; if create/append fails, log warn, continue turn |
| Append I/O error | best-effort; typed Observability events still fire |
| Only external JSONL exists | fallback unchanged |
| Abort / crash | terminal transcript entry + error event (existing semantics) |
| Partial assistant deltas | emit incremental entries or progress; UI already tolerates |

## 9. Testing

WSL: one targeted file/filter at a time.

- Unit: `SessionTranscript.append` + path helpers.
- Unit: Cursor/Claude `resolve_log_path` prefers Symphony when present.
- Unit: stream-json → entry + typed event atom mapping (one sample event
  family per agent).
- Unit: `agent_settings_opts` still wins over empty opts when merging (no
  accidental hardcode in new code paths).

## 10. Acceptance

1. Headless Cursor run on an issue with agent=cursor, model/effort set on the
   task shows growing Autonomous transcript during tools/shell (not only at
   end).
2. Same for Claude headless.
3. Observability row for that issue updates `last_event` / `last_message`
   beyond a single stuck `notification` / `item/created` when tools run.
4. Observability agent/model badge matches the task’s selected agent/model.
5. Removing Symphony JSONL falls back to external projects JSONL when present.
6. Append failures do not kill the agent turn.

## 11. Implementation order

1. `Agent.SessionTranscript` + tests.
2. Cursor CliRunner append + SessionLog resolve + typed emits.
3. Claude CliRunner append + SessionLog resolve + typed emits.
4. Sidecar meta including agent/model/effort.
5. Manual check on Advising-style Cursor dispatch + Observability.

## 12. Follow-ups (out of scope)

- Persist Cursor/Claude `cli_session_id` as issue `agent_session_id` for
  resume/dormant UX.
- True Phoenix push for entries.
- OpenCode Symphony transcript.
