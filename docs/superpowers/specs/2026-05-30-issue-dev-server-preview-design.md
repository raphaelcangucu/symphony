# Issue Dev-Server Preview — Design

> Lets Symphony start, supervise, and surface long-running **dev servers** for a
> task's isolated workspace, exposing a clickable **preview URL** on the issue so
> a human can review the agent's work in a running app. Built by **expanding the
> existing `DevEnv` subsystem** (setup steps) with a new **serve** concept and a
> per-issue runtime.

## 1. Problem

Each Symphony task/issue gets an isolated workspace directory
(`SymphonyElixir.Workspace.path_for_issue/1`, under `Config.workspace_root()`)
where the agent works. To review the result today a human must clone/checkout
the branch and run the app manually.

The `DevEnv` subsystem (`SymphonyElixir.LocalTracker.DevEnv.*`) already models and
runs **project-level setup steps** (install/build) inside a per-project tmux
session via `Terminal.Registry`. It has no concept of a long-running **dev
server**, no port/URL, no health, and is scoped to the project rather than the
issue workspace.

We want: when a PR appears for an issue (or the issue enters **Human Review**),
Symphony brings up the project in dev mode **inside that issue's workspace**,
allocates a port, health-checks it, and shows a **clickable preview URL on the
issue** — with manual start/stop/restart always available, and the UI clearly
showing that a poll-driven auto-start is in progress.

## 2. Goal

1. Expand `DevEnv` with a **serve** step kind (long-running, owns a port + URL +
   readiness probe) alongside the existing **setup** steps.
2. Run dev servers **per issue/workspace** (not per project), each supervised,
   able to **start / stop / restart**, with health-tracked status.
3. Support **multiple dev servers per issue** (e.g. multi-repo `front/` +
   `back/`), with exactly one marked **primary** whose URL is featured.
4. **Auto-start** servers when a PR is detected for the issue and/or when the
   issue enters Human Review (configurable), evaluated during a poll-driven
   reconcile — and **make that auto-state visible in the UI** (pending →
   provisioning → starting → ready).
5. Discover serve commands **convention-first** (`.symphony/devenv.*`) with a
   **framework heuristic fallback**; the feature is "applicable" only when
   enabled and at least one serve step is discovered.
6. Degrade gracefully (clear reason, disabled controls) when disabled, missing a
   workspace, at capacity, still starting, crashed, or with no serve step.

## 3. Non-goals

- **Reverse-proxy routing through the `:4000` hub.** Each dev server binds its
  own port and is opened directly (consistent with the `editor:`/code-server
  decision D4). No websocket-proxy plumbing.
- **Public exposure / multi-user auth.** Single-user, localhost-first
  assumption, consistent with the rest of Symphony. `base_url` override handles
  remote/proxy hosts.
- **Auto-creating the workspace.** If the workspace dir doesn't exist yet (agent
  hasn't run), controls are disabled with a `workspace_missing` reason. (Mirrors
  the editor spec D7; differs from the Terminal tab which auto-creates.)
- **GitHub webhooks / push-based PR events.** PR presence is derived by reading
  GitHub (polling), reusing `GitHub.PullRequests.for_issue/3`. Approved: the UI
  must show the pending/auto state while polling resolves.
- **Replacing the per-project `DevEnv` setup UI.** The existing project-level
  `DevEnvPanel`/routes stay; this adds an issue-scoped runtime on top of the
  expanded model.
