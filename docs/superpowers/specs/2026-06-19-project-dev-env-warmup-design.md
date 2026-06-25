# Project Dev-Env Warm-up ("Preparar ambiente") — Design

> Lets a user **prepare a freshly-configured project's dev environment once,
> before any task starts** — pulling/building the heavy images, logging in to the
> registry, resolving Docker conflicts, and proving the stack boots healthy for a
> **standardized default tenant** — by opening a **project assistant chat session**
> that runs a **deterministic warm-up tool** and, only when something is off,
> continues fixing it in the same thread. Built by **reusing the existing `DevEnv`
> run engine, the `DevServer` per-workspace runtime, the `.symphony/` scripts, and
> the project Assistant + its `manage_dev_env` tool** — not by adding a parallel
> system.

## 1. Problem

When a project is configured in Symphony (repos linked, workflow + dev-env steps
saved) but **no task has been started yet**, the host is cold: the app images
are not pulled/built, the registry isn't logged in, `docker/.env` may still hold
placeholders, shared singletons aren't up, and (for multi-tenant apps like
`advising`/Inspire) the tenant DB isn't seeded. The **first** task then pays for
all of this at preview time — and, as we just lived through on `advising`
(CDE-1139), it fails in confusing ways: a missing `.symphony/` directory, ECR
`403` from placeholder AWS creds, Docker container-name/host-port conflicts, and
a `/health` probe that silently falls back to the wrong vhost.

There is no first-class, **project-level "prepare this environment once"** action.
The `DevEnvPanel` can run steps, but nothing pulls the heavy images ahead of time,
nothing validates an end-to-end boot, nothing tracks "is this project ready?",
and there is no guided recovery when prerequisites are missing.

## 2. Goal

1. A **one-time, project-level warm-up** ("Preparar ambiente") that a user can
   trigger after configuring a project and before starting any task.
2. **Full dry-run confidence**: warm-up runs the project's setup, boots the full
   stack once on an ephemeral port, confirms a **tenant-aware `/health`**, then
   **tears the app down** — leaving images cached and shared singletons warm.
3. **Hybrid execution inside a project chat session**: the warm-up is driven by a
   **deterministic tool** the project Assistant calls; the happy path is one tool
   call (no hand-authored boot), and on failure the **same thread** continues with
   the Assistant diagnosing and fixing (creds, scaffolding scripts, conflicts).
4. **Readiness state + proactive nudge**: Symphony records `warmed_at` / status and
   surfaces a banner on the project when it has never been warmed (or the last
   warm-up failed), with a re-run control in the `DevEnvPanel`.
5. **Standardize the default tenant** (`illume` for advising) so health is tenant
   aware by default and per-task tenant overrides are the explicit exception,
   communicated in the task description.
6. **Reuse, don't duplicate**: build on `DevEnv`, `DevServer.Manager`, the
   `.symphony/` scripts (incl. the `ecr_login` / shared-conflict helpers already
   added), `Assistant.DevEnvTools` (`manage_dev_env`), `Assistant.SetupTools`, and
   project-scoped assistant threads.

## 3. Non-goals

- **Auto-triggering** the warm-up the moment a project is configured (rejected:
  pulling GBs of images without explicit consent). Warm-up is user-initiated.
- **Multi-repo orchestration** beyond what `scan_project_setup` /
  `suggest_project_setup` already provide.
- **Scheduled re-warm / image cache GC / staleness by commit SHA.** Out of scope;
  readiness is a simple `never | running | succeeded | failed` + timestamp.
- **Remote / cross-host warm-up.** Single-user, localhost-first, like the rest of
  Symphony.
- **Replacing the per-issue preview** (`DevServer.Manager` `start_for_issue`). The
  warm-up is a transient, project-scoped boot that always tears the app back down.
- **Owning credential storage.** Warm-up *uses* host creds (AWS profile first,
  then `docker/.env`); when they're missing it asks the user — it does not invent
  a secret store.

## 4. Decisions

- **D1 — Hybrid, assistant-orchestrated via a deterministic tool.** The button
  opens/creates a project-scoped Assistant thread seeded with a bootstrap prompt;
  the Assistant calls a new **`warm_up`** action (assistant-only) on the existing
  `manage_dev_env` tool. The tool performs the entire boot→health→teardown in one
  call and returns a compact structured result. The LLM only narrates on success
  and only *acts* on failure. (Chosen over a backend job streaming into the thread:
  the tool-result is itself the natural, automatic failure handoff.)
