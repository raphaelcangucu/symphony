# Per-session identity, channels & logs — 1 working tree → N sessions

**Date:** 2026-07-17
**Status:** Draft (ready for review)
**Primary surfaces:** Orchestrator (`SymphonyElixir.Orchestrator`), `AgentExecution`,
`SessionLogChannel`, `SessionLog`, assistant `Thread` model, Tracker Workspaces UI
(`ProjectSessionsWorkspace`, sidebar, `useSessionLogChannel`)
**Related:**
[`2026-07-16-cli-agent-session-transcript-design.md`](./2026-07-16-cli-agent-session-transcript-design.md)
(per-agent Symphony transcript — this spec pushes it to per-session),
[`2026-07-14-sidebar-sessions-perf-design.md`](./2026-07-14-sidebar-sessions-perf-design.md)
(flat Project → Session sidebar)

## 1. Problem (evidence)

On Advising `CDE-1180` an operator created interactive session `thread:8015` from
"New session". The tracker simultaneously showed an autonomous execution
(`?exec=CDE-1180&surface=autonomous`) that the operator never started, stuck on
`Aborted`, yet still streaming the *same* transcript
("O `git fetch` ainda está em execução…") as `thread:8015`. The execution could
not be stopped and kept updating despite the aborted badge.

Root cause — identity, logs, and the autonomous channel are keyed by
**working tree / issue**, not by **session**:

| Origin | Identity today | Channel today | Log today |
|--------|----------------|---------------|-----------|
| Assistant / exploration | Real `Thread` (`thread:8015`) | `assistant:thread:<id>` (per-session) | DB + agent rollout |
| Issue session (interactive) | Real `Thread` | `assistant:thread:<id>` | shared tree log |
| Orchestrator execution | **No record — projection keyed by issue** (`exec:CDE-1180`) | `session_log:<project>:<issue>` (per-issue) | shared tree log |

Because a `issue_session` thread runs Codex in the issue's **canonical working
tree** (`Workspace.path_for_issue/1`, `history.ex` `issue_session_workspace/3`
default `workspace_kind: "shared"`), and `AgentExecution.interrupted_issue?/1`
(`agent_execution.ex`) scans routable non-terminal issues, resolves that same
tree's log, and synthesizes an `:aborted` execution from the interactive
session's live activity:

```elixir
# agent_execution.ex
Enum.any?(titles, &aborted_title?/1) or
  (recent_activity?(titles) and not completed_recently?(titles))
```

The autonomous surface then tails the *same* file via
`session_log:<project>:<issue>` → `SessionLog.resolve_log_source(agent_kind, workspace)`,
so both tabs render one transcript. "Stop/Kill" on the autonomous panel targets
an orchestrator run that does not exist (it was synthesized); the real owner is
`thread:8015`.

## 2. Goals

1. **Session is the unit of identity.** Every session — assistant, exploration,
   `issue_session`, and orchestrator execution — has its own id, its own channel,
   and its own log file.
2. **1 working tree → N sessions.** Multiple sessions may attach to one working
   tree concurrently and be observed independently without cross-contamination.
3. **Eliminate synthesized executions.** Interrupted/aborted state comes from a
   real session record, never inferred from a tree's shared log.
4. **Light concurrency guardrail.** When 2+ sessions are actively writing to the
   same working tree, surface an indicator in the UI.

## 3. Non-goals

- Real git/file coordination for concurrent writers (locks, commit queue,
  conflict detection). Deferred; operator's responsibility for now.
- Removing native agent rollouts (`~/.codex/…`, `~/.cursor/…`, `~/.claude/…`);
  they remain a resolution fallback.
- Multi-device sync of session state.
- A second Observability UI (board keeps its per-issue rollup).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| Session record | **Reuse `Thread`** (`assistant_threads`) for every origin |
| New scope | `"issue_execution"` (`metadata.origin: "orchestrator"`) |
| Frontend identity | Unify on `thread:<id>`; `exec:<issue>` becomes a **resolver**, not an identity |
| Per-session log | `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl` (Symphony NDJSON) |
| Log resolution | `SessionLog.resolve_for_session/1` prefers per-session file; native rollout is fallback |
| Channel | `session_log:<session_id>` (back-compat shim for `session_log:<project>:<issue>`) |
| Interrupted state | Real session status; **delete** `interrupted_issue?` synthesis |
| Concurrency guardrail | UI indicator when >1 live session shares a `workspace_path` |

## 5. Architecture

```
Working tree  ── workspace_path (shared attribute) ──┐
                                                     │  1 : N
  ┌──────────────────────────────────────────────────────────────┐
  │ Session (Thread)                                               │
  │   id            → thread:<id>  (canonical, origin-agnostic)    │
  │   scope         → issue_session | issue_execution | ...        │
  │   workspace_path→ the working tree                             │
  │   channel       → autonomous/execution: session_log:<id>       │
  │                   interactive assistant: assistant:thread:<id> │
  │   log           → <workspace>/.symphony/sessions/<id>/transcript.jsonl │
  └──────────────────────────────────────────────────────────────┘
```