- **Exit-code fidelity from inside tmux.** Readiness/liveness is determined by a
  port/HTTP probe, not by tmux exit codes (same limitation `DevEnv.Runner`
  documents).

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **Hosting model = hybrid.** A supervised `DevServer.Instance` GenServer per `(issue, serve-step)` owns a **dedicated tmux session** for the process; a `DevServer.Manager` (DynamicSupervisor + Registry + ETS index) tracks instances. | Combines OTP supervision/health (like `Editor.Server`) with tmux log capture/attach + reuse of `Terminal.Registry` (like `DevEnv.Runner`). Isolates each server — required for multi-repo. |
| D2 | **Scope = per issue/workspace.** Path resolved via `Workspace.path_for_issue/1` using the same `#`-stripping normalization the terminal uses (`Terminal.Registry.workspace_identifier/1`). | Dev server and agent share the identical directory. |
| D3 | **Multiple servers per issue, one `primary`.** | Primary URL is featured; the rest are listed. |
| D4 | **Port allocation = pick a free port from a configured `port_range`**, inject via `port_env` (default `PORT`) into the serve command's environment. | tmux can't report the chosen port, so Symphony assigns it and tells the process. URL = `base_url \|\| "http://127.0.0.1:<port>"` + `url_path`. |
| D5 | **Discovery = expanded `DevEnv`.** `Step.role` ∈ `{setup, serve}`; serve steps carry `port_env`, `url_path`, `ready` (probe), `primary`. Convention (`.symphony/devenv.yaml`) first; heuristic fallback per framework. | "Applicable" = `dev_server.enabled` AND ≥1 serve step discovered. |
| D6 | **Triggers = `auto_start_on` (`pull_request`, `human_review`) + manual.** Evaluated by a poll-driven `DevServer.Reconciler`; manual start/stop/restart always available. | PR detection reuses `GitHub.PullRequests.for_issue/3`, throttled/cached. |
| D7 | **Lifecycle.** Manual stop; **auto-stop** on terminal issue state / workspace removal / `idle_timeout_ms`; restart on demand; crash → status `crashed` (no auto-respawn — manual restart). | Avoids resource leaks and crash loops. |
| D8 | **Config = new `dev_server:` block** in `WORKFLOW.md` front matter, read only via `SymphonyElixir.Config`. | Mirrors `editor:`/`observability:`; no ad-hoc env reads. |
| D9 | **Concurrency cap `max_concurrent`** across all live servers. Over cap → `{:error, :capacity}`, surfaced as reason `capacity`. | Dev servers are heavy. |
| D10 | **Setup-before-serve.** A start runs the issue's `setup` steps in the issue's main tmux session first, then launches each `serve` step in its own session. | Reuses existing setup discovery; ensures deps exist in the workspace. |
| D11 | **`base_url` override** for remote/proxy hosts; default derives `http://127.0.0.1:<port>`. | Handles Symphony binding `127.0.0.1` behind a remote host. |
| D12 | **Persistence in `local_tracker_dev_servers`** so URLs/status survive page refresh; reconciled against live instances on boot (stale rows marked `stopped`). | The board/issue can render last-known state without a live socket. |

## 5. Architecture

