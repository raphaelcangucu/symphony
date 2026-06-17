# Smart Preview Port Scheme (hierarchical leased ports) — Design

- **Date:** 2026-06-15
- **Status:** Accepted
- **Author:** Symphony agent + raphaelcangucu
- **Related:** `docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md`, `docs/superpowers/specs/2026-05-31-public-preview-tunnel-design.md`

## Problem

Issue preview servers allocate a local TCP port per serve step (one per repo:
backend / goapi / frontend). Today every project declares a single shared range
in `workflow_markdown` (`dev_server.port_range`, default `[4100, 4199]`), and
`PortAllocator` linearly scans that range and grabs the **first free port**,
skipping anything `live_ports/0` reports as in use:

```8:19:elixir/lib/symphony_elixir/dev_server/port_allocator.ex
  def allocate([min, max], claimed)
      when is_integer(min) and is_integer(max) and min > 0 and max > 0 and min <= max and
             max <= 65_535 and is_list(claimed) do
    claimed_set = MapSet.new(claimed)

    min..max//1
    |> Enum.reject(&MapSet.member?(claimed_set, &1))
    |> Enum.find_value({:error, :no_free_port}, fn port ->
      if bindable?(port), do: {:ok, port}, else: false
    end)
  end
```

`live_ports/0` is **global across the whole Symphony node** — the union of ETS
port reservations and ports held by running instances, spanning all projects and
all issues:

```192:200:elixir/lib/symphony_elixir/dev_server/manager.ex
  def live_ports do
    registry_ports =
      @registry
      |> all_registered_pids()
      |> Enum.flat_map(&instance_port/1)

    Enum.uniq(reserved_ports() ++ registry_ports)
  end
```

This produces three problems for a user running **multiple projects, each with
multiple repos**:

1. **Unstable / unpredictable ports.** A port is first-come-first-served and
   re-allocated from scratch on every restart, so the same project+issue+service
   lands on a different local `http://127.0.0.1:<port>` each time — hard to
   bookmark, wire, or reason about.
2. **No project isolation.** Every project that defaults to `[4100, 4199]` draws
   from one global pool. There is no per-project ownership, so a busy project can
   crowd the shared range and starve others.
3. **No per-issue guarantee by construction.** Conflict avoidance is purely
   runtime (`bindable?` + `live_ports/0`); there is no structural guarantee that
   distinct active issues occupy distinct ports.

Concrete case: Gamba runs 3 repos (`backend`, `goapi`, `frontend`) = 3 ports per
active issue, with `max_concurrent_agents: 5` → up to ~15 simultaneous ports.
Add a second and third project on the same range and the pool silently overlaps.

Public-tunnel previews already use stable **hostnames**
(`label.namespace.base_domain`) and are unaffected by port churn; this design
makes the **local** ports stable and isolated too.

## Goals

- **Deterministic per-project bands**: each project owns a contiguous,
  non-overlapping port band; two projects never compete for the same ports.
- **Stable per-service ports**: while an issue's preview is running, a given
  project+issue+service always resolves to the same local port (predictable,
  bookmarkable, easy to wire).
- **Per-issue isolation by construction**: distinct active issues in the same
  project occupy distinct, leased slots — no structural overlap.
- **Bounded, recyclable usage**: ports are leased while running and recycled
  when stopped, so a finite pool serves an unbounded stream of issues over time.
- **Zero-config defaults** that survive restarts, with optional explicit pinning.
- **Backward compatible**: a project that already sets `dev_server.port_range`
  keeps working (its range becomes a pinned band, still carved into the new
  slot/offset structure).

## Non-Goals

- Changing public-tunnel hostname routing (`PublicRouting`) — preview hostnames
  are already stable and remain the canonical external URL.
- Permanently reserving a unique port for *every issue that ever exists*
  (rejected: issue ids are large/sparse/unbounded; see Approach). Stability is
  guaranteed **while the issue's preview is running**, not across close/reopen.
- A UI for managing bands/slots. Leasing is automatic; observability is
  out of scope beyond logging.
- Cross-host / multi-node coordination. The pool is per Symphony node.
- Reworking serve-step discovery, tmux session handling, readiness probing, or
  the idle-timeout lifecycle.

