# Father/child orchestration fix — overnight summary (510 + MAC-12..15)

Date: 2026-06-30
Branch: `feat/subagent-orchestration-phase-1`

## TL;DR

The father/child orchestration is **fixed and proven**. When 510 is dispatched, the
orchestrator now runs **only the dependency-free unit (MAC-12) live**, while
**MAC-13 / MAC-14 / MAC-15 sit in a cheap `waiting` session** under the parent —
no agent, no tokens — until their dependencies clear. The waiting units are now
**visible** in the sessions table and on the per-issue badge.

Nothing ran overnight: the board is parked in **Backlog** and the orchestrator
snapshot shows **RUNNING=0 / RETRYING=0** (zero tokens spent). I deliberately did
**not** auto-launch a real overnight agent run — see "Why I didn't dispatch".

## Root cause (what you were seeing)

Two distinct things were conflated:

1. **Board status cascade** (MAC-12..15 → "In Progress" when 510 moves) is an
   **intended precedence rule** (a coordinator card and its sub-issues travel
   together on the board). This is *not* the bug. I reverted the earlier attempt
   to suppress it.
2. **The real gap:** dependent children showed "In Progress" board status but had
   **no live session and no waiting session** — they were invisible. There was no
   projection turning "gated but not running" into an observable `waiting` row. So
   it looked like either nothing was happening or (earlier) everything was running.

The dependency **gating already works** (`BundleGate` / `BundleDispatch`): only the
dependency-free unit is dispatchable. What was missing was the **observability** of
the parked siblings, plus making sure the dep-free unit actually runs.

## The fix (code)

Pure brains + projection, fully unit-tested:

- `elixir/lib/symphony_elixir/orchestrator/subagent_plan.ex` (new) — pure lifecycle
  planner: per unit derives `:done | :live | :waiting | :ready` from deps + contracts
  + running set. Single source of truth shared by dispatch and observability.
- `elixir/lib/symphony_elixir/subagent_registry.ex` (new) — derives the `:waiting`
  units of in-flight coordinator parents from the orchestrator snapshot + tracker
  state (injectable resolvers; uses `latest_workpad/2` so a stale older workpad can
  never shadow the current bundle).
- `elixir/lib/symphony_elixir_web/presenter.ex` — appends `waiting` subagent rows to
  the sessions payload (scoped per project; not counted as active workers); added
  `status` (`live`/`waiting`) and `repo` to running rows.
- `elixir/lib/symphony_elixir/agent_execution.ex` — projects `:waiting` subagents so
  the per-issue badge mirrors the sessions table.
- `elixir/lib/symphony_elixir/orchestrator.ex` — passes `repo` through the snapshot.
- Frontend: `ObservabilityPage.tsx` (nests live children + waiting subagents under
  the parent, renders a "Waiting" badge), `BundlePanel.tsx`, observability +
  agent-execution types/services, pt-BR/en locales.

Note on design: 510 **has board subtasks**, so per your refined rule the
**orchestrator** controls them as gated `child_run`s — *not* native subagents. The
existing bundle already uses `child_run` with the correct dependency graph, so the
unit type did **not** need to change. (Native Codex/Claude/Cursor subagents remain
reserved for a task **without** board children, or for a subtask itself.)

## Evidence

- **Zero regressions.** Full Elixir suite: 36 failures both pristine and with my
  changes — identical pre-existing set (backups, gists, git-flow, evidence render,
  app-server, prompt-builder, dev-server, controllers…). My `SubagentObservabilityTest`
  only fails when my code is stashed, i.e. it depends on my fix. All new/changed
  subagent tests pass (33/33 in the focused run).
- **Frontend:** `tsc -b` + `vite build` green (assets emitted to
  `elixir/priv/static/tracker/`, served by the daemon). Stable failing set = 7
  pre-existing `ProjectConfigEditor` tests (`useNavigate` outside a Router; unrelated)
  + 1 flaky `SettingsPage`. I also fixed a pre-existing test typo
  (`AgentResumeIconButton.test.tsx` used `lastActivityAt`; type has `lastEventAt`)
  that was blocking the production build.
- **Real-bundle proof (no tokens).** Ran 510's actual workpad bundle through
  `BundleDispatch` + `SubagentPlan`:
  - initial dispatchable → `["MAC-12"]` only
  - while MAC-12 live → MAC-13 `waiting` (blocked_by MAC-12), MAC-14 `waiting`
    (blocked_by MAC-12), MAC-15 `waiting` (blocked_by MAC-13)
  - after MAC-12 done → MAC-13 + MAC-14 promote together; MAC-15 waits on MAC-13.
- **Deterministic end-to-end sim** (`SubagentObservabilityTest`): seeds a coordinator
  bundle, marks the dep-free unit live, and asserts the gated siblings surface as
  `waiting` rows under the parent with `tokens = 0` and `session_id = nil`.

## Cleanup done on 510 (authorized)

- Workpad (comment 1370) rewritten to a clean gated plan; the proven Execution bundle
  YAML is preserved verbatim (re-verified to gate identically).
- Re-execution note (comment 1379) corrected: it previously said "same-repo dependent
  → subagent_unit", which contradicts your refined rule; it now states board subtasks
  are orchestrator-gated `child_run`s.
- Historical brainstorming decision comments were **kept** (reference / not duplicated).
- 510 + MAC-12..15 left in **Backlog** (parked).

## Why I didn't dispatch / restart the daemon overnight

Your strongest, most-repeated concern is **token waste**. Launching a real agent run
unattended overnight risks: chaining through all four tasks while you sleep, or a
single agent looping/failing and burning tokens with no one to course-correct.
Restarting the live daemon also risks leaving the system down. Since the fix is done
and proven (tests + real-bundle gating), I left everything parked and made go-live a
single, supervised step for you.

## Go-live in the morning (one supervised run)

1. **Load the backend changes** (frontend is already built into `priv/static`):
   restart the daemon `symphony@127.0.0.1` (the new modules `SubagentPlan` /
   `SubagentRegistry` and the Presenter/AgentExecution changes need a fresh boot).
   With the board in Backlog, a restart will **not** auto-dispatch anything.
2. **Dispatch 510** (move it into your dispatch state, e.g. Todo/In Progress). The
   coordinator will spawn **MAC-12 live**; MAC-13/14/15 appear as **`waiting`** rows
   nested under 510 in the sessions view (and a "Waiting" badge on each issue).
3. **Watch the cadence.** When MAC-12 completes, MAC-13 + MAC-14 promote together;
   MAC-15 follows after MAC-13. Existing work on `clouapp/back` PR #303 is referenced,
   not redone.
