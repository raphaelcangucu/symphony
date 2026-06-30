# Symphony-Orchestrated Subagents — Design

> Introduces a **third execution shape** for bundle units: `subagent_unit`.
> Same-repo, dependent units (today wrongly classified as `child_run`, e.g.
> MAC-12..15 under parent 510) stop being dispatched as isolated runs with their
> own clones/branches/PRs. Instead the **parent run drives them as Symphony-owned
> subagents** inside **one shared working tree per repo**, contributing to the
> **parent's single PR**. Symphony owns each subagent as a **first-class execution
> record** so the user can see and **drill into** each subagent live (like
> Cursor/Codex subagents). Dependent subagents stay in a **`:waiting`** state
> until their contract is `ready`. Each subagent runs the **full TDD + evidence
> quality cycle**; a contract only flips `ready` after that cycle passes.
> This Symphony orchestration applies **only to a parent that has board child
> issues**; a **leaf** run (a childless task or a board subtask) instead uses the
> tool's **native subagents** (Codex/Claude/Cursor) — see §6.0.

Status: **proposal / pending user review.** Recommended defaults are marked (R).

## 1. Problem

Parent issue 510 fanned out into MAC-12..15 as same-repo, contract-dependent
units. Because the deterministic classifier maps "produces/consumes a contract"
to `child_run` regardless of repo (rule 3 in
`docs/superpowers/specs/2026-06-23-subtask-orchestration-design.md`), all four
units were dispatched as **independent runs**. Observed consequences in the live
"Sessões em execução" panel and child logs:

1. **No dependency gating in practice.** The four children launched
   **simultaneously** instead of waiting on the producer's contract. Dependency
   gating exists (`Orchestrator.held_child_issue_ids/*`,
   `BundleGate`) but was **starved of the parent link** — `parent_identifier`
   was dropped for `sub_issue_of` relations (see §5, already fixed).
2. **Wasted setup per child.** Each child cloned the full repo and ran its own
   environment setup in its own worktree (~2.8 GB disk, redundant warmups) even
   though they share a repository.
3. **Wasted tokens (~998K).** Blocked children (e.g. MAC-15) repeatedly
   re-discovered "I am blocked" instead of being parked in a cheap waiting
   state, and re-did self-orientation work the parent already knew.
4. **No subagent-level visibility.** The user cannot open an individual
   subagent's live execution the way Cursor/Codex expose subagents; child runs
   are separate issues, not subagents of the parent's run.

The user's intent: **the parent supervises and orchestrates same-repo dependent
work as subagents in its own working tree, controlling cadence and quality**,
while keeping each subagent **visible and drill-in-able**, and **without
weakening** the testing/quality/evidence cycle that guarantees good software.

## 2. Goals

1. **Third execution shape `subagent_unit`** (R): same-repo unit that the parent
   runs as a Symphony-managed subagent in the parent's shared working tree,
   contributing to the parent's single PR.
2. **Dependency-gated `:waiting`** (R): a dependent subagent is parked in a cheap
   `:waiting` state (no live agent, no tokens) until its consumed contract is
   `ready`; then it becomes spawnable.
3. **One shared working tree per repository** with a **single-writer lock** so at
   most one subagent writes that tree at a time (preserves the per-repo
   single-writer invariant from the parent-coordinator design).
4. **Parent drives cadence + quality**: the parent decides when to spawn each
   subagent, reviews its slice (spec-compliance + code review), and only then
   accepts the contract as `ready`.
5. **First-class subagent observability + drill-in** (R): each subagent is a
   Symphony execution record with its own `session_id`; the running-sessions tree
   nests subagents under the parent, and each row opens the subagent's **live
   transcript**, resolved by `session_id`.
6. **Quality cycle preserved per subagent**: every subagent runs the full
   **TDD + evidence** cycle (`test-driven-development` + `evidence` skills); the
   contract-`ready` gate requires that cycle to pass.
7. **Clear eligibility boundary** (§6.0): Symphony-orchestrated subagents apply
   **only** to a parent that has board child issues. A **leaf** run (a childless
   task or a board subtask, including a `subagent_unit` run) is free to use the
   tool's **native subagents** (Codex/Claude/Cursor); Symphony does not gate or
   disable them.

## 3. Non-goals

