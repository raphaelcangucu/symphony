# Parent Coordinator: Execution Tree, Passive Coordination & Token Rollup - Design

> Rethinks how a **parent issue** behaves while its subtasks (`child_run` units)
> execute: the parent should act as a **coordinator** (active only to decompose
> and to integrate, passive while children run), the running-sessions panel
> should show the **parent → children execution tree**, and the parent's token
> count should be the **consolidated** total of its own work plus its children's.
> Builds on the status precedence rollup (a parent takes the least-advanced
> status among its children).

Status: **proposal / pending confirmation.** Recommended defaults are marked
(R); they were proposed to the user but not yet explicitly confirmed.

## 1. Problem

Today a parent issue is dispatched as a normal agent run and, while its
`child_run` units are still in flight, the orchestrator **re-dispatches the
parent on every poll just to check whether the children are done**
(`parent_completion_held?/2`, `elixir/lib/symphony_elixir/orchestrator.ex:1060`).

Consequences observed in the "Sessões em execução" panel:

1. The parent **appears as a live coding session**, occupies an agent slot, and
   **burns tokens** even though the real work is in the children.
2. Re-running a full agent just to poll child completion is wasteful and is a
   **conflict surface**: a writing parent run concurrent with same-repo child
   runs can touch overlapping files / diverge the base branch.
3. The running-sessions panel is **flat** — there is no visual parent/child
   tree, so it is not obvious which sessions belong to which parent.
4. Token usage is tracked **per issue and ephemerally** (on completion only the
   project-level total survives; there is **no parent ← children rollup**), so a
   parent's "cost" does not reflect the work it coordinates.

## 2. Goals

1. **Parent as coordinator**: the parent is *active* only during **Decompose**
   and **Integrate**; it is **passive** (no agent slot, no tokens) while
   `child_run` units execute, and is **woken by a child-completion event**
   (reusing the rollup trigger) rather than by polling. (R)
2. **Execution tree** in the running-sessions/observability panel: parent rows
   group their child rows; passive coordinators render as a coordination node,
   not a live coding session.
3. **Consolidated token display**: a parent shows `own + Σ children` with a
   breakdown (own vs children) on expand. (R)
4. **Conflict invariant**: per repository, at most one *writing* agent at a time;
   the parent never writes while a same-repo child run is active.

## 3. Non-Goals

- No change to the `workpad_task` vs `child_run` classification rules.
- No change to child-run isolation primitives (worktrees/branches/PRs already
  exist and work).
- Nested grandchildren rollup is **out of scope for v1** (direct parent ↔ direct
  children only), but data structures should not preclude it.
- No new persistence engine; reuse SQLite + existing schemas where possible.

## 4. Current behavior (grounded references)

| Concern | Where | Note |
| --- | --- | --- |
| Parent re-dispatch polling | `orchestrator.ex:1060` `parent_completion_held?/2` | Parent cleared from `running`, re-dispatched next poll to re-check children. |
| Running entry already has bundle fields | `orchestrator.ex:885` `dispatch_running_entry/6` | Sets `bundle_role`, `parent_identifier`, `unit_id`, `child_identifiers`. |
| Snapshot payload omits them | `symphony_elixir_web/presenter.ex:134` `running_entry_payload/1` | Only emits `issue_*`, `state`, `session_id`, `turn_count`, `tokens{input,output,total}`. |
| Frontend tree scaffolding exists | `tracker/src/pages/ObservabilityPage.tsx:92` `groupRunningRows()`; `tracker/src/types/observability.ts` `RunningSession{parentIdentifier,bundleRole,childIdentifiers,...}` | Tree grouping is coded but starved of backend data. |
| Tokens per running entry | `orchestrator.ex` `integrate_codex_update/2` | Live `agent_input/output/total_tokens`; on completion only `agent_totals_by_project` survives — no per-issue durable tally, no parent rollup. |
| Child isolation | `agent_runner.ex:92` worktrees; `claimed` set; `BundleGate` | Children isolated by worktree+branch+PR; gate sequences deps/contracts. |
| Status rollup (already built) | `local_tracker/context.ex` rollup + `tracker/sync/subtask_rollup.ex` | Parent status = least-advanced child; the child-completion signal we can reuse to wake the parent. |