## Approach (chosen)

**Two-level lease + positional service offset.** A project leases a fixed-size
**band** from one node-level pool; each running issue leases a **slot** inside
its project's band; each serve step occupies a fixed positional **offset** inside
the slot. The port is *computed*, not searched:

```
port = band_start
     + slot_index   × PORTS_PER_SLOT
     + service_offset
```

The runtime `bindable?` / `live_ports/0` check is retained only as an in-flight
collision guard and fallback (e.g. a non-Symphony process squatting the port).

Alternatives considered and rejected:

- **Deterministic hash of issue id → slot.** Stable across close/reopen, but two
  active issues can hash to the same slot and the probe fallback breaks
  determinism exactly when isolation matters most.
- **Slot = issue-number mod band size.** Simplest, but active issue numbers
  cluster, giving a high collision rate.
- **Hand-assigned static per-project ranges.** Full control, but the user must
  manually keep ranges non-overlapping across a growing set of projects.

The lease model gives the predictability of a formula with the bounded,
collision-free guarantees of explicit allocation.

## Design

### 1. The global preview pool (node-level config)

A new node-level setting, since the pool spans projects. It lives in
`SymphonyElixir.Config` / `InstanceConfig` (`SYMPHONY_*` env), **not** in
per-project `workflow_markdown`:

| Setting | Env | Default | Meaning |
|---|---|---|---|
| pool range | `SYMPHONY_PREVIEW_POOL` | `10000-30000` | Inclusive `[start, end]` the bands are carved from |
| slots/project | `SYMPHONY_PREVIEW_SLOTS_PER_PROJECT` | `32` | Concurrent issue slots per band |
| ports/slot | `SYMPHONY_PREVIEW_PORTS_PER_SLOT` | `8` | Ports reserved per issue slot (≥ a project's serve-step count) |

Derived: `BAND_SIZE = SLOTS_PER_PROJECT × PORTS_PER_SLOT = 256`, and
`MAX_BANDS = floor((end - start + 1) / BAND_SIZE)` ≈ `78` bands for the default
pool. Rationale for `10000-30000`: below the Linux default ephemeral range
(`32768-60999`) to avoid bind races, and clear of crowded dev ports
(`3000`/`5173`/`8000`/`8080`).

### 2. The addressing formula

```
band_start(project)        = pool_start + band_index(project) × BAND_SIZE   (auto-leased)
                           | port_range_min(project)                        (pinned)
service_offset(step)       = index of the step in the project's stable serve-step order
port(project, issue, step) = band_start + slot_index(issue) × PORTS_PER_SLOT + service_offset(step)
```

- **`band_index`** ∈ `[0, MAX_BANDS-1]` (auto-leased projects).
- **`slot_index`** ∈ `[0, SLOTS_PER_PROJECT-1]`.
- **`service_offset`** ∈ `[0, PORTS_PER_SLOT-1]`, the positional index of the
  serve step within `Manager.unique_serve_steps/3` order (already deterministic,
  ordered by configured step position). Stable across restarts; deliberately
  reordering/removing serve steps may reshuffle offsets (a config-change event,
  acceptable and logged).

Worked example — Gamba, band `#0` at `10000`, `PORTS_PER_SLOT=8`, steps
`backend`(0) / `goapi`(1) / `frontend`(2):

| Issue slot | backend | goapi | frontend |
|---|---|---|---|
| slot 0 | 10000 | 10001 | 10002 |
| slot 1 | 10008 | 10009 | 10010 |

The next auto-leased project gets band `#1` at `10256`.

A pure module `SymphonyElixir.DevServer.PortPlan` implements the formula
(`band_start/slot/offset → port`, plus `services` count validation against
`PORTS_PER_SLOT`). No process state, fully unit-testable.

### 3. Two-level leases (DB-persisted, survive restarts)

A DB-backed `SymphonyElixir.DevServer.LeaseStore` owns assignment. Two small
tables (new migrations):

- **`preview_project_bands`** — `project_id` (unique) → `band_index`. Assigned
  once, the first time a project runs any preview; reused forever. Pinned
  projects (`port_range` set) do **not** consume a band index.
- **`preview_issue_slots`** — `(project_id, identifier)` → `slot_index`, with a
  unique constraint on `(project_id, slot_index)` among **active** rows. Acquired
  when an issue's preview first starts; released when the issue's previews stop
  or the issue reaches a terminal state.

Lease acquisition is the **lowest free index** (band or slot), under the existing
`:global.trans({Manager, :start_for_issue}, …)` lock so concurrent starts can't
double-assign. The current ETS reservation table + `bindable?` stay as the
same-instant, in-flight guard layered on top of the durable lease.

### 4. Lease lifecycle & GC

- **Acquire band**: lazily on first preview start for the project (auto-leased
  only). Idempotent.
- **Acquire slot**: on `start_for_issue` / `start_instance_for_server` when the
  issue has no active slot. Idempotent — re-uses the issue's existing slot while
  any of its instances run.
- **Release slot**: on `stop_for_issue` when the issue has no remaining running
  instances. The band lease is **not** released (project keeps its band).
- **Startup reconcile**: `Manager.init/1` already marks all instances stopped
  (`mark_all_stopped_safely`). Slot lease rows are **kept** so a still-open issue
  re-leases the *same* slot on its next start (max stability across a Symphony
  restart). They are reclaimed by GC, not by boot.
- **GC**: a reconciler releases slots for issues in terminal/closed states (or
  with no running instances past an idle horizon), preventing slot leaks for
  issues that never get an explicit stop. Hooks into the existing dev-server
  reconciler (`SymphonyElixir.DevServer.Reconciler`).

### 5. Allocation flow (replaces `Manager.reserve_ports/4`)

On start, for an issue with serve steps `[s0, s1, …]`:

1. Resolve `band_start` for the project: pinned `port_range` min, else
   ensure/lookup the auto-leased `band_index`.
2. Ensure the issue's `slot_index` (lookup or lease lowest-free).
3. Build the issue's **owned ports** map (`slug -> port`) from its
   `DevServerRecord`s — the port each service was last assigned.
4. For each step, compute the **preferred** port via `PortPlan`.
5. **Reclaim own port:** if the preferred port equals the step's owned port and
   is not in `live_ports/0`, take it directly — skip the `bindable?` probe. A
   service's own previously-assigned port is not a conflict for that service,
   even when a long-lived resource it manages (e.g. a shared docker container
   that is not torn down on stop) still holds it. Without this, the probe would
   treat the service's own lingering port as occupied and drift it onto the next
   free port, colliding with sibling services — a +1 ratchet on every restart.
6. Otherwise verify the preferred port is free (`bindable?` **and** not in
   `live_ports/0`).
7. **Fallback** when a preferred port is occupied by something that isn't the
   service's own (e.g. external process): probe forward within the slot, then
   within the band, then — auto-leased projects only — anywhere in the pool
   that's free. Log a structured warning noting the displaced step and chosen
   port. Never hard-fail while a port is physically available.
8. Reserve the chosen ports in ETS (unchanged) and proceed to
   `start_instances/5`.

`Instance` keeps receiving a concrete port via the injected
`port_allocator: fn _range, _claimed -> {:ok, port} end` closure (the manager
already pre-computes and injects ports), so `Instance` itself is unchanged.

### 6. Config schema & backward compatibility

Per-project `dev_server.port_range` semantics change from "the pool to scan" to
"an explicit **pin**": when set, that exact range is the project's band and is
carved into `floor((max - min + 1) / PORTS_PER_SLOT)` slots × service offsets.
Gamba's current `[4100, 4199]` (100 ports) → 12 slots, **no config edit
required**, and it immediately gains stable per-issue/per-service ports. Dropping
`port_range` opts the project into the auto-leased high pool.

```yaml
# Pinned (legacy-compatible): band = this exact range
dev_server:
  enabled: true
  port_range: [4100, 4199]

# Auto-leased (new default): omit port_range entirely
dev_server:
  enabled: true
```

A pinned band provides `floor(range_size / PORTS_PER_SLOT)` slots. If the range
is too small to fit even a single slot (`range_size < PORTS_PER_SLOT`), the
allocator logs a warning and falls back to legacy linear scan within that range.

### 7. Code touch points

- **New** `SymphonyElixir.DevServer.PortPlan` — pure formula + validation.
- **New** `SymphonyElixir.DevServer.LeaseStore` — band/slot lease CRUD over the
  two new tables; lowest-free assignment; release; active-slot queries.
- **New** migrations: `preview_project_bands`, `preview_issue_slots`.
- `SymphonyElixir.Config` / `InstanceConfig` — pool range, slots/project,
  ports/slot (node-level, env-backed).
- `SymphonyElixir.DevServer.Manager` — `reserve_ports/4` rewritten to
  lease → plan → verify/fallback; `stop_for_issue/2` releases the slot lease;
  `do_start_instance_for_server/4` reuses the issue's slot.
- `SymphonyElixir.DevServer.Reconciler` — slot GC for terminal/stale issues.
- `SymphonyElixir.DevServer.PortAllocator` — retained; `bindable?` + range scan
  become the fallback primitive (no behavior change to the function itself).

## Edge cases & error handling

- **All bands leased** (auto): log a warning and fall back to a free-port scan
  across the pool for that project (degraded, no isolation) rather than failing.
- **All slots leased** for a project: same fallback — scan the band, then pool.
- **Preferred port externally occupied**: forward-probe per §5.7; warn with the
  displaced step + chosen port.
- **Service owns a long-lived resource on its port** (e.g. a shared docker
  container the serve step maps to the issue's `PORT` and that survives a stop):
  the service reclaims its own canonical port per §5.5 instead of drifting. This
  is what lets a project bind a shared container directly to the per-issue port
  (no forwarder) without ratcheting on restart.
- **Serve steps reordered/removed**: offsets recompute from the new order
  (positional). Running instances are unaffected until restart; logged.
- **`PORTS_PER_SLOT` < serve-step count**: configuration error — log and fall
  back to legacy scan for that project; surface in startup validation.
- **Pinned `port_range` too small for one full slot**: legacy linear scan within
  the range (preserves today's behavior exactly).
- **Stale slot leases after a crash**: reclaimed by the reconciler GC; ETS
  reservations are already cleaned per dead-pid sweep.
- **Concurrent starts**: serialized by the existing `:global.trans` lock around
  lease acquisition, so lowest-free assignment is race-free.

## Testing plan

Unit tests (no real sockets where avoidable; inject allocator/lease deps):

- `PortPlan`: formula correctness across band/slot/offset combinations; offset
  bounds vs `PORTS_PER_SLOT`; pinned vs auto band_start; rejects offset ≥
  ports/slot.
- `LeaseStore`: lowest-free band assignment + persistence/reuse; lowest-free slot
  assignment; release frees the slot; unique active-slot constraint; idempotent
  re-acquire returns the same index.
- `Manager.reserve_ports/4`: stable ports for the same project+issue+service
  across repeated start/stop; distinct active issues get distinct slots; external
  occupancy triggers forward-probe; pinned `port_range` carves slots; oversized
  serve-step count falls back; band/slot exhaustion falls back to scan.
- `Manager.stop_for_issue/2`: releases the slot lease only when no instances
  remain.
- Reconciler GC: terminal/stale issue slots are released; active ones retained.
- Regression: existing `dev_server/manager_test.exs`, `dev_server_test.exs`,
  `dev_server/instance_test.exs`, and `preview_proxy_body_test.exs` still pass.

Full gate before handoff: `cd elixir && make all` and `cd elixir && mix specs.check`.

Docs to update in the implementation PR (per `elixir/AGENTS.md` policy):
`elixir/README.md` (`workflow_markdown` / dev_server config + new node-level
preview pool settings), `.env.example` (the three `SYMPHONY_PREVIEW_*` vars), and
`SPEC.md` if preview behavior is described there.

## Out of scope (called out, not silently skipped)

- Multi-node / cross-host pool coordination.
- A management UI for bands/slots or a port map view.
- Stable ports across an issue close→reopen (only stable while running).
- Changing public-tunnel hostnames or proxy routing.
- Reworking serve-step discovery, tmux, probing, or idle-timeout semantics.
