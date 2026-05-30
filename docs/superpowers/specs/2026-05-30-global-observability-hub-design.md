# Global Observability in the Tracker (Hub Model)

- **Status:** Draft (pending user review)
- **Date:** 2026-05-30
- **Author:** Brainstorm session
- **Related:** `lib/symphony_elixir_web/live/dashboard_live.ex`, `lib/symphony_elixir_web/router.ex`, tracker SPA (`tracker/`)

## Problem

The Operations Dashboard at `/` (`SymphonyElixirWeb.DashboardLive`) shows live runtime
state for **one** orchestrator process bound to **one** `WORKFLOW.md`. It reads the global,
in-memory `Orchestrator.snapshot/2`, so it is structurally single-workflow.

We want **global observability**: see agent/runtime activity across **all** projects in one
place, inside the tracker SPA. The intended deployment is **many Symphony processes, one per
project** (each with its own `WORKFLOW.md`, port, and runtime). Observability must aggregate
those runtimes into a single view.

## Goals

1. A single, always-available URL aggregates runtime state from many orchestrator processes.
2. The aggregate lives **inside the tracker SPA** (not a separate LiveView surface).
3. Adding/removing a project's orchestrator process does not require touching the hub.
4. A worker process going offline is reflected (stale/removed), not shown as a phantom.
5. Reuse existing auth (bearer token) and Phoenix channels; keep volatile runtime state out of
   the durable tracker SQLite DB.
6. **Preserve the realtime feel of running sessions** from the old dashboard: (a) near-instant
   updates when an orchestrator's state changes (new agent event/message, token usage), and
   (b) the per-second ticking runtime/turns clock in the browser.

## Non-goals (v1 — YAGNI)

- Time-series **history / persistence** of observability snapshots (keep last snapshot only).
- Remote control actions from the hub (pause/refresh another runtime).
- Automatic worker discovery (each worker is configured with `hub_url`).

## Chosen approach: Hub (PUSH) + in-memory aggregate

Among three topologies considered:

- **Hub (PUSH) + in-memory aggregate — chosen.** Workers `POST` their snapshot to a central
  hub; the hub holds the latest snapshot per runtime in ETS and pushes live updates to the
  browser over a Phoenix channel.
- **Shared SQLite store — rejected.** SQLite is single-writer; multiple BEAM nodes writing
  causes lock contention; requires same host/filesystem; conflicts with the per-workflow DB
  model; mixes volatile state into the durable DB.
- **Decentralized peers (PULL/fan-out) — rejected.** Discovery of live peers is fragile; the
  browser cannot fan out to N origins/ports (CORS, per-port auth, mixed content), forcing a
  gateway that effectively becomes the hub anyway; live updates are harder.

**Hub identity:** the existing process serving `http://localhost:4000` (which already serves
the tracker SPA, `/api/tracker/v1`, and Phoenix channels) is the hub. Any Symphony process can
be a hub simply by serving these endpoints; the hub does not require an orchestrator. A hybrid
hub (hub + its own orchestrator) self-registers its own runtime **in-process** (no loopback HTTP).

## Architecture

```
  Worker A (projeto-a, :4001)        Worker B (projeto-b, :4002)
   Orchestrator + Reporter            Orchestrator + Reporter
            │  POST snapshot                    │  POST snapshot
            └───────────────┬───────────────────┘
                            ▼
                 HUB (process :4000)
        ┌─────────────────────────────────────┐
        │ Observability.Registry (GenServer+ETS)│  last snapshot per runtime + ts
        │ POST /api/tracker/v1/observability/* │  receives reports (bearer auth)
        │ ObservabilityChannel (observability:global) push to browser
        │ Tracker SPA → /tracker/observability │
        └─────────────────────────────────────┘
              ▲ (hybrid hub self-registers in-process)
```

## Backend changes (Elixir)

### `SymphonyElixir.Observability.Registry` (new)

GenServer backed by an ETS table.

