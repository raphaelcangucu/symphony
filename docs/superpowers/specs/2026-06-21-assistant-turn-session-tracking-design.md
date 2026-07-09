# Assistant Turn & Codex Session Tracking (durable, web-independent)

- **Date:** 2026-06-21
- **Status:** Approved — revised 2026-06-21 to persist in `assistant_threads.metadata` (no new table)
- **Area:** Issue/Project assistant chat (`elixir/` Phoenix channel + Codex app-server + SQLite) and `tracker/` React SPA
- **Entry point:** `http://localhost:4000/tracker/projects/:project/assistant/issue/:id`

## 1. Summary

Make every assistant chat turn (and its Codex session) **durably trackable**, so that
at any moment — including after a page refresh **or a full serve restart** — we can answer:

- Which was the **last Codex session** for this thread?
- Is it **running**, **completed**, **failed**, or **interrupted**?
- If it was interrupted, let the operator **Resume** it with one click.

Today this is impossible: the live turn state lives only in the originating channel
process (socket assigns), and the only durable artifact is the assistant message —
written **only on success**. A refresh orphans the indicator; a restart kills the
turn and leaves the user message with no reply and no explanation. This is exactly
what happened with `DIS-1` (two duplicate sends → two parallel Codex sessions →
serve restart mid-turn → no completion, no trace).

The fix is **two cooperating layers**, mirroring how the orchestrator already
isolates and tracks its workers:

1. **Durable layer** — the current turn state persisted on the **existing
   `assistant_threads.metadata` JSON column** (no new table, no migration — the
   same pattern `mode`/`goal_mode`/`goal_objective` already use, see
   `history.ex:160-240`). It is the source of truth for the *last* turn's status,
   Codex session ids, prompt, and timing, and survives a full restart. Full
   per-turn audit history stays in `log/symphony.log` (`session_id=<thread>-<turn>`),
   which already exists.
2. **Live layer** — an always-on in-memory `Registry` holding the running turn's
   worker **pid**, so any channel (including a reloaded tab) can observe and
   **steer/interrupt** the in-flight turn. Auto-clears when the worker dies.

A small always-on `Assistant.TurnManager` GenServer owns turn start/stop, writes
the metadata transitions, monitors the worker, and **reconciles orphaned `running`
threads to `interrupted` on boot**.

## 2. Background & current architecture

The 2026-06-02 design ("Assistant Chat: Queued Messages, … Steering …") already
moved turn execution **off** the channel process into a supervised `Task`, and
added `steer_turn`/`turn/interrupt`. That foundation is in place:

| Concern | Path |
|---------|------|
| Channel server | `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` |
| Turn orchestration | `elixir/lib/symphony_elixir/assistant/codex_session.ex` |
| Codex app-server client (steer/interrupt loop) | `elixir/lib/symphony_elixir/codex/coding_agent.ex` |
| Persistence boundary | `elixir/lib/symphony_elixir/assistant/history.ex` |
| Thread schema | `elixir/lib/symphony_elixir/assistant/thread.ex` |
| Partial durable run-state (goal mode only) | `elixir/lib/symphony_elixir/assistant/goal_run.ex` |
| Always-on infra subtree | `elixir/lib/symphony_elixir/shared_supervisor.ex` |

**What already works (do not rebuild):**

- The turn runs in a `Task` under `SymphonyElixir.TaskSupervisor`, which lives in
  the **`SharedSupervisor`** (always-on), **not** the web subtree. So a page
  refresh and `mix symphony.ctl update` (web-only restart) **already** leave the
  turn running. (`assistant_channel.ex:565`, `shared_supervisor.ex:49`.)
- `steer_turn`/`{:codex_steer, …}`/`{:codex_interrupt}` exist
  (`assistant_channel.ex:251`, `coding_agent.ex:813`).
- `GoalRun` (a `:duplicate`-key `Registry` + per-thread PubSub) already lets a
  reloaded tab re-attach to an in-flight **goal** turn (`goal_run.ex`,
  `assistant_channel.ex:27,35-36`).

**The three gaps this design closes:**

1. **No durable record.** Turn state is in `socket.assigns` (`turn_status`,
   `turn_pid`, `turn_ref`, `codex_turn_id` — `assistant_channel.ex:580-585`). Lost
   on refresh; the DB has no row until the assistant message is persisted on
   success. After a full restart there is **zero** trace of an interrupted turn.