Each running agent turn is tagged with its `session_id`; events append only to
that session's transcript file. Two agents in one tree no longer cross-write logs.

## 6. Components

### 6.1 `Thread` model (`assistant/thread.ex`)
- Add `"issue_execution"` to `@scopes`; validate scope fields for it (requires
  `project_slug`, `issue_identifier`, `workspace_path`).

### 6.2 `SessionLog` (`session_log.ex` + adapters)
- Add `resolve_for_session(session)` → prefers
  `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl`; falls back to
  `resolve_log_source(agent_kind, workspace)` for legacy/interactive paths.
- Transcript writer keyed by `session_id` (extends the per-agent
  `Agent.SessionTranscript` to a per-session path).

### 6.3 `SessionLogChannel` (`channels/session_log_channel.ex`)
- Join `session_log:<session_id>`; resolve the session's log file; poll unchanged
  (500ms). `steer_turn` targets the specific session/run.
- Back-compat: `session_log:<project>:<issue>` resolves to the issue's active
  execution session during transition.

### 6.4 Orchestrator (`orchestrator.ex`)
- On dispatch: create/lookup an `issue_execution` Thread; stamp
  `running_entry.session_id` with the thread id; record `unit_id`/worktree in
  `metadata` (child bundle runs resolve their worktree log by session).
- On completion/abort/stall: set the session Thread `status`
  (`completed`/`aborted`/`paused`). This is the real interrupted state.

### 6.5 `AgentExecution` (`agent_execution.ex`)
- Keep `from_snapshot` (live runs).
- **Delete** `interrupted_executions` / `interrupted_issue?` synthesis; derive
  interrupted/saved rows from real execution-session Threads + statuses.
- Board rollup stays per issue (latest/active execution session per issue);
  consumers unchanged (`agent_execution_channel`, `agent_execution_controller`,
  `tracker_presenter`).

### 6.6 Tracker frontend
- `useSessionLogChannel` takes a `sessionId`; joins `session_log:<sessionId>`.
- `ProjectSessionsPage` resolves `?exec=<issue>&surface=autonomous` → active
  execution session → `/workspaces/<id>` (legacy deep links preserved).
- Sidebar: `sessionKindFromRecentScope` maps `issue_execution → execution`;
  execution rows become real `thread:<id>` entries.
- **Indicator:** when >1 session with a live/running status shares the same
  `workspace_path`, render a "N sessões escrevendo nesta árvore" badge on those
  sessions and the workspace group.

## 7. Data flow

1. Dispatch creates an `issue_execution` session → thread id = session id.
2. Turn events → transcript append to the session's file (`session_id` tag).
3. `SessionLogChannel` joins `session_log:<session_id>` → poll → Autonomous UI.
4. Completion/abort → session status set on the Thread.
5. Board reads live + real execution sessions (no synthesis).

## 8. Error handling

| Case | Behavior |
|------|----------|
| Missing `.symphony/sessions/<id>/` | create; on failure log warn, continue turn |
| Append I/O error | best-effort; typed Observability events still fire |
| Only native rollout exists | fallback to `resolve_log_source` |
| Legacy `session_log:<project>:<issue>` join | resolve to active execution session |
| Concurrent writers on one tree | logs stay isolated; UI shows the guardrail indicator |

## 9. Testing (WSL: one targeted file/filter at a time, sequential)

- Unit: `resolve_for_session/1` prefers per-session transcript; fallback path.
- Unit: `session_log:<session_id>` channel join + `steer_turn` targeting.
- Unit: orchestrator creates a session on dispatch; sets status on
  complete/abort.
- Unit: `AgentExecution` no longer synthesizes interrupted rows; derives from
  real sessions.
- Unit: sidebar `issue_execution → execution` mapping.
- Unit: "2+ writers" indicator logic (given N sessions on one `workspace_path`).

## 10. Acceptance

1. Creating `thread:8015` in `CDE-1180`'s tree does **not** produce an autonomous
   `exec:CDE-1180` execution.
2. Autonomous surface only appears when a real orchestrator execution session
   exists; it addresses that session by id.
3. Two sessions in one working tree stream distinct transcripts (no shared text).
4. Stopping a session stops that session's run; no phantom "can't stop / still
   updating while aborted".
5. When 2+ live sessions share a tree, the UI shows the concurrency indicator.
6. Board per-issue badges still reflect live + real interrupted executions.

## 11. Implementation order

1. `Thread` scope `issue_execution` + validations.
2. Per-session transcript path + `SessionLog.resolve_for_session/1`.
3. `SessionLogChannel` session-id topic + back-compat shim.
4. Orchestrator session create-on-dispatch + status-on-complete/abort.
5. Remove `AgentExecution` synthesis; derive from real sessions.
6. Frontend: `useSessionLogChannel(sessionId)`, `?exec=` resolver, sidebar mapping.
7. "2+ writers" indicator.

## 12. Follow-ups (out of scope)

- Real git/file coordination for concurrent writers.
- Persisting agent `cli_session_id` on the session for resume/dormant UX.
- True Phoenix push for transcript entries (keep 500ms poll for now).