```
WORKFLOW.md (dev_server: block)            repo: .symphony/devenv.yaml (role: serve)
        │                                          │
        ▼                                          ▼
SymphonyElixir.Config ──▶ dev_server_enabled?/0,   DevEnv.Proposer / ConventionReader /
   port_range/0, max_concurrent/0,                 HeuristicDiscoverer  (now emit serve steps)
   idle_timeout_ms/0, auto_start_on/0,                     │
   dev_server_base_url/0                                   ▼
        │                                       DevEnv.list_serve_steps(project, issue)
        ▼ (supervised in app tree)
SymphonyElixir.DevServer.Manager  (DynamicSupervisor + Registry + ETS index)
   ├─ start_for_issue(project, issue) -> starts setup, then one Instance per serve step
   ├─ stop_for_issue / restart / stop_instance
   ├─ list_for_issue(project, issue) -> [server view]   (live status + persisted URL)
   └─ enforces max_concurrent

SymphonyElixir.DevServer.Instance  (GenServer per serve step)
   ├─ allocate free port from port_range (bind-test)
   ├─ Terminal.Registry.open_dev_session(...) ; run setup (issue session) then serve cmd w/ PORT
   ├─ health-poll the port -> status :provisioning|:starting|:ready|:crashed|:stopped
   ├─ idle/terminal-state auto-stop ; kill tmux session on stop
   └─ persists row in local_tracker_dev_servers ; broadcasts PubSub updates

SymphonyElixir.DevServer.Reconciler  (poll timer, reuses poll interval)
   each tick: for issues matching auto_start_on (wait_states for human_review;
   PR-present for pull_request) -> Manager.ensure_started ; sets status :pending
   when queued/over-capacity so the UI can show "auto-start pending".

HTTP (per-issue, mirrors terminal/editor routes)
   GET    /api/tracker/v1/projects/:project_slug/issues/:identifier/dev_servers
   POST   .../dev_servers/start            (start all serve steps for the issue)
   POST   .../dev_servers/restart
   POST   .../dev_servers/stop
   POST   .../dev_servers/:server_id/stop|restart
     -> { "data": { "available": bool, "reason"?: string, "servers": [ ... ] } }

PubSub: topic "dev_server:<project>:<identifier>" — instance status updates pushed
to the tracker over the existing Phoenix channel infra (like terminal/observability).

Frontend
   types/devServer.ts            DevServer, DevServerStatus
   services/devServer.ts         list / start / stop / restart
   hooks/useIssueDevServers.ts   { servers, primary, available, reason, loading } (+ channel)
   issue-detail/PreviewTab.tsx   featured primary URL + list + controls + status + "view logs"
   IssueDrawer.tsx               new "Preview" tab (sibling of Terminal/PR)
   SummaryTab.tsx                primary preview chip in the links section when :ready
```

### 5.1 Backend — `DevEnv` model expansion

**`DevEnv.Step` / `local_tracker_dev_env_steps`** (migration adds columns,
defaults keep existing rows valid):

- `role :string` default `"setup"`, validated ∈ `{"setup","serve"}`.
- `port_env :string` (nil for setup; default `"PORT"` for serve).
- `url_path :string` default `"/"`.
- `ready_probe :string` default `"tcp"`, validated ∈ `{"tcp","http"}`.
- `ready_path :string` default `"/"` (used when `ready_probe == "http"`).
- `primary :boolean` default `false`.

`changeset/2` casts the new fields; serve-only fields are ignored for setup rows.
A project may have at most one `primary` serve step (validated/normalized on save;
if none is marked, the first serve step becomes primary).

**`DevEnv.ProposedStep`** gains the same optional fields (defaults mirror above).

**`ConventionReader`** — `.symphony/devenv.yaml` step maps may now include
`role: serve`, `port_env`, `url_path`, `ready` (`tcp` | `http`), `ready_path`,
`primary`. Markdown conventions remain setup-only.

**`HeuristicDiscoverer`** — add serve heuristics (emitted after install markers):

| Detected | Serve step | Port | Probe |
|---|---|---|---|
| `next.config.*` or `next` dep | `npm run dev` | `PORT`/3000 | http `/` |
| `vite.config.*` | `npm run dev` | `PORT`/5173 | http `/` |
| Phoenix (`mix.exs` + `phoenix` dep) | `mix phx.server` | `PORT`/4000 | http `/` |
| `package.json` with a `dev` script (generic) | `npm run dev` | `PORT` | tcp |

Heuristic serve steps are marked `optional: true`; the first becomes `primary`.

**`DevEnv` context** — add `list_serve_steps(project_slug)` and
`propose/list/save` already round-trip the new fields. Setup running is unchanged.

### 5.2 Backend — `DevServer` runtime (new)

**`SymphonyElixir.DevServer.Manager`** — supervises instances and indexes them.
- Started in the app supervision tree unconditionally; **no-ops when
  `dev_server_enabled?/0` is false** (returns `{:error, :disabled}`).
- `start_for_issue(project_slug, identifier)`:
  1. `{:error, :disabled}` if not enabled.
  2. resolve workspace path; `{:error, :workspace_missing}` if absent.
  3. `serve_steps = DevEnv.list_serve_steps(project_slug)`; `{:error, :no_serve_step}` if empty.
  4. capacity check across all live instances; over → `{:error, :capacity}` (queued instances marked `:pending`).
  5. start the issue's `setup` steps once in the issue tmux session, then start one `Instance` per serve step under the DynamicSupervisor.
