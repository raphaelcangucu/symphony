# Agent Switch Same Execution Session Implementation Plan

**Goal:** Keep one orchestrator `issue_execution` session when changing agent and resuming; only hard reset creates a new session.

**Architecture:** Extend `ExecutionSession.ensure/3` to reopen the latest non-archived execution session (updating `agent_kind`), and archive that session from `IssueDispatch.hard_reset/3` so the next dispatch creates a fresh Thread. `AgentRunner` already reads the new agent from settings on the next turn.

**Tech Stack:** Elixir, Ecto, ExUnit (`ExecutionSession` + `IssueDispatch` tests).

---

### Task 1: ExecutionSession reuse after finish

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent/execution_session.ex`
- Test: `elixir/test/symphony_elixir/agent/execution_session_test.exs`

**Steps:**

1. Add failing tests:
   - after `finish(..., "aborted")`, `ensure/3` with a new `agent_kind` returns the **same id**, status `"active"`, updated `agent_kind`
   - `ensure(..., force_new: true)` after finish creates a **new** id
   - active reuse unchanged
2. Run: `cd elixir && mise exec -- mix test test/symphony_elixir/agent/execution_session_test.exs`
3. Implement reuse of latest non-archived `issue_execution`; apply `force_new`
4. Re-run the same targeted test file until green

### Task 2: Hard reset archives execution session

**Files:**
- Modify: `elixir/lib/symphony_elixir/issue_dispatch.ex`
- Modify: `elixir/lib/symphony_elixir/agent/execution_session.ex` (add `archive_latest/2` or similar)
- Test: `elixir/test/symphony_elixir/issue_dispatch_test.exs` and/or execution_session_test

**Steps:**

1. Add failing test: hard_reset archives the issue’s latest non-archived `issue_execution`
2. Implement archive helper + call from `maybe_hard_reset/4`
3. Run targeted `issue_dispatch_test.exs` filter for hard_reset (one file / one test name)

### Task 3: Verify

**Steps:**

1. Re-run `test/symphony_elixir/agent/execution_session_test.exs`
2. Re-run the hard_reset-focused dispatch test
3. Do **not** expand to full suite under WSL without asking
