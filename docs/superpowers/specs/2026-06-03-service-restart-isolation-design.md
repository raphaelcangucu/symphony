# Service Restart Isolation (web / orchestrator / code-server) — Design

- **Date:** 2026-06-03
- **Status:** Draft (design approved in brainstorming; pending user review of written spec)
- **Area:** `elixir/` (application supervision tree, dev boot, Makefile, new control mix task)

## Problem & Motivation

Today a single `make serve` boots **one** BEAM node that owns everything:

- `dev/serve.exs` calls `Application.ensure_all_started(:symphony_elixir)` and then `Process.sleep(:infinity)` in the **foreground**. Stopping (`make stop`) `pkill`s that process (and any `code-server`).
- `SymphonyElixir.Application` starts a single flat `:one_for_one` tree: web (`HttpServer`, `StatusDashboard`), orchestrator (`Orchestrator`, `TaskSupervisor`, `DevServer.Manager`/`Reconciler`, `Observability.Reporter`), shared infra (`Repo` = the single SQLite writer, `Phoenix.PubSub`, registries, `Tracker.Sync.Engine`, `WorkflowStore`, GitHub caches), and the editor (`Editor.Server`, which manages an external `code-server`).
- The orchestrator runs Codex turns as **stdio Ports** inside this BEAM (`AgentRunner` → `Codex.CodingAgent.start_port/run_turn`). So when the BEAM dies on a restart, **in-flight Codex turns die with it.**

**Consequence / pain:** iterating on web code requires a `make serve` restart, which kills the whole BEAM — losing running orchestrator executions and forcing the `code-server` to be respawned. The vast majority of day-to-day changes are web-only and should not touch the orchestrator at all.

**Goal:** Restarting the web server must **not** kill in-flight orchestrator executions or drop the `code-server` connection. The restart command specifies *what* to restart via flags, supports `all`, and **defaults to web-only** (the most frequently changed surface).

## Constraints (from existing decisions)

- **Single SQLite writer.** The `2026-06-02-multi-orchestrator-projects-design.md` explicitly chose "single process, single SQLite writer — no multi-process write contention." Both the web UI and the orchestrator read/write the same `Repo`. This rules out splitting web and orchestrator into separate OS processes/nodes that each open the DB.
- **In-memory web↔orchestrator coupling.** The web reads live orchestrator state through in-process `Phoenix.PubSub` and direct GenServer calls. Splitting them across nodes would require replacing those with RPC/HTTP — a large, risky refactor that this design avoids.
- **`code-server` is already external and reuse-safe.** `Editor.Server.reuse_or_spawn/2` TCP-probes the bind address and reuses an already-listening `code-server` instead of respawning. It is the one service that is naturally isolated already.

## Approved Decisions (from brainstorming)

1. **Process model — A (single long-lived BEAM, restart sub-supervisors).** Keep one node that owns the DB + orchestrator + web + editor. Restructure the tree into named sub-supervisors so each can be restarted independently. Preserves single SQLite writer and in-memory coupling.
2. **Runtime — detached daemon.** `make serve` boots the BEAM in the background (logs to a file). The daemon outlives the `make` command so restart commands can target subtrees without killing the orchestrator.
3. **Command split — serve boots, update restarts.** `make serve` = full bring-up (boot the daemon with **all** subtrees if not already running). `make update` = recompile + restart **selected** subtree(s) against the running daemon; default **web-only**.
4. **Stop — full shutdown by default.** `make stop` = stop the whole daemon (web + orchestrator + editor). Flags stop a single subtree while keeping the daemon alive.
5. **Control channel — distributed Erlang.** Daemon boots as a named node (`127.0.0.1`) with a project cookie. `make update`/`make stop` start a short-lived control node, connect, and `:erpc` into a control module. EPMD ships with OTP and auto-starts, so there is no extra service to manage; RPC gives inline compile-error propagation.
6. **Flags via a mix task.** A single `mix symphony.ctl <serve|update|stop>` task parses real flags with `OptionParser` (`--web`, `--orchestrator`, `--code-server`/`--editor`, `--all`). Makefile targets wrap it and pass `ARGS`.

## Architecture Overview

