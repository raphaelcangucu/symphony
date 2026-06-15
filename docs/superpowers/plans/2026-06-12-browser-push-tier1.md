# Browser Push — Tier 1 events Implementation Plan

**Goal:** Extend Web Push notifications with operator-critical events beyond Human Review and evidence: agent failures/retries and PR monitor human-attention signals.

**Architecture:** Add focused functions on `PushNotifications.Dispatcher` and call them from existing orchestrator retry/completion paths and PR monitor `persist_action_after_comment/8`. Reuse the same JSON payload shape (`title`, `body`, `url`, `tag`, `kind`) and `Sender.deliver_all/2`. No new tables or UI toggles in v1.

**Tech Stack:** Elixir (`SymphonyElixir.PushNotifications`), `ex_nudge` (RFC 8291 `aes128gcm`), tracker Service Worker unchanged.

---

### Task 1: Extend Dispatcher with Tier 1 payloads

**Files:**
- Modify: `elixir/lib/symphony_elixir/push_notifications/dispatcher.ex`
- Test: `elixir/test/symphony_elixir/push_notifications/dispatcher_test.exs`

- [ ] **Step 1: Write failing tests**

Add tests for:
- `agent_retry_scheduled/1` — builds payload with identifier + error snippet
- `agent_run_incomplete/2` — incomplete handoff
- `pr_monitor_attention/4` — limit_reached, needs_human, unrelated (no-op for move_done/move_rework)

- [ ] **Step 2: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/push_notifications/dispatcher_test.exs`
Expected: FAIL (functions undefined)

- [ ] **Step 3: Implement**

New public functions:
- `agent_retry_scheduled/1` — metadata map with `identifier`, `project_slug`, `attempt`, `error`
- `agent_run_incomplete/2` — `%Issue{}`, reason term
- `agent_run_blocked/2` — `%Issue{}`, violations (optional summary string)
- `pr_monitor_attention/4` — `%Project{}`, identifier, action, event atom

Deep links:
- Agent events → `/tracker/projects/:slug/board/issues/:id`
- PR monitor → `/tracker/projects/:slug/board/issues/:id/pull-request`

- [ ] **Step 4: Run tests — PASS**

---

### Task 2: Orchestrator hooks

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex`

- [ ] **Step 1: Hook `schedule_issue_retry/4`**

After scheduling, call `PushDispatcher.agent_retry_scheduled/1` when:
- `next_attempt >= 1`
- error is NOT `"no available orchestrator slots"` (slot backoff is routine)

Pass `%{identifier, project_slug, attempt: next_attempt, error: error}`.

- [ ] **Step 2: Hook incomplete + blocked runs**

In `maybe_annotate_incomplete/2` after workpad comment, call `agent_run_incomplete/2`.

In `annotate_blocked/3`, call `agent_run_blocked/2` with violation summary.

- [ ] **Step 3: Manual smoke**

Move is optional; unit tests cover dispatcher.

---

### Task 3: PR monitor hooks

**Files:**
- Modify: `elixir/lib/symphony_elixir/pull_request_monitor.ex`
- Test: `elixir/test/symphony_elixir/pull_request_monitor_test.exs` (or new focused test file)

- [ ] **Step 1: Write test**

Test that `persist_action_after_comment` path invokes push for `{:stay, :limit_reached}` (mock or assert on Dispatcher via injectable callback — prefer testing Dispatcher directly + integration comment in PR monitor test if exists).

- [ ] **Step 2: Hook after successful MonitorState upsert**

In `persist_action_after_comment/8`, after `{:ok, _row}`, call:

```elixir
PushNotifications.Dispatcher.pr_monitor_attention(project, identifier, action, event_from_opts_or_pass_through)
```

Pass `event` from `run_decision` into `apply_transition` chain (add parameter) OR derive title from `action` alone (simpler).

- [ ] **Step 3: Run PR monitor + dispatcher tests**

Run: `cd elixir && mix test test/symphony_elixir/push_notifications/ test/symphony_elixir/pull_request_monitor`

---

### Task 4: Update design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-12-browser-push-notifications-design.md`

Document Tier 1 kinds: `agent_retry`, `agent_incomplete`, `agent_blocked`, `pr_limit_reached`, `pr_needs_human`, `pr_ci_unrelated`.

---

### Task 5: Verification

Run: `cd elixir && mix test test/symphony_elixir/push_notifications/ test/symphony_elixir/pull_request_monitor_test.exs`

Expected: all PASS