- `stop_for_issue/2`, `restart_for_issue/2`, `stop_instance/1`, `restart_instance/1`.
- `list_for_issue/2` → merges live instance status with persisted rows into server views.

**`SymphonyElixir.DevServer.Instance`** — `GenServer` per serve step.
- `init`: persist/refresh row (`status: :provisioning`), allocate a free port from
  `port_range` by bind-testing candidates in order (`:gen_tcp.listen/2` on each
  port; on success close the probe socket and claim that port; skip ports already
  claimed by live instances; `{:error, :no_free_port}` if the range is exhausted),
  then continue.
- run setup (delegated to Manager once per issue), then
  `Terminal.Registry.open_dev_session(project, identifier, slug, cwd)` and send the
  serve command with the port env injected (`PORT=<n> <command>`); set `:starting`.
- health-poll the port (`tcp` connect or `http` GET `ready_path`) until success →
  `:ready` (records `url`), or timeout → `:crashed`.
- monitor: if the tmux session/window dies or probe fails repeatedly → `:crashed`
  (no auto-respawn).
- idle timer: if `idle_timeout_ms` elapses since last activity/health-confirm and
  the issue isn't actively viewed, auto-stop.
- `terminate`/stop: kill the tmux session, mark row `:stopped`, broadcast.
- broadcasts every status change on `dev_server:<project>:<identifier>`.

**`SymphonyElixir.DevServer.Reconciler`** — periodic (reuses `Config.poll_interval_ms/0`).
- For `human_review` trigger: `Tracker.fetch_issues_by_states(Config.wait_states())`.
- For `pull_request` trigger: for issues in active+wait states, check
  `GitHub.PullRequests.for_issue/3` (cached with a short TTL to bound API calls);
  treat presence of any open PR as the trigger.
- For each matching issue not already started/disabled: `Manager.start_for_issue`,
  marking `:pending` when queued/over-capacity so the UI shows auto-start in flight.
- Never auto-starts issues in terminal states; auto-stops servers whose issue
  reached a terminal state or whose workspace was removed.

**`SymphonyElixir.DevServer`** — pure view/URL builder used by the controller:
- `issue_targets(project_slug, identifier)` →
  `{:ok, %{available: bool, reason: nil | atom, servers: [view]}}` where each view
  has `id, working_dir, role, port, url, status, primary, session_name`.
- reasons: `:disabled | :workspace_missing | :no_serve_step | :capacity | :starting`.

**`Terminal.Registry`** — add `dev_session_name(project, identifier, slug)`
(`"sym-dev-<project>-<issue>-<slug>"`) and `open_dev_session/4` +
`kill_session/…` reusing the existing `Tmux` wrapper (new-session/send-keys/
capture-pane/kill-session already exist).

**`Config`** — add the `dev_server:` map to the NimbleOptions schema (sibling to
`editor:`/`observability:`/`server:`) plus module-attribute defaults and
`@spec`'d accessors:

```elixir
dev_server: [
  type: :map,
  default: %{},
  keys: [
    enabled: [type: :boolean, default: false],
    port_range: [type: {:list, :pos_integer}, default: [4100, 4199]],
    max_concurrent: [type: :pos_integer, default: 3],
    idle_timeout_ms: [type: :pos_integer, default: 1_800_000],
    auto_start_on: [type: {:list, {:in, ["pull_request", "human_review"]}}, default: ["pull_request", "human_review"]],
    base_url: [type: {:or, [:string, nil]}, default: nil]
  ]
]
```

Accessors: `dev_server_enabled?/0`, `dev_server_port_range/0`,
`dev_server_max_concurrent/0`, `dev_server_idle_timeout_ms/0`,
`dev_server_auto_start_on/0`, `dev_server_base_url/0` (returns nil → callers
derive `http://127.0.0.1:<port>`).