2. **Live tracking is goal-only.** `goal_thread?/1` gates `GoalRun` to issue
   threads with `goal_mode` enabled (`assistant_channel.ex:960-963`). A normal
   `complex` thread like `DIS-1` gets no indicator and no re-attach.
3. **Steer is channel-bound.** `steer_turn` reads `socket.assigns.turn_pid`
   (`assistant_channel.ex:264`), which a reloaded tab does not have — so you can't
   steer/interrupt a turn started before the refresh.

## 3. Goals & non-goals

**Goals**

- Durably record every assistant turn (issue, freeform, project_explore) with its
  Codex `session_id`/`turn_id`/`codex_thread_id`, status, timing, and error.
- Survive page refresh, web-only restart, **and** full serve restart.
- After a full restart, mark orphaned `running` turns as `interrupted` and surface
  an **"Interrupted"** state with a **Resume** button that re-dispatches the same
  prompt (reusing `codex_thread_id` for context continuity).
- Generalize live run-tracking + steer/interrupt to **all** threads (not just goal
  mode), resolving the worker pid from a registry so it works cross-channel /
  post-refresh.
- On a new message while a turn is running: **prefer steer** (inject into the live
  turn); **fall back to queue** when steer is not possible. Eliminate the parallel
  Codex sessions that bit `DIS-1`.

**Non-goals**

- Auto-resuming the Codex turn without an operator click (Resume is manual).
- ~~Moving live token/delta **streaming** onto PubSub (deltas still go to the
  originating socket, as today). Only lifecycle/status is PubSub+DB.~~
  **(superseded 2026-07-09)** Live token/tool streaming for durable threads is
  PubSub-fanned; see `2026-07-09-assistant-live-turn-resilience-design.md`.
  Lifecycle/status remains PubSub+DB.
- Reworking `/btw` side-queries or voice/image attachment flows.
- Re-attaching the running OS Codex process across a full restart (the child dies
  with the BEAM; we record `interrupted`, we do not adopt a live process).

## 4. Data model — `assistant_threads.metadata["current_turn"]`

**No new table and no migration.** The current/last turn is persisted as a nested
map under the existing `assistant_threads.metadata` JSON column — the same
mechanism `mode`, `goal_mode`, and `goal_objective` already use (`history.ex:160-240`).
All helpers live in `SymphonyElixir.Assistant.History`.

Shape of `metadata["current_turn"]` (all keys are strings; datetimes are ISO8601
**strings** because the column is JSON-encoded):

| Key | Notes |
|-----|-------|
| `status` | `running` \| `completed` \| `failed` \| `interrupted` \| `canceled` |
| `trigger` | `user` \| `goal_continuation` \| `resume` |
| `prompt` | the user prompt text (required for Resume) |
| `agent_kind` | e.g. `codex`, or null |
| `model`, `effort` | null unless set |
| `codex_thread_id` | persistent Codex thread (for Resume / continuity), or null |
| `turn_id` | Codex turn id (filled on `on_turn_started`), or null |
| `session_id` | `<codex_thread_id>-<turn_id>` as in `log/symphony.log`, or null |
| `error` | failure detail, or null |
| `interrupted_reason` | `serve_restart` \| `task_crash`, or null |
| `started_at` | ISO8601 string |
| `finished_at` | ISO8601 string, or null |

Only the **latest** turn per thread is kept — it answers the operative questions
("what was the last session, did it finish, can I resume?"). Historical audit of
all past turns is already in `log/symphony.log`; promoting to a queryable per-turn
table later is possible without touching the live layer.

**Why not Codex / logs alone:** Codex app-server processes are children of the
BEAM — a full serve restart kills them, and Codex has no notion of "this Symphony
turn was running and got interrupted". Logs are durable but are free text,
non-transactional, and not queried by the app to drive UI/Resume. The one missing
primitive is a durable, app-queryable "started-but-not-finished" flag that survives
a restart — which `metadata["current_turn"]` provides at zero schema cost.

Status lifecycle (stored in metadata):

```
running ──success──▶ completed
   │
   ├──turn error──▶ failed
   │
   ├──task DOWN (abnormal)──▶ interrupted (reason: task_crash)
   │
   └──orphan at boot──▶ interrupted (reason: serve_restart)

interrupted ──Resume──▶ running   (trigger: resume; reuses codex_thread_id)
```

## 5. Process — `Assistant.TurnManager` (always-on GenServer)