- No change to the **cross-repo** path: cross-repo / independently shippable
  units stay `child_run` with their own worktree/branch/PR (the existing model).
- No change to `workpad_task` (small same-repo work the parent does inline).
- No nested subagents: a `subagent_unit` cannot itself spawn a bundle (single
  level, like `child_run` in v1).
- No new persistence engine; reuse SQLite + the orchestrator state + the existing
  evidence/workpad gates.
- Not replacing the parent-coordinator token rollup / passive-parent work
  (`2026-06-26-parent-coordinator-execution-design.md`); this design composes
  with it (subagent tokens roll up into the parent like child tokens do).

## 4. Relationship to prior designs

| Prior spec | What it gave us | What this design adds |
| --- | --- | --- |
| `2026-06-23-subtask-orchestration-design.md` | Execution bundle, `workpad_task` vs `child_run`, shared contracts, deterministic classifier | A **third shape** `subagent_unit` and a classifier delta that routes same-repo dependent units to it instead of `child_run` |
| `2026-06-26-parent-coordinator-execution-design.md` | Parent as passive coordinator, parent→child tree in the panel, `own + Σ children` token rollup | Subagents are **driven by the parent run itself** (the parent is *active* as supervisor, not passive), nest in the same tree, and roll their tokens into the parent |

This design **supersedes** the prior non-goal "no change to the classification
rules": it introduces `subagent_unit`. Cross-repo classification is unchanged.

## 5. Current behavior (grounded references)

| Concern | Where | Note |
| --- | --- | --- |
| `parent_identifier` dropped for sub-issues | `tracker/sync/local_first_tracker.ex`, `local_tracker/tracker.ex` `issue_preloads/0` | **Already fixed**: preload now includes `sub_issue_of`, not only `blocked_by`. Prerequisite for gating + tree. |
| Dependency gating | `orchestrator.ex` `held_child_issue_ids/*`; `BundleGate` | Holds a child until producer/contract ready — depends on the parent link being populated. |
| Running entry carries bundle fields | `orchestrator.ex` `dispatch_running_entry/6` | Sets `bundle_role`, `parent_identifier`, `unit_id`, `repo`, `child_identifiers`. |
| Snapshot payload emits bundle fields | `symphony_elixir_web/presenter.ex` `running_entry_payload/1` | Emits the bundle fields consumed by the panel tree. |
| Frontend tree grouping | `tracker/src/pages/ObservabilityPage.tsx` `groupRunningRows()`; `tracker/src/types/observability.ts` | Groups child rows under parent by `parentIdentifier`/`bundleRole`. |
| Agent execution projection | `agent_execution.ex` | Projects `bundle_role`, `parent_identifier`, `unit_id`, plus a `:waiting` status. |
| Child dispatch specs | `orchestrator/bundle_coordinator.ex` `child_dispatch_specs` | Sets `parent_identifier` in `run_opts` for child runs. |
| Codex session transcript | `codex/session_log.ex` `resolve_rollout_path/2`, `rollout_path_for_thread/2`, `sessions_dir/1` (`~/.codex/sessions`) | Rollout is locatable **by thread id**, not only via the workspace mirror (`.symphony/codex-session.json`). Enables per-subagent drill-in in a shared tree. |
| Per-unit prompt section | `prompt_builder.ex` `child_unit_section` | Existing child framing; we add `subagent_unit_section`. |
| Worktrees | `agent_runner.ex` worktree provisioning | Today one worktree per run; we add a per-repo shared tree for subagents. |
| TDD + evidence cycle | `.claude/skills/test-driven-development`, `.claude/skills/evidence`, `.claude/skills/workpad` | Slice evidence (`task_id`/`task_title`), three per-task gates (`validation`/`evidence`/`commit`), validate gate. Reused per subagent. |

## 6. Proposed design

### 6.0 Eligibility: Symphony subagents vs native tool subagents

Symphony-orchestrated subagents (this design) are the mechanism a **parent issue
that has board child issues** (an execution bundle) uses to run those children.
They apply **only** when the executing issue has board children. For a **leaf**
run — an issue with **no** board children, whether a standalone task or itself a
board subtask — Symphony does **not** orchestrate subagents; instead the run is
**allowed to use the underlying tool's native subagents** (Codex/Claude/Cursor
fan-out) to decompose its own internal work.