**`local_tracker_dev_servers`** (new table): `project_id`/`project_slug`,
`issue_identifier`, `working_dir`, `role`, `port`, `url`, `status`, `primary`,
`session_name`, `started_at`, timestamps. Status ∈
`{pending, provisioning, starting, ready, crashed, stopped}`.

**Router** — add the per-issue dev_server routes alongside the terminal route.
**Controller** — `DevServerController` mirrors existing tracker controllers
(resolve project/issue → 404 if unknown; call `DevServer`/`Manager`; render
`{ "data": ... }`).
**App supervision tree** — add `DevServer.Manager` and `DevServer.Reconciler`
(both internally no-op when disabled), placed after `Repo`/`Orchestrator`.

### 5.3 Frontend modules

- `tracker/src/types/devServer.ts` — `DevServerStatus` (`pending | provisioning |
  starting | ready | crashed | stopped`), `DevServer`, list response type with
  `available`, `reason`, `servers`, `primary`.
- `tracker/src/services/devServer.ts` — `listDevServers`, `startDevServers`,
  `stopDevServers`, `restartDevServers`, `stopDevServer(id)`,
  `restartDevServer(id)` (snake↔camel normalization like `devEnv.ts`).
- `tracker/src/hooks/useIssueDevServers.ts` — mirrors `useIssuePullRequests`;
  fetches on drawer open, subscribes to `dev_server:<project>:<identifier>` for
  live status, returns `{ servers, primary, available, reason, loading, error,
  refetch, start, stop, restart }`.
- `tracker/src/components/issues/issue-detail/PreviewTab.tsx` — featured primary
  card (big "Open preview" button → `window.open(url, "_blank", "noopener")`,
  shown enabled only when `ready`), a list of the other servers with a status
  badge and per-server stop/restart, a "View logs" link that switches to the
  Terminal tab for that session, and Start/Stop-all/Restart-all controls.
  Empty/disabled states render the `reason` (`disabled`, `no_serve_step`,
  `workspace_missing`, `capacity`) like `PullRequestTab`.
- `IssueDrawer.tsx` — add a **Preview** tab (lucide `MonitorPlay`/`Globe`),
  sibling to Terminal/PR. Tab trigger shows a small status dot reflecting the
  primary server's status (so auto-start/provisioning is visible without opening
  the tab — satisfies the "show polling progress" requirement).
- `SummaryTab.tsx` — when the primary server is `:ready`, render a preview-URL
  chip in the existing links `section`.
- `lib/workspaceRoutes.ts` — register `"preview"` as an `IssueTab` so the URL
  `.../issues/%23507/preview` deep-links the tab (consistent with the `/pr` tab
  the user referenced).

## 6. Data flow

1. **Boot** → supervisor starts `DevServer.Manager` + `Reconciler`. If disabled,
   both stay inert. On boot the Manager marks stale persisted rows `stopped`.
2. **Auto-start (poll)** → each tick the `Reconciler` finds issues matching
   `auto_start_on` (Human Review state and/or PR present) and calls
   `Manager.start_for_issue`. Queued/over-capacity → `:pending`. The tracker shows
   the tab dot transition pending → provisioning → starting → ready.
3. **Manual** → Preview tab Start → same `Manager.start_for_issue` path.
4. **Instance lifecycle** → allocate port → run setup (issue session) → launch
   serve (own session, `PORT` injected) → health-poll → `:ready` with URL →
   persisted + broadcast.
5. **Open preview** → `window.open(url)` to the dev server's own port.
6. **Stop** → manual, idle timeout, terminal issue state, or workspace removal →
   kill session, mark `:stopped`, broadcast.

## 7. Error handling & edge cases (explicit)