```
make serve  ──>  mix symphony.ctl serve
                    │  (daemon not running?)  boot detached BEAM:
                    │     elixir --name <node>@127.0.0.1 --cookie <cookie> \
                    │       -S mix run --no-halt dev/serve.exs WORKFLOW.md   > .symphony/serve.log 2>&1 &
                    │  (daemon running?)  no-op + print status/URL/log path
                    ▼
            ┌──────────────────────  Daemon BEAM (long-lived)  ──────────────────────┐
            │  SymphonyElixir.Application  (top supervisor, :one_for_one)             │
            │    ├── :shared      (Repo[single SQLite], PubSub, registries,           │
            │    │                 CloneSupervisor, Sync.Engine, WorkflowStore,       │
            │    │                 GitHub caches, template seeding)   ── never        │
            │    │                                                       restarted    │
            │    │                                                       by ctl       │
            │    ├── :orchestrator (Orchestrator, TaskSupervisor[Codex Ports],        │
            │    │                  DevServer.Manager/Reconciler, Obs.Reporter)        │
            │    ├── :web          (HttpServer[cowboy], StatusDashboard)               │
            │    └── :editor       (Editor.Server → external code-server)             │
            └────────────────────────────────────────────────────────────────────────┘
                    ▲
make update [flags] ─┤  mix symphony.ctl update  ── control node ── :erpc ──> Ctl.update(targets)
make stop   [flags] ─┘  mix symphony.ctl stop    ── control node ── :erpc ──> Ctl.stop(targets)
```

Principles:

- **Single node, single writer.** Nothing about the DB or in-memory coupling changes; we only regroup children under sub-supervisors.
- **Minimal blast radius.** The default restart touches only `:web`. `:orchestrator` (and its Codex Ports) and the external `code-server` survive.
- **Fail-fast updates.** A recompile failure aborts the restart entirely — no half-applied state.
- **Reuse over rebuild.** `Editor.Server` reuse logic, `DevServeGuard`, and `dev/serve.exs` are extended, not replaced.

## Supervision Tree Restructure

`SymphonyElixir.Application.start/2` changes from a flat list to four named sub-supervisors, all under the existing top `:one_for_one` supervisor. Each sub-supervisor is itself a `Supervisor` with a stable `id` so the control module can `Supervisor.terminate_child/2` + `Supervisor.restart_child/2` by id.