- State per runtime: `%{runtime_id, project_slug, workflow_name, tracker_kind, agent_kind,
  source_url, snapshot, reported_at, status}`.
- `put_report(runtime_id, payload)` — upsert, stamp `reported_at = now`, broadcast
  `runtime_updated`.
- `list/0` — returns all entries with derived `status`.
- Periodic sweep: mark `stale` when `now - reported_at > stale_after_ms`; remove and broadcast
  `runtime_removed` when `> drop_after_ms`.
- `runtime_id`: stable per worker (e.g. hash of `workflow_file_path` + project slug, or a
  configured `observability.runtime_id`). Re-reports from the same worker upsert in place.

### HTTP endpoints (pipeline `:tracker_api`, existing `TrackerAuth` bearer plug)

New controller `SymphonyElixirWeb.Tracker.ObservabilityController`:

| Method | Route | Action |
|--------|-------|--------|
| `POST` | `/api/tracker/v1/observability/report` | Validate body, `Registry.put_report/2`, return 202 |
| `GET`  | `/api/tracker/v1/observability` | Return aggregate list (initial page load) |

Report body (JSON): `runtime_id`, `project_slug`, `workflow_name`, `tracker_kind`,
`agent_kind`, `source_url`, and `snapshot` (the serialized `Presenter.state_payload` shape:
`counts`, `agent_totals`, `rate_limits`, `running[]`, `retrying[]`). Inputs validated at the
controller boundary; malformed reports return 422.

### `ObservabilityChannel` (new)

- Topic `observability:global` on the existing `UserSocket` (token auth on connect).
- Pushes `runtime_updated` (single runtime payload) and `runtime_removed` (`runtime_id`).
- On join, may push the current aggregate snapshot.

### Worker reporter (new)

`SymphonyElixir.Observability.Reporter` — event-driven reporter (GenServer) in worker
processes, preserving the old dashboard's realtime push.

- Enabled when `observability.hub_url` is configured (or always for hybrid hub via in-process
  self-register).
- **Event-driven push:** subscribes to `ObservabilityPubSub` (the same source the old
  `DashboardLive` used). On `:observability_updated`, immediately builds the payload from
  `Orchestrator.snapshot/2` (reuse `Presenter.state_payload`) and reports it. This keeps running
  sessions near-realtime instead of waiting for the next interval.
- **Heartbeat:** also reports every `heartbeat_interval_ms` regardless of changes, so the hub
  can distinguish "no changes" from "worker dead" (liveness) and refresh rate-limit snapshots.
- **Debounce/coalesce:** if updates arrive faster than `min_report_interval_ms`, coalesce to
  avoid flooding the hub; always send the latest snapshot.
- Delivery: `POST` to `hub_url <> "/api/tracker/v1/observability/report"` with the bearer
  token. On the hub itself, register in-process instead of HTTP loopback.
- Failures (hub down) are logged and retried on the next event/heartbeat; never crash the
  orchestrator.

### Config (`SymphonyElixir.Config` / `WORKFLOW.md`)

```yaml
observability:
  hub_url: http://localhost:4000     # absent + hub role ⇒ self
  heartbeat_interval_ms: 5000        # liveness floor; updates also pushed on change
  min_report_interval_ms: 250        # coalesce bursts of change events
  runtime_id: optional-stable-id     # optional; derived if absent
  # token reuses SYMPHONY_TRACKER_TOKEN (or local.api_token_env)
```

- No `observability:` section ⇒ current behavior (no reporting).
- Add accessors via `SymphonyElixir.Config` (no ad-hoc env reads), with defaults:
  `heartbeat_interval_ms = 5000`, `min_report_interval_ms = 250`,
  `stale_after_ms ≈ 3 × heartbeat`, `drop_after_ms = 60000`.

### Routing / retirement of the old surface

- `router.ex`: remove `live("/", DashboardLive)`; `/` **redirects to `/tracker`**.
- Remove `SymphonyElixirWeb.DashboardLive` (its UI migrates to the SPA).
- Keep `/api/v1/state`, `/api/v1/:issue_identifier`, `/api/v1/refresh` for now (back-compat);
  the reporter does not depend on them (uses in-process `Orchestrator.snapshot/2`).