| Case | Behavior |
|---|---|
| `dev_server.enabled` false | Endpoint `available:false, reason:"disabled"`; tab dot hidden; controls disabled. |
| No serve step discovered | `reason:"no_serve_step"`; Start disabled with hint to add `.symphony/devenv.yaml` `role: serve`. |
| Workspace dir missing (agent hasn't run) | `reason:"workspace_missing"`; controls disabled. No auto-create. |
| Over `max_concurrent` | `reason:"capacity"`; auto-started instances marked `:pending`; UI shows "waiting for a free slot". |
| Port range exhausted / all in use | Instance fails port allocation → `:crashed` with a clear log; Restart available. |
| Serve command never opens the port | Health-poll timeout → `:crashed`; logs viewable via Terminal tab. |
| Process/tmux session dies | Monitored → `:crashed`; no auto-respawn; manual Restart. |
| Idle beyond `idle_timeout_ms` | Auto-stop → `:stopped`; Start re-launches. |
| Issue reaches terminal state / workspace removed | Reconciler auto-stops and kills the session. |
| PR detection lag (polling) | Status shows `:pending`/auto-start in flight until the next reconcile resolves it (UI requirement #2). |
| Remote / proxy host | `dev_server.base_url` overrides the derived host in the built URL. |
| Path with spaces/special chars | Workspace path quoted when sent to tmux; URL host/port only (path is `url_path`). |
| Unknown project/issue | Controller returns 404. |
| Multiple serve steps, none primary | First serve step is treated as primary (normalized on save/propose). |

## 8. Testing

- **Config** (`config_test.exs`): defaults when `dev_server:` omitted; reads
  configured keys; `auto_start_on` parsing; `dev_server_base_url/0` nil-default.
- **DevEnv model**: `Step`/`ProposedStep` accept and validate `role`/serve
  fields; primary normalization (exactly one primary). `ConventionReader` parses
  `role: serve` + serve fields. `HeuristicDiscoverer` emits framework serve steps
  with the right port/probe and marks the first primary.
- **`DevServer.Instance`**: inject a fake tmux/runner + fake port allocator +
  fake probe; assert status transitions (`provisioning → starting → ready`),
  port injection into the command, crash on probe timeout, idle auto-stop, clean
  session kill on terminate. No crash when the probe/spawn fails.
- **`DevServer.Manager`**: setup-before-serve ordering; one instance per serve
  step; `max_concurrent` enforcement (`:capacity`); `disabled`/`workspace_missing`/
  `no_serve_step` branches; stop/restart per issue and per instance; stale-row
  reconcile on boot.
- **`DevServer.Reconciler`**: with a fake tracker + fake PR lookup, auto-starts
  issues in Human Review and issues with a PR; marks `:pending` over capacity;
  auto-stops on terminal state; never starts disabled/terminal issues.
- **`DevServer` view builder**: each reason branch and a correct server view with
  derived URL (default and `base_url` override).
- **Controller**: 200 with servers, 200 unavailable+reason, start/stop/restart
  happy paths, 404 unknown issue.
- **Frontend** (Vitest): `devServer.ts` normalization; `useIssueDevServers`
  states + channel update handling; `PreviewTab` enabled/disabled by status +
  reason rendering; `IssueDrawer` tab dot reflects primary status;
  `workspaceRoutes` `preview` tab parsing/round-trip.

## 9. Docs to update (same change)

- `elixir/README.md` — dev-server preview feature + run instructions.
- `WORKFLOW.md` and `WORKFLOW.*.example.md` — the `dev_server:` block and a
  `.symphony/devenv.yaml` example with a `role: serve` step
  (`front/` primary on `PORT`, `back/` secondary).
- `elixir/docs/troubleshooting.md` — port in use / range exhausted, server never
  opens the port, idle auto-stop, remote `base_url`.
- `SPEC.md` — note the issue-scoped dev-server runtime as a superset of `DevEnv`.

## 10. Open questions

None blocking. Resolved forks: hybrid tmux+OTP hosting (D1), per-issue scope
(D2), multi-server with one primary (D3), Symphony-assigned port via env (D4),
expanded `DevEnv` discovery (D5), poll-driven PR + Human-Review triggers with
visible UI state (D6), lifecycle/auto-stop (D7), `dev_server:` config block (D8).