| Executing issue | Decomposition mechanism |
| --- | --- |
| Parent with board children (execution bundle) | **Symphony-orchestrated subagents** (this spec): `subagent_unit` for same-repo dependent children, `child_run` for cross-repo/independent, `workpad_task` inline |
| Leaf — childless task, or a board subtask | **Native tool subagents** (Codex/Claude/Cursor); Symphony neither gates nor disables them |

Consequently: the parent coordinator drives its board children via Symphony's
`spawn_subagent`; native fan-out is **not** disabled inside leaf/subagent runs —
those runs may fan out natively as the tool sees fit. (This is the user decision
that resolves Open Question 4 in §11.) A `subagent_unit` run is itself a leaf, so
it too keeps native subagents enabled.

### 6.1 Third execution shape and classifier delta

Add `subagent_unit` to the unit shapes. The classifier (pure function from the
`2026-06-23` design) splits the contract rule by repo:

| Condition | Shape |
| --- | --- |
| Different repo than parent's primary repo | `child_run` (unchanged) |
| Independently shippable / needs own branch+PR | `child_run` (unchanged) |
| Same repo **and** produces/consumes a contract or is a substantial coordinated unit | **`subagent_unit`** (new) + `shared_contract` |
| Same repo, small, low-isolation related change | `workpad_task` (unchanged) |
| Rules conflict / repo unknown | draft + ask human (unchanged) |

`subagent_unit` vs `workpad_task`: `workpad_task` is small work the **parent run
itself** does inline in its turn; `subagent_unit` is a substantial unit that gets
its **own subagent context, its own TDD+evidence slice, and its own drill-in**,
but still shares the parent's tree and PR. MAC-12..15 are `subagent_unit`s.

### 6.2 Shared working tree per repo + single-writer lock

- The parent run owns **one working tree per repository** touched by its
  `subagent_unit`s (same-repo units share it; if a bundle spans repos, each repo
  gets its own tree).
- A **per-tree write lock** serializes subagent writers: at most one subagent
  writes a given tree at a time. The lock holder is the subagent's `AgentRunner`;
  the lock is tied to a `Process.monitor` so a crash auto-releases it (TTL as a
  secondary safety net).
- This preserves the per-repo single-writer invariant and removes the redundant
  per-child clone/setup: setup runs **once per tree**, reused by every subagent.

### 6.3 `spawn_subagent` tool (parent-driven)

A new Symphony DynamicTool callable **by the parent run**:

```
spawn_subagent(unit_id) ->
  { status, summary }   # status: done | blocked | failed
```

Handler (server-side) responsibilities:

1. **Validate** the unit exists and is a `subagent_unit` of this parent.
2. **Gate**: every consumed contract is `status: ready`; otherwise return
   `waiting: <unmet contracts>` (the parent keeps the unit parked).
3. **Acquire** the per-repo tree write lock; if busy, return
   `busy: <unit currently writing>` so the parent waits (no concurrent writers).
4. **Register** a subagent execution record (`:waiting` → `:live`).
5. **Launch** `AgentRunner` in **subagent mode** (§6.5): `cwd` = the shared tree,
   slim subtask prompt, token/timeout caps. The subagent run is a **leaf**, so the
   tool's **native subagents stay enabled** (§6.0) — Symphony does **not** set
   `agents.max_depth=0`. Capture the returned Codex `session_id`.
6. **Stream** Codex events into the record (last_event, tokens, turn) — same
   integration path as a normal run.
7. **On completion**: capture a structured summary (diffstat, produced contract,
   status); run the **contract-ready gate** (§6.7); release the lock; return the
   summary to the parent so it can review and, if needed, **re-spawn** the same
   unit with feedback.

### 6.4 Subagent execution registry + lifecycle

The orchestrator state gains a registry keyed `parent_issue_id -> [subagent
exec]`. Each record: `unit_id`, `issue_identifier` (the MAC issue), `repo`,
`session_id`, `status`, `tokens`, `last_event`, `attempt`, `started_at`.

Lifecycle / states:

```
:waiting ──(contract ready + parent spawns)──► :live ──► :done
   ▲                                              │
   └──────────(re-spawn with feedback)────────────┤──► :blocked  (contract not produced)
                                                   └──► :failed   (error/timeout/cap)
```