## 5. Proposed design

### 5.1 Parent lifecycle (3 phases)

```
Decompose (active) ──► Coordinate / Wait (passive) ──► Integrate (active) ──► Done
   builds bundle,         no agent slot, no tokens,        merge / finalize /
   creates children,      woken by child-completion        validation run
   runs workpad_tasks     event (rollup trigger)
```

- **Decompose**: unchanged from today — agent builds the execution bundle,
  creates child issues, runs inline `workpad_task` units.
- **Coordinate/Wait** (R): once `child_run` units are dispatched, the parent
  holds **no agent run**. It shows in the tree as a passive coordinator. The
  orchestrator does **not** re-dispatch it on polls.
- **Integrate** (R): when the last child reaches a terminal/done status, a
  **child-completion event** (the same hook that drives the status rollup) wakes
  the parent for a short integration run.

This replaces the poll-based `parent_completion_held?` loop with an
**event-driven** wake, eliminating idle parent runs and their token/slot cost.

### 5.2 Conflict invariant

> Per repository, at most one **writing** agent at any moment.

- `child_run` units stay isolated (worktree + branch + PR) — already true.
- The parent writes only in **Decompose** and **Integrate**, never while a
  same-repo child run is active → removes the parent-vs-child write overlap.
- `BundleGate` + shared contracts continue to sequence cross-unit dependencies.
- Integration ordering: children land their own PRs; the parent's Integrate
  phase runs after all children are terminal (or rebases onto the landed work).

### 5.3 Execution tree in the panel

Backend (small): extend `running_entry_payload/1` (`presenter.ex:134`) to emit
the bundle fields already present on the running entry (`bundle_role`,
`parent_identifier`, `unit_id`, `child_identifiers`), plus a passive-coordinator
indicator for parents in the Wait phase. Frontend `groupRunningRows()` already
consumes these → the tree renders. Passive parents render as a coordination node
(distinct from a live coding row).

### 5.4 Token consolidation (R: consolidated + breakdown)

- Introduce a **durable per-issue token tally** (issue record column or a small
  `issue_token_usage` table) updated when a run completes, so tokens survive past
  the ephemeral running entry.
- Parent's displayed total = `own + Σ children` (direct children for v1).
- Tree row shows the consolidated total; expanding shows the **own vs children**
  breakdown. Child rows show their own totals.

## 6. Delivery phases (R: observability first)

1. **Phase 1 — Observability (low risk, mostly read-only):**
   - Expose bundle fields in the snapshot payload → parent/child tree in the
     panel.
   - Add the durable per-issue token tally + parent consolidation → consolidated
     token column with breakdown.
2. **Phase 2 — Execution model (deeper, behavior change):**
   - Make the parent passive during the Wait phase (stop re-dispatch polling).
   - Wake the parent on the child-completion event (reuse the rollup trigger)
     for the Integrate phase.
   - Enforce the per-repo single-writer invariant for parent vs same-repo
     children.

Phase 1 makes the problem visible and is shippable on its own; Phase 2 changes
runtime behavior and warrants its own plan + careful testing.

## 7. Open questions

1. **Passive parent visibility**: show the passive coordinator as a node in the
   panel (R: yes) or hide it until Integrate?
2. **Token display**: consolidated + breakdown (R), two columns, or children-only
   sum on the parent?
3. **Integration ownership**: parent runs a final integration/merge pass after
   children land (R), or children merge independently and the parent just closes
   out?
4. **Same-repo child runs**: confirm the strict "parent passive while any
   same-repo child active" invariant (R: yes).
5. **Durable tokens location**: column on the issue vs dedicated table — affects
   migrations and future nested rollup.

## 8. Risks

- Changing the parent re-dispatch loop touches core orchestrator gating; needs
  thorough tests around partial child completion, retries, and failure of a
  child run (parent must not be stuck waiting forever).
- Event-driven wake must be idempotent (a child can re-emit completion after a
  sync pull); de-dupe the wake.
- Token tally must avoid double counting across parent re-dispatches and child
  retries.