New module `SymphonyElixir.Assistant.TurnManager`, added to `SharedSupervisor`
child specs (always-on; not torn down by `symphony.ctl update`). It centralizes
what the channel does ad-hoc today.

**State:** an in-memory per-thread FIFO queue (§7); the source of truth for turn
status is `thread.metadata` + the pid registry.

**Backing registry:** a `Registry` (`keys: :unique`, keyed by `thread_id`) holding
`{worker_pid, codex_turn_id}`. Generalizes `GoalRun.Registry` to all threads. (Keep
`:unique` because we enforce one main turn per thread; the queue serializes the
rest.)

**API (called by the channel):**

- `start_turn(thread_id, prompt, opts) :: {:ok, %{pid: pid}} | {:error, reason}`
  1. If a live worker is already registered for `thread_id`: return
     `{:error, :turn_in_progress}` (the channel then routes to **steer** — §7).
  2. Write `metadata.current_turn` `status: running` (via
     `History.start_turn_state/2`) with `trigger`, `prompt`,
     `agent_kind/model/effort`, optional `codex_thread_id`, `started_at`.
  3. `Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn -> … end)` running
     the channel-provided `run` closure (the existing `run_send_turn/5` pipeline);
     `Process.monitor` the pid.
  4. Register `{pid, nil}` under `thread_id`.
  5. Broadcast `{:turn_status, :running, payload}` on the thread topic.
- `note_codex_turn(thread_id, codex_thread_id, turn_id)` — on `on_turn_started`,
  update the registry entry and `metadata.current_turn` (codex ids + `session_id`).
- `finish_turn(thread_id, {:ok, result})` — set `completed`, `finished_at`,
  `codex_thread_id`/`turn_id`; unregister; broadcast `{:turn_status, :finished, …}`;
  then drain the queue (§7).
- `finish_turn(thread_id, {:error, reason})` — set `failed` + `error`; unregister;
  broadcast; drain.
- `steer_target(thread_id) :: {:ok, pid, codex_turn_id} | :error` — for
  cross-channel steer/interrupt.
- `running?(thread_id)` / `elapsed_seconds(thread_id)` — read helpers (registry +
  `thread.metadata`) for the join payload. (`last_turn` is read straight off the
  thread via `History.current_turn/1`.)

**Monitor:** `handle_info({:DOWN, ref, :process, pid, reason}, …)` → if the thread's
`metadata.current_turn` is still `running`, transition it to `interrupted`
(`reason: task_crash`) unless `finish_turn` already moved it to a terminal state.

**Boot reconciliation (the `DIS-1` fix):** in `init/1`, run
`History.reconcile_orphaned_turns()` → every thread whose
`metadata.current_turn.status` is still `running` is set to `interrupted` with
`interrupted_reason: serve_restart`, `finished_at: now`. After a full restart there
are no live workers, so any `running` thread is by definition orphaned.

> Why `SharedSupervisor` and not the orchestrator subtree: this must stay up across
> `symphony.ctl update` (web + orchestrator restarts), and it must not be coupled to
> dispatch. The orchestrator pattern (durable state + dedicated supervisor) is the
> model; the always-on placement is the difference.

## 6. Streaming vs. lifecycle (scope boundary)

- ~~**Live streaming** (`assistant_delta`, `tool_call_*`, `message_created`) keeps
  going to the **originating socket**, exactly as today. No change.~~
  **(superseded 2026-07-09)** Live token/tool streaming for durable threads is
  PubSub-fanned to every joined tab; see
  `2026-07-09-assistant-live-turn-resilience-design.md`.
- **Lifecycle/status** (`running` / `finished` / `interrupted`) is broadcast via
  the per-thread PubSub topic **and** persisted to `metadata.current_turn`. A reloaded
  tab subscribes on join and renders "executing since X" or "interrupted", and
  receives the terminal event to clear the indicator — the same mechanism `GoalRun`
  already uses, now for every thread.

This keeps lifecycle durable; live stream fan-out for durable turns is covered by
the 2026-07-09 resilience design.

## 7. New message while running — steer, then queue

The channel's `send_message` path changes to consult `TurnManager`:

- **No live turn** → `TurnManager.start_turn(...)` (normal path).
- **Live turn exists** → **steer**: resolve the pid via `TurnManager.steer_pid/1`
  (not `socket.assigns`, so it works post-refresh), persist the message as a
  `user` message with `metadata: %{"steer" => true}` (existing `maybe_persist_steer`),
  and forward `{:codex_steer, [...], reply_pid}`.
  - On `{:steer_ok, _}` → done.
  - On `{:steer_error, reason}` (e.g. `ActiveTurnNotSteerable` — the turn was
    already wrapping up) → **queue**: persist the message and enqueue it; when the
    current turn finishes, `TurnManager` starts the next queued turn for the thread.