- Decide later whether the dashboard CSS/vendor static routes are still needed once the
  LiveView is gone (the SPA does not use them).

## Frontend changes (tracker SPA)

- **Route:** `/observability` (under Vite base `/tracker/`) inside the global `Layout`
  (sibling of `/projects` and `/templates`).
- **Sidebar:** add an "Observability" nav item in `ProjectSidebar`.
- **Page layout (option C):**
  - **Top:** one card/row per runtime+project — project name, ITS/agent kind, `running`,
    `retrying`, total tokens, runtime, **online/stale** badge, "updated Xs ago".
  - **Bottom:** a single **global active-sessions table** — project column + the existing
    dashboard columns (issue, state, session, runtime/turns, agent update, tokens).
- **Service:** `services/observability.ts` (`http` + `trackerPath` + `unwrapData`); types in
  `types/observability.ts`; snake→camel normalization in `mappers.ts`.
- **Realtime:** `useObservability` hook — initial load via `GET /api/tracker/v1/observability`,
  then subscribe to `observability:global`, upserting/removing by `runtime_id`. Add the topic
  to the channels module alongside existing project channels. Channel `runtime_updated` events
  arrive near-instantly because workers push on change (not only on heartbeat).
- **Client-side runtime tick:** a 1s interval in the page recomputes each running session's
  runtime/turns clock from `startedAt` (mirrors the old `DashboardLive` `:runtime_tick`), so the
  elapsed time counts up smoothly between server updates without extra traffic.

## Data shapes

```ts
interface RuntimeObservability {
  runtimeId: string;
  projectSlug: string;
  workflowName: string;
  trackerKind: string;
  agentKind: string;
  sourceUrl: string | null;
  status: "online" | "stale";
  reportedAt: string;            // ISO
  counts: { running: number; retrying: number };
  agentTotals: { totalTokens: number; inputTokens: number; outputTokens: number; secondsRunning: number };
  rateLimits: unknown | null;
  running: RunningSession[];     // includes projectSlug for the flat global table
  retrying: RetryEntry[];
}
```

## Lifecycle / freshness

- Reports are **event-driven** (pushed on orchestrator change) with a `heartbeat_interval_ms`
  floor (default 5000ms) for liveness.
- `stale` after ~3 missed heartbeats; **removed** from the aggregate after `drop_after_ms`
  (default 60000ms). Ensures a dead worker stops polluting the global view.

## Risks / open considerations

- **Runtime identity stability** across worker restarts: must reuse the same `runtime_id` to
  avoid duplicate rows. Mitigation: derive from `workflow_file_path` + project slug, or accept
  configured `runtime_id`.
- **Clock skew** between hosts affects "updated Xs ago"; staleness uses hub-side `reported_at`
  (stamped on receipt), not worker clocks, to avoid skew.
- **Token sharing** across processes: all workers and the hub must share the same bearer token
  (or the hub must accept each worker's token). v1 assumes a shared `SYMPHONY_TRACKER_TOKEN`.
- **Payload size**: snapshots with many running sessions could grow; acceptable at expected
  scale, revisit if needed.

## Testing strategy

- `Observability.Registry`: upsert, staleness transition, drop-after-TTL, broadcast on change.
- `ObservabilityController`: auth required; valid report ⇒ 202 + registry updated; malformed ⇒
  422; `GET` returns aggregate.
- `Reporter`: pushes immediately on `ObservabilityPubSub` `:observability_updated`; also sends
  heartbeats; coalesces bursts within `min_report_interval_ms`; tolerates hub failures.
- SPA: `useObservability` initial load + channel upsert/remove; client-side 1s runtime tick
  increments elapsed time between updates; page renders cards + global table; stale badge logic.
- Routing: `/` redirects to `/tracker`; `DashboardLive` removed without breaking the endpoint.