- **D2 — Full dry-run is the warm-up.** Reuse `serve.sh` with a new
  `SYMPHONY_WARMUP=1` mode: after `/health` passes, tear the app down and exit 0
  instead of following logs forever. Optional override: if `.symphony/warmup.sh`
  exists, run it instead. This reuses the script we already hardened (ECR login,
  shared-singleton conflict handling, port remap) with minimal new surface.
- **D3 — Transient, isolated compose project.** Warm-up boots under a dedicated
  `COMPOSE_PROJECT_NAME=<slug>-warmup` from the project base checkout
  (`Config.workspace_root()/<slug>`), on an **ephemeral port** from the existing
  preview port allocator, reusing `adopt_foreign_shared_containers` +
  `ensure_shared_host_ports`. Teardown removes the `<slug>-warmup` app stack;
  shared singletons + cached images stay.
- **D4 — Default tenant `illume`, authoritative health.** Add a project-level
  `preview_tenant` (default `illume`, configurable). `serve.sh` / `verify-health.sh`
  / warm-up probe `Host: <preview_tenant>.localhost`. When a `preview_tenant` is
  set, `check_backend_health` no longer **silently falls back** to bare localhost
  (which hits the first vhost / kiosk and masks tenant problems). Per-issue
  override via `SYMPHONY_PREVIEW_TENANT`, only when the task is tenant-specific
  (derived from the task description).
- **D5 — Warm-up ensures the default tenant DB is usable.** The dry-run is only
  meaningful if `illume`'s DB exists/seeded. Warm-up includes a DB-readiness step
  (create-if-missing + seed/import) — exact path (dump import vs. `illumepg.py`
  feed) confirmed during plan-writing; if no seed path is configured, this is a
  recoverable `failure_class` the Assistant surfaces rather than a hard crash.
- **D6 — Missing scripts → `needs_scaffold` → Assistant scaffolds.** If the repo
  has no `.symphony/` (or no dev-env steps), the tool returns
  `failure_class: needs_scaffold`; the Assistant scaffolds a **canonical
  `.symphony/` template** (derived from the advising set) adapted via
  `scan_project_setup` / `suggest_project_setup`, proposes a commit/PR, then
  re-runs `warm_up`. Script generation lives in the Assistant, not the
  deterministic core.
- **D7 — Readiness is project-level state, not per issue.** Persist
  `warmed_at`, `warm_up_status`, `last_warm_up_run_id` on the project (reusing a
  `DevEnv.Run` marked `kind: "warm_up"`). Exposed on the project API for the banner.
- **D8 — Assistant-only capability.** `warm_up` is in `@assistant_actions` only,
  never `@coding_agent_actions`. Coding agents keep `list_steps | run | run_step |
  list_runs`.

## 5. Architecture & flow

```
[Project page]
  └─(no warmed_at / last failed)→ Banner "Preparar ambiente"
        └─click→ POST /tracker/projects/:slug/dev_env/warm_up/start
              1. ensure/seed a project-scoped Assistant thread (scope="project")
                 with a structured bootstrap prompt
              2. respond with { thread_id }
              3. navigate → ProjectAssistantRoute(thread_id)

[Project Assistant thread]
  Assistant → manage_dev_env { action: "warm_up" }
     → DevEnv.warm_up(slug):
         start_run(kind: warm_up)
         step: setup       (.symphony/setup.sh → docker/.env, ecr_login, deps)
         step: db-ready     (create-if-missing + seed default tenant)
         step: serve-dryrun (SYMPHONY_WARMUP=1 serve.sh on <slug>-warmup @ephemeral)
                 → wait Host: illume.localhost /health
                 → ./vibe down (<slug>-warmup)
         finish_run → update project { warmed_at, warm_up_status, last_warm_up_run_id }
         return { status, failure_class?, steps[], port, log_ref, remediation? }

  success → Assistant narrates "✅ ambiente pronto"
  failure → Assistant reads failure_class + log_ref and fixes in-thread:
              image_pull_auth        → refresh/ask for creds (AWS profile first)
              container_name_conflict→ inspect docker ps, free names
              port_allocation        → re-resolve host ports
              needs_scaffold         → scaffold .symphony/ template, propose commit
              db_not_seeded          → run/seed default-tenant DB
              health_timeout         → read logs, surface likely cause
            → re-call manage_dev_env { warm_up } (loop until ok or blocking question)
```

## 6. Backend changes