**Queue storage:** a per-thread FIFO held by `TurnManager` (in-memory) keyed by
`thread_id`. Drained on `finish_turn`. (Persisting the queue is a non-goal; on a
crash the queued user messages remain in history and the operator can resend — the
Resume affordance covers the interrupted turn itself.)

This eliminates the `DIS-1` failure mode: a duplicate send can never spawn a second
parallel Codex session for the same thread.

## 8. Restart → Interrupted + Resume

- After a full restart, §5 boot reconciliation marks the orphaned thread's
  `current_turn` `interrupted`.
- **Join payload** (`assistant_channel.ex` join, all three thread-scoped
  `assistant:*` clauses) gains, derived from `History.turn_payload/1`:

  ```elixir
  last_turn: %{
    status: turn["status"],
    started_at: turn["started_at"],
    finished_at: turn["finished_at"],
    session_id: turn["session_id"],
    can_resume: turn["status"] == "interrupted"
  }
  ```

  plus `turn_running`/`turn_elapsed_seconds` from `TurnManager.running?/elapsed_seconds`
  (now thread-general), alongside the existing goal-pill fields.
- **Resume:** new `handle_in("resume_turn", _payload, socket)` (operates on the
  socket's thread — no id needed, since only the current turn is tracked):
  - Reads the thread's `current_turn`; if `interrupted`, re-dispatches its `prompt`
    as a **new** turn via `TurnManager.start_turn(thread.id, prompt,
    trigger: "resume", codex_thread_id: current_turn["codex_thread_id"], …)`.
    Codex continuity is automatic — `run_send_turn` reuses the thread's
    `agent_thread_ids` (`codex_session.ex:146-155`).
  - Idempotency: reject if a live turn already exists for the thread, or if
    `current_turn` is not `interrupted`.

## 9. Channel / event changes

| Direction | Event | Payload | Status |
|-----------|-------|---------|--------|
| server→client | join `last_turn` | see §8 | new |
| client→server | `resume_turn` | `{}` (acts on the socket's thread) | new |
| server→client | `turn_status` | `{ status, turn_id, started_at, session_id }` | new (PubSub-fanned) |
| client→server | `steer_turn` | `{ message }` | existing; pid now from `TurnManager` |
| server→client | `assistant_delta`/`tool_call_*`/`assistant_completed`/`assistant_error` | unchanged shape | unchanged |

`assistant_channel.ex` changes:

- `send_message` → delegate worker lifecycle to `TurnManager.start_turn` (replaces
  the inline `Task.Supervisor.start_child` + assigns bookkeeping at `:563-585`),
  with the steer/queue branch from §7.
- `steer_turn` (`:251`) → resolve pid via `TurnManager.steer_pid/1`.
- Interrupt path (`:1041`) → resolve pid via `TurnManager`.
- Join clauses (`:16`, `:52`, `:75`) → subscribe to the thread topic for all
  threads and include `last_turn`.
- New `handle_info({:turn_status, …})` to reconcile a reloaded tab.
- New `handle_in("resume_turn", …)`.

`GoalRun` is **generalized into** `TurnManager`'s registry/PubSub helpers; the
goal-mode-only `goal_thread?/1` gate is removed for run-tracking purposes (goal
mode remains a separate concept for autonomous continuation).

## 10. Error handling

- **Steer race** (turn completes before steer lands) → `steer_error` →
  fall back to queue.
- **Task crash** → `:DOWN` → row `interrupted (task_crash)`; the worker's `after`
  still runs `stop_session` to reclaim the Codex port.
- **Full restart mid-turn** → boot reconcile → row `interrupted (serve_restart)` →
  Resume button.
- **Resume of a non-interrupted / already-running thread** → rejected with a clear
  reason.
- **Registry not started** (unit tests) → helpers degrade to `nil`/`:error`
  (mirror `GoalRun`'s `rescue ArgumentError`).

## 11. Testing

**Elixir**

- `History` metadata turn functions: `start_turn_state/2` (running), transition to
  each terminal state, `current_turn/1`, `turn_running?/1`, `turn_payload/1`,
  `reconcile_orphaned_turns/0` (flips `running` threads → `interrupted`).
- `TurnManager`:
  - `start_turn` writes `running` + registers pid + broadcasts.
  - second `start_turn` for the same thread returns `:turn_in_progress`.
  - worker `:DOWN` abnormal → `current_turn` `interrupted (task_crash)`.
  - `reconcile_orphaned_turns` flips a pre-seeded `running` thread →
    `interrupted (serve_restart)`.
  - queue drains the next message on `finish_turn`.
- `assistant_channel`:
  - join returns `last_turn` and re-attaches a running turn (reloaded tab).
  - `steer_turn` works when the turn was started by a *different* channel pid
    (cross-channel via `TurnManager`).
  - `resume_turn` starts a `trigger: resume` turn from the thread's interrupted
    `current_turn` and reuses `codex_thread_id`; rejects when not interrupted.
  - new message while running → steer; on `steer_error` → queued.
- Keep existing `goal_run_test.exs` / `assistant_channel_test.exs` green (adapt to
  the generalized registry).
- Quality gate: `make all` and `mix specs.check` (public `def` in `lib/` need
  `@spec`).

**Frontend**

- Join `last_turn` → render Interrupted state + Resume button; click pushes
  `resume_turn`.
- `turn_status` running → indicator shows on a reloaded tab; finished clears it.
- Duplicate send while running does not spawn a second turn (steer or queued chip).

## 12. File map

**New**

- `elixir/lib/symphony_elixir/assistant/turn_manager.ex` (GenServer + pid registry; reuses `GoalRun` PubSub helpers)

**Changed**

- `elixir/lib/symphony_elixir/assistant/history.ex` (metadata turn helpers: `start_turn_state/2`, `note_turn_codex/2`, `complete_turn_state/2`, `fail_turn_state/2`, `interrupt_turn_state/2`, `current_turn/1`, `turn_running?/1`, `turn_elapsed_seconds/1`, `turn_payload/1`, `reconcile_orphaned_turns/0`)
- `elixir/lib/symphony_elixir/shared_supervisor.ex` (start `TurnManager` + its registry, after `Repo`)
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (start via `TurnManager`, cross-channel steer/interrupt, join `last_turn`, `resume_turn`, `turn_status` handle_info, steer→queue branch)
- `elixir/lib/symphony_elixir/assistant/goal_run.ex` (kept as-is; `TurnManager` delegates its PubSub `subscribe`/`broadcast_from` to it)
- Frontend assistant panel + channel bindings: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, `tracker/src/services/phoenix/assistantChannel.ts`

**No new table / no migration** — durable state lives in `assistant_threads.metadata`.

**Docs (same PR if behavior/config changes)**

- `elixir/README.md` (assistant turn tracking + Resume).

## 13. Build order (independently shippable)

1. **`History` metadata turn functions** (durable layer, no behavior change yet).
2. **`TurnManager`** + `SharedSupervisor` wiring + boot reconciliation (writes metadata; channel still drives streaming).
3. **Channel start via `TurnManager`** + generalized run-tracking (refresh re-attach for all threads) + join `last_turn`.
4. **Cross-channel steer/interrupt** via registry + **steer→queue** dedup.
5. **Resume** (`resume_turn`).
6. **Frontend** (`turn_status` binding + Interrupted/Resume UI).

Each step keeps `make all` green; 1–2 are invisible to users and de-risk the rest.

## 14. Open questions / risks

- **Persistence choice (resolved):** durable state lives in
  `assistant_threads.metadata["current_turn"]` — **no new table, no migration** —
  reusing the existing `mode`/`goal_mode` metadata pattern. Only the *latest* turn
  per thread is retained; full per-turn history remains in `log/symphony.log`. If a
  queryable per-turn audit is needed later, it can be promoted to a table without
  touching the live layer.
- **`GoalRun`:** kept as-is; `TurnManager` reuses its PubSub topic helpers via
  delegation, so existing `goal_run_test.exs` stays green.
- **Metadata write races:** turn transitions reload the thread immediately before a
  targeted merge of the `current_turn` key (same read-modify-write pattern the code
  already uses for `mode`/`goal_mode`/`agent_thread_ids`). The window is small and
  acceptable.
- **Queue durability:** in-memory only (non-goal to persist). Interrupted turns are
  recoverable via Resume; queued-but-not-started messages remain in history.
- **One-turn-per-thread:** `:unique` registry assumes a single main turn per thread.
  Goal-continuation batches already serialize; confirm no flow needs concurrent
  main turns per thread.