- `:waiting` is **cheap** — no live agent, no tokens. This is the state the user
  asked for (replaces the busy-loop "I'm blocked" re-discovery).
- Active (`:live`) subagents appear in the snapshot `running` list as entries
  with `bundle_role: :subagent`, `parent_identifier`, `session_id`, `repo`,
  `unit_id`, tokens. Finished subagents drop out of `running` (like child runs)
  but remain drill-in-able by `session_id`.

### 6.5 Slim subagent prompt (`subagent_unit_section`)

`prompt_builder.ex` gains `subagent_unit_section`, distinct from
`child_unit_section`. It must frame the work as a **subtask inside an existing
working tree**, not a standalone issue:

- "You are a subagent of parent `<parent>` working in the **existing** working
  tree for repo `<repo>` at `<path>`. Do **not** clone, re-init, re-setup, or
  open your own PR — your work lands in the parent's branch/PR."
- The unit's scope, the contract it must **produce** (and exact artifact path),
  and the contracts it may **read** (already `ready`).
- Definition of done for the unit = **TDD-green + slice evidence** (§6.7), recorded
  with `task_id = unit_id`.
- The unit run is a **leaf**: it **may use the tool's native subagents** (§6.0)
  for its own internal decomposition — Symphony does not disable fan-out here.
- For cross-repo units this section is **not** used — those remain `child_run`
  and get the standalone framing. Each repo has its own tree; never write another
  repo's tree from a subagent.

### 6.6 Dependency-gated waiting

- The parent reads the bundle's `depends_on` / `consumes` edges. A subagent whose
  consumed contract is not `ready` stays `:waiting`; the parent does not spawn it.
- When a producer subagent finishes and its contract flips `ready` (§6.7), the
  parent spawns the now-unblocked consumer(s), respecting the single-writer lock
  (one writer per tree at a time; independent units in different repos can run in
  parallel).
- This reuses the existing gating intent (`held_child_issue_ids`/`BundleGate`)
  but **inside the parent run** for subagents, rather than the orchestrator
  dispatch loop.

### 6.7 Quality cycle: TDD + per-subagent evidence + contract-ready gate

Each `subagent_unit` is mapped to a task line in the parent's `## Codex Workpad`
`### Plan`, with the three existing gates:

```
- [ ] unit: api-contract (MAC-12)
  validation: pending
  evidence: pending
  commit: pending
```

- **TDD per subagent**: the slim prompt embeds `test-driven-development`
  (RED→GREEN→refactor before implementing).
- **Slice evidence per subagent**: on finishing its unit the subagent writes a
  run into the **shared tree's** `.symphony/evidence/manifest.json` with
  `task_id = unit_id`, `task_title = unit title`, scoped to its `git diff`
  (e2e + screenshot/video if the unit touched `ui_paths`). The per-tree write
  lock serializes manifest writes (no race). The Evidence tab already groups by
  `task_id`, so evidence shows **per subagent**.
- **Contract-ready gate** (the quality bar): a contract flips `ready` only when
  the parent verifies the slice has (a) TDD green for the unit's diff, (b) slice
  evidence recorded (with `task_id`; e2e when UI changed), and (c) a `code-reviewer`
  pass with no open Critical/Important. Any failure ⇒ contract stays closed, the
  consumer stays `:waiting`, and the parent re-spawns the unit with feedback. A
  subagent that ends without a produced/verified contract is recorded `:blocked`,
  never silently "done".
- **Parent owns final evidence + validate gate + the single PR**: slices are
  *slice evidence*; once every unit is `[x]` with terminal gates, the parent runs
  **final evidence** over the full branch diff (including the deterministic floor:
  `ui_paths` changed ⇒ e2e with screenshot+video), sets `scope_status: complete`
  + `final_validate_allowed/publish_allowed: true`, and the existing validate gate
  runs against the parent's single manifest/PR. Cross-repo `child_run`s keep their
  own workpad/manifest/PR as today.

### 6.8 Data flow + observability + drill-in

**Write path:** parent → `spawn_subagent(unit_id)` → gate+lock+register →
`AgentRunner` (subagent mode, shared tree) → Codex `session_id` → event stream →
subagent record → structured summary → contract gate → parent review/re-spawn.

