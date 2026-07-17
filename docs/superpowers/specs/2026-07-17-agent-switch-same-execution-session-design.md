# Agent switch keeps the same orchestrator execution session

## Problem

Changing an issue’s coding agent (e.g. codex → cursor) and resuming work created a
**second** `issue_execution` Thread. The sidebar showed two “GAM-20” rows because
`ExecutionSession.ensure/3` only reused sessions with `status == "active"`. After
abort/error, the next dispatch always inserted a new Thread.

## Goal

- Switching agent updates the preference and **keeps the same orchestrator run /
  execution session** (same sidebar row, same session id / transcript channel).
- The **next turn / dispatch** uses the newly selected agent (`AgentRunner` already
  resolves `agent_kind` from issue settings at run start).
- **Hard reset / “new thread”** still creates a fresh execution session on purpose.

## Non-goals

- Hot-swapping agent mid-turn without stopping the current process.
- Changing interactive `issue_session` authoring threads.
- UI redesign beyond whatever is needed for correct session identity.

## Design

### 1. Reuse latest execution session on `ensure/3`

Default `ExecutionSession.ensure(project, identifier, opts)`:

1. Prefer an **active** `issue_execution` for that issue (current behavior).
2. Else reopen the **latest non-archived** `issue_execution` for that issue:
   - set `status` to `"active"`
   - update `agent_kind` (and workspace path if provided)
3. Else create a new Thread (current create path).

`opts[:force_new] == true` skips reuse and always creates.

### 2. Hard reset archives the current execution session

`IssueDispatch.hard_reset/3` (after stopping the active run) archives the latest
non-archived `issue_execution` for the issue so the following orchestrator
dispatch creates a new session. Resume / continue_work do **not** archive.

### 3. Next turn agent

No change to agent resolution: `AgentRunner.issue_agent_kind/1` already prefers
persisted issue agent settings. Reusing the session is enough for “next turn uses
the new agent.”

### 4. Soft-restart while live (follow-up if needed)

Today the execution composer disables agent change while a run is active. If that
is relaxed later: stop the process, keep `execution_session_id`, redispatch with
the new `agent_kind` without `force_new`. Out of scope for the initial fix unless
a simple path falls out naturally.

## Acceptance

- Finish an execution session (aborted/error), change agent, resume → **same**
  `thread:<id>`, `agent_kind` updated, status active again.
- Hard reset → previous session archived, new `issue_execution` id on next run.
- Active session still reused without creating duplicates.
- Targeted unit tests cover reuse, agent_kind update, and hard-reset archive.

## Risks

- Unique active-issue indexes: reactivating must not leave two `active`
  `issue_execution` rows for the same issue.
- Migrated historical sessions (`metadata.origin == "migration"`) may be reused;
  acceptable (same issue run identity); hard reset still starts clean.