| Sub-supervisor (id) | Children (today's modules) | Restarted by `ctl`? |
|---|---|---|
| `:shared` | `Phoenix.PubSub`, `Observability.Registry`, `Repo`, `LocalTracker.CloneSupervisor`, builtin-template seed task, `LocalTracker.Viewer.Server`, `SymphonyElixir.TaskSupervisor` (shared — used by web `assistant_channel` + `GitHub.ReadCache`), `GitHub.ReadCache`, `GitHub.RequestGateway`, `Tracker.Sync.Engine`, `WorkflowStore` | No (always-on; only via `--all` full restart) |
| `:orchestrator` | `Orchestrator`, `Orchestrator.TaskSupervisor` (NEW — Codex turn tasks/Ports only), `DevServer.Manager`, `DevServer.Reconciler`, `Observability.Reporter` | `--orchestrator` |
| `:web` | `HttpServer`, `StatusDashboard` | `--web` (default) |
| `:editor` | `Editor.Server` (only when `Config.editor_enabled?/0`) | `--code-server` / `--editor` |

Notes / decisions:

- **`TaskSupervisor` placement (RESOLVED via code audit).** `SymphonyElixir.TaskSupervisor` is **shared**: used by orchestrator dispatch (`orchestrator.ex:581` `start_child`, `:402` `terminate_child`), by the **web** `SymphonyElixirWeb.AssistantChannel` (`:208`, `:406`), and by `GitHub.ReadCache` (`:124`). It therefore **stays in `:shared`**. A **new** `SymphonyElixir.Orchestrator.TaskSupervisor` is added under `:orchestrator` and the two orchestrator dispatch sites switch to it, so the Codex turn tasks (and only those) restart with `:orchestrator` and are never reaped by a `:web` restart. Assistant-channel and read-cache tasks remain under the shared `:shared` supervisor.
- **Restart strategy.** Each sub-supervisor is `:one_for_one`; the top supervisor is `:one_for_one`. Restarting `:web` via the control module terminates and restarts that child supervisor, which restarts its leaf children fresh (new cowboy listener). The cowboy listener releasing/rebinding its port is expected and acceptable (brief connection drop on the **web** port only).
- **`StatusDashboard`.** Moves with `:web` (it renders the web/serve banner). `Application.stop/2` still calls `StatusDashboard.render_offline_status/0`.
- **Editor independence.** Because `Editor.Server` reuses an already-listening `code-server`, restarting `:editor` (or even `:all`) does **not** drop an active editor session — the GenServer re-attaches to the live process. A `:web` restart never touches `:editor` at all.

## Detached Daemon Boot

`dev/serve.exs` and the new control task cooperate:

- **Node identity.** Boot the daemon as a **named, localhost-only** node. Defaults (overridable via `.env`):
  - `SYMPHONY_NODE_NAME` (default `symphony`) → node `symphony@127.0.0.1`.
  - `SYMPHONY_NODE_COOKIE` (default `symphony-dev-cookie`) — dev-only; documented as overridable. Never commit a real cookie; `.env` already holds secrets and is gitignored.
- **Boot command.** `mix symphony.ctl serve` shells out to start the daemon detached:
  - `elixir --name "$node" --cookie "$cookie" -S mix run --no-halt dev/serve.exs "$WORKFLOW"` redirected to `.symphony/serve.log`, backgrounded (`nohup … &` or `setsid`).
  - `mix run --no-halt` replaces the current `--no-start` + `Process.sleep(:infinity)` shape; `dev/serve.exs` still sets the workflow path, port override, runs migrations, and announces readiness, but no longer blocks on `sleep` (the node stays up via `--no-halt`).
- **Single-instance guard.** `DevServeGuard` is repurposed to guard the **daemon** (one daemon per machine, as today). Extend the lock payload to also record the **node name** so `ctl update`/`stop` can discover the running daemon without env round-trips. A stale lock (dead pid) is taken over exactly as today.
- **Readiness / idempotency.** `mix symphony.ctl serve` when a live daemon already holds the lock is a **no-op** that prints the tracker URL, node name, and log path (does not boot a second node, does not error).
- **Logs.** Daemon stdout/stderr → `.symphony/serve.log` (sibling of the existing `.symphony/` DB dir). `serve`/`update`/`stop` print the log path so the agent/operator can tail it.

## Control Module & Mix Task

New module **`SymphonyElixir.Ctl`** (runs **inside** the daemon; invoked via `:erpc`):

- `@spec restart(targets :: [target]) :: {:ok, [target]} | {:error, term}` where `target in [:web, :orchestrator, :editor]`.
  1. `recompile/0` — recompile the project in-node (the daemon runs in the project dir with Mix loaded). Reuse `IEx.Helpers.recompile/0`-style logic or `Mix.Task.rerun("compile")` + `:code` reload of changed modules. **On compile error, return `{:error, {:compile, diagnostics}}` and restart nothing.**
  2. For each requested target, `Supervisor.terminate_child(SymphonyElixir.Supervisor, id)` then `Supervisor.restart_child(SymphonyElixir.Supervisor, id)`.
  3. Return the list actually restarted.
- `@spec stop(targets :: [target] | :all) :: :ok` — `:all` (default) does a graceful `System.stop/0` of the daemon (runs `Application.stop/2` → `StatusDashboard.render_offline_status/0`, `Editor.Server.terminate/2` to `kill -TERM` the spawned `code-server`). A subtree target terminates just that child supervisor (daemon stays up).

New mix task **`Mix.Tasks.Symphony.Ctl`** (runs as a **short-lived control node**; does **not** boot the app):

- Parses `OptionParser` flags: `--web`, `--orchestrator`, `--code-server` (alias `--editor`), `--all`. No flag on `update` ⇒ `[:web]`. No flag on `stop` ⇒ `:all`.
- `serve`: ensure daemon (boot detached if lock free/stale; else print status). Does **not** require an existing node.
- `update`/`stop`: start a hidden control node (`Node.start(:"symphony_ctl@127.0.0.1", :shortnames?...)`), set the cookie, `Node.connect/1` to the daemon node (from the lock file), `:erpc.call(node, SymphonyElixir.Ctl, :restart|:stop, [targets])`, print the result (or compile diagnostics) and exit. If no daemon is reachable, print a clear "no running daemon — run `make serve`" message and exit non-zero.

Flag → target mapping is shared (one private helper) so `update` and `stop` agree on names.

## Makefile Surface

Replace/extend the `serve`/`stop` recipes; add `update`:

```make
serve:  ; @$(MIX) symphony.ctl serve  $(ARGS)
update: ; @$(MIX) symphony.ctl update $(ARGS)   # default: --web
stop:   ; @$(MIX) symphony.ctl stop   $(ARGS)   # default: --all
```

- `make serve` — boot/ensure the daemon (all subtrees).
- `make update` — recompile + restart `:web` only.
- `make update ARGS="--orchestrator"` / `"--code-server"` / `"--all"` — restart the named subtree(s); multiple flags allowed.
- `make stop` — full daemon shutdown.
- `make stop ARGS="--web"` — stop only the web subtree, daemon stays up.

`ensure-deps` and `migrate` move **into** the `serve` (daemon boot) path; `update`/`stop` do not re-run them (the daemon already migrated at boot).

## Agent Workflow (how this is used in-session)

Mapping change → command (default path is web-only, never touches the orchestrator):

- Web change (`symphony_elixir_web/**`, router, LiveView, templates, assets) → `make update`.
- Orchestrator change (`orchestrator.ex`, `agent_runner.ex`, `codex/**`, `dev_server/**`, `tracker/sync/**` if orchestrator-owned) → `make update ARGS="--orchestrator"`.
- Shared/infra change (`repo`, migrations, `config/**`, `application.ex` tree, PubSub, `workflow_store`) → `make update ARGS="--all"`.
- Editor/code-server config (`editor/**`, `scripts/*code-server*`) → `make update ARGS="--code-server"`.

## Error Handling & Edge Cases

- **Compile failure on `update`:** abort before touching any supervisor; surface diagnostics; daemon keeps running the old code. Exit non-zero.
- **Daemon not running on `update`/`stop`:** clear message + non-zero exit; suggest `make serve`.
- **Stale lock (dead daemon):** `serve` takes over the lock and boots fresh (existing `DevServeGuard` behavior).
- **EPMD not started:** booting a named node auto-starts EPMD; the control node likewise. If a hardened environment blocks EPMD, document `unix_socket` as a fallback (out of scope here).
- **`code-server` already listening:** `Editor.Server` reuses it on `:editor`/`:all` restart — no dropped session.
- **`:web` restart in flight while a request is open:** the cowboy listener closes; clients reconnect. LiveViews auto-reconnect. Acceptable for a dev tool.
- **Subtree restart leaving orphaned monitors:** `Orchestrator` is **not** restarted on a `:web` restart, so its `Process.monitor` refs to running agent tasks stay valid. Restarting `:orchestrator` deliberately ends those runs (documented).

## Testing Strategy

- **Unit — flag parsing (`Mix.Tasks.Symphony.Ctl`):** no-flag `update` ⇒ `[:web]`; no-flag `stop` ⇒ `:all`; `--code-server` and `--editor` alias to `:editor`; `--all` ⇒ all three; multiple flags accumulate; unknown flag errors cleanly.
- **Unit — control mapping (`SymphonyElixir.Ctl`):** `restart/1` with a stubbed supervisor records `terminate_child`+`restart_child` for the requested ids only; compile-failure path returns `{:error, {:compile, _}}` and performs **zero** restarts (assert no supervisor calls).
- **Supervision tree:** assert the four named sub-supervisors exist with expected children; assert `SymphonyElixir.Orchestrator.TaskSupervisor` is a child of `:orchestrator` and `SymphonyElixir.TaskSupervisor` remains under `:shared` (regression guard for the "web restart must not reap Codex tasks" boundary).
- **Integration (single node, no external Codex):** start the app; capture the `:orchestrator` sub-supervisor pid + a dummy long-lived task under its `TaskSupervisor`; invoke `Ctl.restart([:web])`; assert the `:web` sub-supervisor pid **changed** while the `:orchestrator` pid and the dummy task pid are **unchanged**.
- **Editor reuse:** with a stubbed listening probe, `Ctl.restart([:editor])` keeps `Editor.Server` reporting `:ready` (reuse path), no respawn.
- **Guard:** `DevServeGuard` lock now records node name; stale-lock takeover still works; `serve` on a held lock is a no-op (mock the "alive" predicate).
- **Non-regression:** `make all` clean (format, credo, coverage, dialyzer); `mix specs.check` for new public `def`s; existing `dev/serve.exs` single-instance behavior preserved.

## Out of Scope

- Splitting web/orchestrator into separate OS processes or nodes (rejected — conflicts with single SQLite writer + in-memory coupling).
- Hot code upgrades / OTP release `appup`/`relup` (we use recompile + subtree restart, not in-place hot upgrade of running state).
- Unix-domain-socket control channel (distributed Erlang chosen; socket noted only as a hardened-env fallback).
- Per-project orchestrator restart granularity (a subtree restart restarts the whole orchestrator; per-project control is a future enhancement).
- Production/release packaging of the daemon (this targets local dev `make serve`).

## Open Questions / Risks

- **`recompile` semantics in a long-lived dev node.** Need to confirm the in-node recompile reliably reloads changed modules for **non-web** code (Phoenix's dev code reloader handles web per-request, but `:orchestrator` modules need explicit reload). Resolution: `Ctl.restart` performs an explicit `Mix.Task.rerun("compile")` + reload of changed `.beam`s before the subtree restart, regardless of target.
- **Cookie handling.** Dev default cookie is convenient but must be documented as overridable and localhost-bound; the node binds `127.0.0.1` only. No real cookie committed.
- **`TaskSupervisor` sharing (resolved).** Audit confirmed sharing across orchestrator + web + read-cache; resolved by adding `Orchestrator.TaskSupervisor` for Codex turns and leaving the shared one in `:shared`. No remaining ambiguity.
