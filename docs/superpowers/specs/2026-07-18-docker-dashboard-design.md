# Docker dashboard in the tracker UI

**Date:** 2026-07-18
**Status:** Approved (design accepted in chat; user requested immediate plan)
**Surfaces:** Tracker page `/docker`, Phoenix tracker API, new `SymphonyElixir.Docker` module

## 1. Problem

The developer runs dozens of Docker containers across many worktrees (GambaLabs,
Advising CDE-*, Macro Markets, Macro Wallets, Scheduler). Docker Desktop shows them
flat with cryptic compose-project names (`docker`, `back`, `backend`) and no link to
the codebase each container serves. Symphony's tracker has no Docker visibility.

## 2. Decision

Add a small Docker dashboard as a tracker page backed by the local Docker CLI:

- **Backend (Approach A):** a thin `SymphonyElixir.Docker` module shells out to the
  `docker` CLI (`ps`, `stats`, `start/stop/restart/rm`) via an injectable command
  runner. No new dependencies, no Docker Engine socket plumbing, no event streaming.
- **Endpoints** (tracker API scope, token-authenticated like every other tracker route):
  - `GET /api/tracker/v1/docker/containers` — merged `ps -a` + `stats --no-stream`
    snapshot: id, name, image, state, status, ports, created-at, compose project,
    compose working dir (the codebase path answer), CPU%, memory usage.
  - `POST /api/tracker/v1/docker/containers/:id/:command` — whitelist
    `start | stop | restart | remove`; `remove` accepts `{"force": true}` for
    running containers. Container ids are validated as hex before reaching the shell.
- **Frontend:** `DockerPage` at route `/docker`, sidebar entry next to Observability.
  Flat sortable table (user's choice) with columns: status dot + Name, Compose
  project, Path (compose working dir, shortened), Image, Status, Ports, CPU%, Mem.
  Search box, "only running" toggle, 5s polling paused while the tab is hidden.
  Row actions contextual to state (start / stop / restart), remove behind a confirm
  dialog (forces removal when the container is running).

## 3. Error behavior

- Docker daemon unreachable / CLI missing → `GET` still returns 200 with
  `{available: false, error: <message>, containers: []}`; the page renders an inline
  error state with the message; polling keeps retrying.
- Invalid command or container id → 422 with `error.code`
  `invalid_action` / `invalid_container_id`.
- Docker action failure (nonzero exit) → 502 `docker_action_failed` with the CLI
  stderr as message; the page surfaces it inline.

## 4. Out of scope

- Logs viewer, per-container detail pane, image/volume/network management.
- Live push (docker events / Phoenix channels) — polling is enough.
- Mapping containers to Symphony issues/worktrees beyond showing the compose
  working dir path.
- `SPEC.md` / README changes: this is a local-only convenience superset of the spec.

## 5. Tests (WSL: one file/filter at a time, sequential)

- `elixir/test/symphony_elixir/docker_test.exs` — ps/stats JSON parsing and merge,
  compose label extraction, id/action validation, daemon-down error path (fake
  runner injected via app env `:docker_runner`).
- `elixir/test/symphony_elixir_web/controllers/tracker/docker_controller_test.exs` —
  auth required, index payload shape, command whitelist, force remove pass-through.
- `tracker/src/services/__tests__/docker.test.ts` — DTO mapper and table sorting
  comparator.