**Read path:**

- Snapshot `running` = parent entry (`bundle_role: :parent`) **+ one entry per
  live subagent** (`bundle_role: :subagent`, `parent_identifier`, `session_id`,
  tokens, repo, unit_id).
- `presenter.ex` `running_entry_payload/1` already emits the bundle fields →
  `/observability` → `ObservabilityPage.groupRunningRows()` nests subagents under
  the parent (the linkage unblocked by the §5 preload fix).
- `agent_execution.ex` projects subagents (it already carries bundle fields +
  `:waiting`/live states) → board and the issue Agent tab show each unit's
  execution.
- **Drill-in**: opening a subagent row renders its transcript via a new
  `SessionLog.resolve_by_session(agent_kind, session_id)` that resolves the Codex
  rollout **by thread id** (`rollout_path_for_thread`), **bypassing** the shared
  tree's single-thread workspace mirror. Live tail reuses the streaming the Agent
  tab already uses. Finished subagents stay openable (the rollout persists under
  `~/.codex/sessions`).
- **Token rollup**: the parent's displayed total = `own + Σ subagents`
  (consolidated, breakdown on expand) — feeding the parent-coordinator rollup with
  real subagent records.

## 7. Data model changes

- **Execution bundle**: `units[].type` accepts `subagent_unit`. No other shape
  changes; `shared_contract` is reused unchanged.
- **Orchestrator state**: subagent registry `parent_issue_id -> [subagent exec]`
  and a per-repo tree-lock table (`{parent_issue_id, repo} -> holder ref`).
- **Snapshot/running entry**: a `bundle_role: :subagent` variant carrying
  `parent_identifier`, `unit_id`, `repo`, `session_id`, tokens.
- **`AgentExecution`**: `bundle_role` enum gains `:subagent`; `:waiting` status
  reused for parked subagents.
- **Frontend types** (`observability.ts`): `bundleRole` gains `'subagent'`; rows
  are clickable to open by `session_id`.
- No schema migration required for v1 (registry + locks live in orchestrator
  state; evidence/workpad use existing files/tables).

## 8. Error handling & edge cases

1. **Subagent error/timeout/token cap**: `AgentRunner` returns `{:error, reason}`;
   record → `:failed`; tree lock released; parent decides retry (bounded by
   `max_subagent_attempts` per unit, counter on the record). Not the orchestrator's
   issue-level `schedule_issue_retry` (a subagent is not a dispatched issue).
2. **Subagent ends BLOCKED** (no verified contract): reuse the existing
   `{:blocked, violations, reason}` path; record → `:blocked`; contract stays
   closed; consumer stays `:waiting`; parent re-spawns/reorders or escalates
   (workpad note + stop the unit).
3. **Stuck tree lock** (subagent died without releasing): `Process.monitor`
   `:DOWN` auto-releases; TTL backstop.
4. **Parent restart mid-flight**: live subagents are children of the parent run
   and die with it. On restart the parent re-reads the workpad, sees contracts
   already `ready` (idempotency via the contract artifact), and only re-spawns
   units still pending — no duplicate work for `ready` slices.
5. **Two subagents targeting the same tree**: impossible by construction — the
   per-tree lock serializes writers; a second `spawn_subagent` for the same repo
   returns `busy`.
6. **Cross-repo unit inside a same-repo bundle**: classifier keeps it `child_run`
   (own tree/PR); the parent does not run it as a subagent.
7. **Drill-in of a finished subagent**: `session_id` persists →
   `SessionLog.resolve_by_session/2` still finds the rollout; historical transcript
   renders even when the subagent left `running`.
8. **Subagent finishes without TDD-green or slice evidence**: treated as
   `:blocked` (contract not accepted), never as success.

## 9. Testing strategy (TDD)

**Elixir:**

- **Classifier**: same-repo+dependent ⇒ `:subagent_unit`; cross-repo/independent
  ⇒ `child_run`; same-repo small ⇒ `workpad_task`. Rule-by-rule table.
- **Contract gate**: `spawn_subagent` refuses a unit whose consumed contract is
  not `ready`; accepts when `ready`. Contract flips `ready` **only** when
  (TDD-green ∧ slice evidence ∧ code-review ok); otherwise stays closed and the
  consumer stays `:waiting`.