- **`Assistant.DevEnvTools`** (`manage_dev_env`):
  - add `:warm_up` to `@assistant_actions` (not `@coding_agent_actions`); extend
    `normalize_action/1`, `authorize_action/2`, `action_input_schema/2`, and
    `execute_action(:warm_up, ...)` → `DevEnv.warm_up/2`.
  - `warm_up` result shape: `%{tool, message, data: %{run, status, failure_class,
    port, steps, log_ref, remediation}}`.
- **`SymphonyElixir.LocalTracker.DevEnv`**: `warm_up/2` orchestrates
  `start_run` (kind `warm_up`) → setup steps → DB-ready → transient serve dry-run →
  teardown → `finish_run` → project readiness update. Reuses `DevEnv.Runner` for
  step execution and the `DevServer`/port allocator for the ephemeral port.
- **`DevServer.Manager`**: reuse `serve_step_with_setup/2` /
  `setup_command_for_workspace/2` to build the dry-run command with
  `SYMPHONY_WARMUP=1`, `COMPOSE_PROJECT_NAME=<slug>-warmup`, and the allocated
  port; ensure teardown of `<slug>-warmup` on completion **and** on failure.
- **Readiness fields** on the project (migration): `warmed_at:utc_datetime_usec`,
  `warm_up_status:string`, `last_warm_up_run_id` (FK → `DevEnv.Run`); presenter +
  project API expose them. `DevEnv.Run` gains a `kind` column (`run | warm_up`).
- **Thread bootstrap endpoint**: `POST /tracker/projects/:slug/dev_env/warm_up/start`
  ensures a `scope: "project"` thread, posts the seed bootstrap prompt, returns
  `{ thread_id }`.

## 7. `.symphony/` convention changes (in target repos)

- **`serve.sh`**: honor `SYMPHONY_WARMUP=1` — after `/health` passes, run the
  existing `cleanup`/`vibe down` and exit 0 (skip `docker logs -f` + `wait`).
- **`common.sh`**: `PREVIEW_TENANT` default resolved from
  `SYMPHONY_PREVIEW_TENANT` else the project default (`illume`); when a tenant is
  set, `check_backend_health` probes only `Host: <tenant>.localhost` (no silent
  bare-localhost fallback). `wait-healthy.sh` / `verify-health.sh` inherit this.
- **Optional `.symphony/warmup.sh`**: if present, used instead of the
  `serve.sh --warmup` path (cheaper prefetch for projects that prefer it).
- **Canonical template** (shipped by Symphony, used by `needs_scaffold`): the
  hardened advising set (`common.sh`, `setup.sh`, `serve.sh`, `wait-healthy.sh`,
  `verify-health.sh`, `devenv.yaml`, `README.md`).

## 8. UI changes (tracker)

- **Readiness banner / empty-state** on the project overview/board: visible when
  `warm_up_status ∈ {never, failed}` (or `running` → progress). CTA "Preparar
  ambiente" → calls the start endpoint and navigates to the thread.
- **`DevEnvPanel`**: show last warm-up run (status, when, link to thread) + a
  re-run button.
- Reuse `ProjectAssistantRoute` / `ProjectAssistantPanel` for the thread; the
  warm-up tool calls render via the existing tool-call presenter.

## 9. Testing

- **Backend**: `DevEnv.warm_up/2` happy path + each `failure_class`; `manage_dev_env`
  authorization (assistant-only `warm_up`, coding agent denied); readiness state
  transitions; teardown-on-failure. Follow `dev_env_tools_test.exs`,
  `runner_test.exs`, `setup_tools_test.exs` patterns. Thread-bootstrap controller test.
- **Scripts**: `serve.sh` warmup mode (teardown-after-health, exit 0); tenant-aware
  `check_backend_health` (no silent fallback when tenant set) in the `.symphony`
  self-checks.
- **Frontend**: banner visibility logic by `warm_up_status`; "Preparar ambiente"
  → start call + thread navigation (Vitest; follow `ProjectAssistantPanel.test.tsx`,
  `projectSetup.test.ts`).

## 10. To confirm during plan-writing

- Exact default-tenant DB seed path on advising (dump import vs. `illumepg.py`),
  and whether `db-ready` is mandatory or best-effort per project.
- Whether the ephemeral warm-up port uses the smart preview port scheme
  (`2026-06-15-smart-preview-port-scheme-design.md`) directly.
- Where exactly the readiness banner mounts (board empty-state vs. project header).