- **Tree lock**: a second `spawn_subagent` for the same repo returns `busy`;
  releases on the monitored process `:DOWN`.
- **Parent restart idempotency**: contract `ready` ⇒ unit not re-spawned; pending
  ⇒ re-spawned.
- **Scope completion**: parent cannot set `scope_status: complete` while any unit
  is `[ ]`/`[~]` or has a non-terminal gate.
- **Snapshot/Presenter**: `running` includes a `:subagent` entry with
  `parent_identifier`/`session_id`/tokens; entry leaves `running` on completion.
- **`SessionLog.resolve_by_session/2`**: resolves the rollout by thread id with a
  fixture `sessions_dir`, ignoring the workspace mirror.
- **Token rollup**: parent total = own + Σ subagents.
- **Prompt snapshot**: `subagent_unit_section` asserts "subtask in the existing
  tree", embeds TDD + evidence (`task_id`), and contains **no** clone/setup/own-PR
  instructions (guards the same-repo framing the user called out).

**Frontend (vitest):**

- `ObservabilityPage`: subagent rows nest under the parent (`bundleRole:
  'subagent'`) and are **clickable** → route to the execution by `session_id`.
- `AgentExecution`/service: normalizes subagent `:waiting`/live and the
  consolidated token total.

**E2E (Playwright, with evidence):** a 2-unit same-repo dependent bundle (unit B
consumes a contract produced by unit A). Drive the real app: see the parent +
2 nested subagent rows in the tree; assert B stays `:waiting` until A's contract
is `ready`; open one subagent's drill-in and confirm the live transcript loads;
capture ≥1 screenshot + ≥1 video into `.symphony/evidence/manifest.json` per the
`evidence` skill.

## 10. Delivery phases

1. **Phase 0 — already landed**: `parent_identifier` preload fix
   (`sub_issue_of`) so gating + tree have the parent link.
2. **Phase 1 — model + classifier**: add `subagent_unit` shape and the classifier
   delta; bundle parsing; pure, fully unit-testable. No runtime behavior change
   until the runner exists.
3. **Phase 2 — execution**: shared per-repo tree + write lock; `spawn_subagent`
   tool; `AgentRunner` subagent mode; subagent registry + `:waiting`/live states;
   `subagent_unit_section` prompt; dependency-gated spawning.
4. **Phase 3 — quality cycle**: per-subagent TDD+evidence slices; contract-ready
   gate (TDD ∧ evidence ∧ review); parent final evidence over the single PR.
5. **Phase 4 — observability/drill-in**: `:subagent` snapshot entries; clickable
   subagent rows; `SessionLog.resolve_by_session/2`; token rollup wiring.

Phases 1 and 5 are low-risk; Phases 2–3 change runtime behavior and warrant
careful tests around gating, locks, retries, and parent restart.

## 11. Open questions

1. **`subagent_unit` vs `workpad_task` threshold**: is "produces/consumes a
   contract" the sole trigger for same-repo `subagent_unit` (R), or also a size
   heuristic for independent-but-substantial same-repo units?
2. **Parallel subagents across repos in one bundle**: allow concurrent live
   subagents in *different* repos under one parent (R: yes, one writer per tree),
   or serialize all subagents of a parent globally for v1 simplicity?
3. **Re-spawn budget**: default `max_subagent_attempts` per unit (R: 2) before the
   parent escalates to a human via the workpad.
4. **Native tool subagents — RESOLVED**: leaf runs (childless tasks and board
   subtasks, including `subagent_unit` runs) keep native Codex/Claude/Cursor
   fan-out **enabled** (§6.0). Symphony orchestration governs only the
   parent↔board-children layer; it does not disable native subagents inside a
   leaf run.

## 12. Risks

- Driving subagents from inside the parent run concentrates orchestration logic in
  the parent turn; needs robust tests for partial completion, blocked producers,
  and parent restart (must never strand a `:waiting` consumer forever).
- The per-tree lock must be correct under crashes (monitor + TTL) to avoid a
  permanently busy tree.
- Drill-in correctness hinges on resolving transcripts by `session_id`, not the
  shared-tree workspace mirror — covered by a dedicated `resolve_by_session` test.
- Token rollup must avoid double counting across subagent re-spawns.
