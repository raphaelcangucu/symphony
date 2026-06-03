# Symphony Elixir

This directory contains the current Elixir/OTP implementation of Symphony, based on
[`SPEC.md`](../SPEC.md) at the repository root.

> [!WARNING]
> Symphony Elixir is prototype software intended for evaluation only and is presented as-is.
> We recommend implementing your own hardened version based on `SPEC.md`.

## Screenshot

![Symphony Elixir screenshot](../.github/media/elixir-screenshot.png)

## How it works

1. Polls the configured tracker (Linear or GitHub Issues) for candidate work
2. Creates an isolated workspace per issue
3. Launches the configured coding agent (Codex or Claude) inside the workspace
4. Sends a workflow prompt to the agent
5. Keeps the agent working on the issue until the work is done

During Codex app-server sessions, Symphony also serves a client-side `linear_graphql` tool so that
repo skills can make raw Linear GraphQL calls.

If a claimed issue moves to a terminal state (`Done`, `Closed`, `Cancelled`, or `Duplicate`),
Symphony stops the active agent for that issue and cleans up matching workspaces.

## How to use it

1. Make sure your codebase is set up to work well with agents: see
   [Harness engineering](https://openai.com/index/harness-engineering/).
2. Set up your tracker credentials:
   - **Linear**: Get a personal token via Settings → Security & access → Personal API keys, and set
     it as `LINEAR_API_KEY`.
   - **GitHub**: Set `GITHUB_TOKEN` with an access token that has Issues read/write permissions.
3. Copy this directory's `WORKFLOW.md` to your repo.
4. Optionally copy the `commit`, `push`, `pull`, `land`, and `linear` skills to your repo.
   - The `linear` skill expects Symphony's `linear_graphql` app-server tool for raw Linear GraphQL
     operations such as comment editing or upload flows.
5. Customize the copied `WORKFLOW.md` file for your project.
   - **Linear**: To get your project's slug, right-click the project and copy its URL. The slug is
     part of the URL. When creating a workflow based on this repo, note that it depends on
     non-standard Linear issue statuses: "Rework", "Human Review", and "Merging". You can
     customize them in Team Settings → Workflow in Linear.
   - **GitHub**: Set `github.repo` to `owner/repo`. Symphony bootstraps a repo-level
     GitHub Project v2 named `Symphony` (configurable via `github.project.title`) on
     first run and tracks issue state through the GitHub Project `Status`
     single-select field — the single source of truth — whose options come from
     `tracker.field_states` when set, otherwise `tracker.active_states` plus
     `tracker.terminal_states`. Use `field_states` to include board-only options such
     as `Backlog` that are not polled. Local project metadata is cached in
     `.symphony/github-project.json` (gitignored).

     Issues are admitted when they carry `symphony`, `symphony:codex`, or
     `symphony:claude` (base label configurable via `github.admission_label`,
     default `symphony`). Agent routing:

     | Label | Agent |
     |-------|--------|
     | `symphony:codex` | Codex |
     | `symphony:claude` | Claude |
     | `symphony` | WORKFLOW default (Codex when `codex:` is configured) |

     The WORKFLOW must include a `codex:` and/or `claude:` section for the
     targeted agent. New labeled issues are added on the next poll.

     Optional `github.assignee` further restricts routing (GitHub login or `"me"`).
     Omit `assignee` to route by label only.

     Blockers are parsed from `trackedInIssues` and from issue-body lines such as
     `Blocked by #42` or `Depends on clouapp/front#12`. Linked PR branches populate
     `issue.branch_name` when GitHub exposes `linkedBranches`.

     Codex sessions expose a `github_graphql` dynamic tool (same contract as
     `linear_graphql`) for raw GitHub GraphQL from the agent.

     See `elixir/WORKFLOW.macromarkets.example.md` for a dogfood setup on
     `clouapp/front` (project **Macro Markets**). Bootstrap the board with
     `mix run --no-start scripts/bootstrap_macro_markets.exs`.

     Required `GITHUB_TOKEN` scopes: `repo` (read+write) and `project` (read+write).
   - **Local tracker**: Add a top-level `local:` section to store issues in SQLite and set
     `SYMPHONY_TRACKER_TOKEN` for the browser UI/API bearer token:

     ```yaml
     local:
       database_path: .symphony/tracker.sqlite3
       project_slug: macro-markets
       api_token_env: SYMPHONY_TRACKER_TOKEN
     tracker:
       active_states:
         - Todo
         - In Progress
         - Rework
       terminal_states:
         - Done
         - Closed
     ```

     ```bash
     export SYMPHONY_TRACKER_TOKEN="$(openssl rand -hex 24)"
     ```
6. Follow the instructions below to install the required runtime dependencies and start the service.

## Prerequisites

We recommend using [mise](https://mise.jdx.dev/) to manage Elixir/Erlang versions.

```bash
mise install
mise exec -- elixir --version
```

### Homebrew

```bash
brew tap sapsaldog/symphony
brew install symphony
```

When using the Claude coding agent backend, also install `symphony-claude` — a JSON-RPC 2.0 app
server that bridges Symphony and Claude Code:

```bash
brew install symphony-claude
```

## Run

### From Homebrew

```bash
symphony /path/to/WORKFLOW.md
```

### From source

```bash
git clone https://github.com/sapsaldog/symphony
cd symphony/elixir
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build
mise exec -- ./bin/symphony ./WORKFLOW.md
```

## Configuration

Pass a custom workflow file path to `./bin/symphony` when starting the service:

```bash
./bin/symphony /path/to/custom/WORKFLOW.md
```

If no path is passed, Symphony defaults to `./WORKFLOW.md`.

Optional flags:

- `--logs-root` tells Symphony to write logs under a different directory (default: `./log`)
- `--port` also starts the Phoenix observability service (default: disabled)

The `WORKFLOW.md` file uses YAML front matter for configuration, plus a Markdown body used as the
agent session prompt.

Minimal example (Linear + Codex):

```md
---
tracker:
  kind: linear
  project_slug: "..."
workspace:
  root: ~/code/workspaces
hooks:
  after_create: |
    git clone git@github.com:your-org/your-repo.git .
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex app-server
---

You are working on a Linear issue {{ issue.identifier }}.

Title: {{ issue.title }} Body: {{ issue.description }}
```

Minimal example (GitHub + Claude):

```md
---
tracker:
  kind: github
github:
  repo: your-org/your-repo
  project:
    mode: auto   # auto = bootstrap a new project; existing = use github.project.id
    title: Symphony
  admission_label: symphony
workspace:
  root: ~/code/workspaces
hooks:
  after_create: |
    git clone git@github.com:your-org/your-repo.git .
agent:
  kind: claude
  max_concurrent_agents: 5
  max_turns: 20
claude:
  command: symphony-claude
---

You are working on issue {{ issue.identifier }}.

Title: {{ issue.title }} Body: {{ issue.description }}
```

Notes:

- If a value is missing, defaults are used.
- **Tracker backends**: `linear`, `github` (default), `memory` (testing). Detected automatically
  from which YAML section (`linear:`, `github:`, `local:`, or `memory:`) is present in the front
  matter.
- **Coding agent backends**: `codex`, `claude` (default). Detected automatically from which YAML
  section (`codex:` or `claude:`) is present in the front matter.
- **Codex-specific policy settings** (only apply when using `codex:` backend):
  - `codex.approval_policy` defaults to `{"reject":{"sandbox_approval":true,"rules":true,"mcp_elicitations":true}}`.
    Supported values depend on the Codex app-server version. String values include `untrusted`,
    `on-failure`, `on-request`, and `never`; object-form `reject` is also supported.
  - `codex.thread_sandbox` defaults to `workspace-write`. Supported values: `read-only`,
    `workspace-write`, `danger-full-access`.
  - `codex.turn_sandbox_policy` defaults to a `workspaceWrite` policy rooted at the current issue
    workspace. Supported `type` values: `dangerFullAccess`, `readOnly`, `externalSandbox`,
    `workspaceWrite`.
  - `codex.goals_enabled` defaults to `false`. Set it to `true` to allow Codex dispatches with
    Goal mode; when disabled, goal requests fall back to a normal single-turn dispatch with a
    warning.
- **Assistant issue authoring**:
  - `assistant.draft_status` defaults to `Triage`. The configured tracker workflow/status must
    already exist and should be outside `tracker.active_states` so drafts are not auto-dispatched.
  - Complex issue authoring injects vendored skill files from `skills/superpowers/...`; update that
    folder manually when changing the assistant methodology.
  - The assistant chat does **not** post its replies as GitHub issue comments (they stream in the
    chat UI); it records changes via `update_issue`. Only `dispatch_codex` posts a single milestone
    comment. This keeps the chat from spamming GitHub and triggering rate limits.
- **GitHub request gateway** (`github.*`, optional): GitHub REST/GraphQL calls flow through
  `SymphonyElixir.GitHub.RequestGateway`, which follows GitHub's API best practices — spacing
  mutations at least one second apart and, on a `429`/`403`/GraphQL rate-limit response, opening a
  shared backoff window derived from `Retry-After` / `x-ratelimit-reset`. While that window is open
  the gateway **fails fast** (returns `429` immediately) instead of blocking request handlers, so
  the tracker UI and app boot never freeze waiting for a reset; reads otherwise run concurrently.
  Tunables: `github.mutation_interval_ms` (default `1000`) and `github.max_backoff_ms`
  (default `60000`, the cap on how long a block lasts before re-probing).
- **Claude backend** uses `bypassPermissions` mode and has no additional policy settings.
- `agent.max_turns` caps how many back-to-back agent turns Symphony will run in a single agent
  invocation when a turn completes normally but the issue is still in an active state. Default: `20`.
- If the Markdown body is blank, Symphony uses a default prompt template that includes the issue
  identifier, title, and body.
- Use `hooks.after_create` to bootstrap a fresh workspace. For a Git-backed repo, you can run
  `git clone ... .` there, along with any other setup commands you need.
- If a hook needs `mise exec` inside a freshly cloned workspace, trust the repo config and fetch
  the project dependencies in `hooks.after_create` before invoking `mise` later from other hooks.
- `tracker.api_key` reads from `LINEAR_API_KEY` when unset or when value is `$LINEAR_API_KEY`.
- For GitHub tracker, `GITHUB_TOKEN` is used for API authentication.
- GitHub REST fallback (resilience): `SymphonyElixir.GitHub.Api` runs comment,
  open/close, label-discovery, and PR-linkage operations on GraphQL first and
  transparently falls back to the REST API when GraphQL is rate-limited (the two
  share separate hourly buckets). The Projects v2 board status read/write is
  GraphQL-only and defers until the rate limit resets; routing the other
  operations to REST reduces GraphQL pressure so the board path survives longer.
- For path values, `~` is expanded to the home directory.
- For env-backed path values, use `$VAR`. `workspace.root` resolves `$VAR` before path handling,
  while `codex.command` / `claude.command` stays a shell command string and any `$VAR` expansion
  there happens in the launched shell.

```yaml
tracker:
  api_key: $LINEAR_API_KEY
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    git clone --depth 1 "$SOURCE_REPO_URL" .
codex:
  command: "$CODEX_BIN --model gpt-5.3-codex app-server"
```

- If `WORKFLOW.md` is missing or has invalid YAML, startup and scheduling are halted until fixed.
- `server.port` or CLI `--port` enables the optional Phoenix LiveView dashboard and JSON API at
  `/`, `/api/v1/state`, `/api/v1/<issue_identifier>`, and `/api/v1/refresh`.

### Local Tracker Development

The local tracker runs from the same Phoenix server as the dashboard/API and stores data in the
SQLite path configured by `local.database_path`. The React app uses `SYMPHONY_TRACKER_TOKEN` as a
bearer token for `/api/tracker/v1/*` and the tracker channel.

The simplest way to run the tracker locally is the resilient `make serve` target. It ensures
dependencies and database migrations and boots the app through Mix — which is required because
the packaged escript (`bin/symphony`) cannot load the native SQLite driver NIF. Per-project config
is DB-owned, so no global `WORKFLOW.md` is required; set `SYMPHONY_TRACKER_TOKEN` in `elixir/.env`
for the tracker UI/API bearer token:

```bash
cd elixir
make serve            # http://localhost:4000/tracker  (token: $SYMPHONY_TRACKER_TOKEN from .env)
make stop             # stop the running daemon
```

#### Running the dev daemon (restart only what you changed)

`make serve` boots Symphony as a single long-lived **detached** BEAM (logs to
`.symphony/serve.log`). It owns the SQLite DB, the orchestrator (and its in-flight
Codex turns), the web server, and the code-server manager — each in its own
restartable subtree. Restart only what you changed; the orchestrator keeps
running otherwise:

| Command | Restarts |
|---|---|
| `make update` | web only (default) |
| `make update ARGS="--orchestrator"` | orchestrator only |
| `make update ARGS="--code-server"` | code-server manager only |
| `make update ARGS="--all"` | web + orchestrator + editor |
| `make stop` | full daemon shutdown |
| `make stop ARGS="--web"` | stop just the web subtree (daemon stays up) |

`make update` recompiles first; a compile error aborts the restart (the daemon
keeps running the old code). The daemon runs as a localhost-only distributed
node — see `SYMPHONY_NODE_NAME` / `SYMPHONY_NODE_COOKIE` in `.env`.

Override the token or port as needed:

```bash
SYMPHONY_TRACKER_TOKEN="$(openssl rand -hex 24)" make serve TRACKER_PORT=4001
```

Database migrations can also be run on their own:

```bash
make migrate                          # create db if needed + apply pending migrations
make new-migration name=add_widgets   # generate a new migration file
make rollback                         # roll back the last migration
```

For frontend hot-reload development, run the API and Vite separately:

```bash
# Terminal 1 — API + tracker
cd elixir && make serve

# Terminal 2 — Vite dev server
cd tracker && npm install && npm run dev
```

Vite serves the app under `/tracker/` and proxies `/api` plus `/socket` to Phoenix by default.
For production/static serving, build the frontend:

```bash
cd tracker
npm run build
```

The build writes to `elixir/priv/static/tracker`; when Phoenix is started with `--port`, `/tracker`
and `/tracker/*` serve the SPA while existing dashboard routes and tracker API routes remain
available.

### Multi-orchestrator projects

When the local tracker holds more than one project, Symphony orchestrates **every non-archived
project** in the database on boot — a single process and single SQLite writer, with each project
resolving its own configuration and prompt. There is no longer a single global workflow that gates
which project runs.

- **The database is the source of truth** for per-project config and prompt. Each project's
  `local_tracker_project_setups` row stores `workflow_config` (WORKFLOW-shaped front matter) and
  `prompt_template` (the agent prompt). At dispatch, `SymphonyElixir.ProjectConfig.resolve/1` layers
  a project's front matter over the global `WORKFLOW.md` defaults, so an omitted key inherits the
  global value and a blank prompt falls back to the global prompt.
- **Per-project behavior**: candidate polling uses each project's `tracker.active_states`, and the
  prompt, agent kind, and workspace path are resolved from the project's setup. Issue workspaces are
  nested under the project slug (`<workspace.root>/<project_slug>/<issue>`).
- **Observability** reports one runtime card per project, using a composite `runtime_id`
  (`<base>:<project_slug>`) with that project's filtered snapshot.
- **Editing**: create/edit a project's prompt and config from the tracker UI. The project modal
  includes a Write/Preview **markdown editor** for the prompt and a **Load default** action that
  pulls from the workspace templates. Saving persists via `PUT /api/tracker/v1/projects/:id/setup`.
- **Seeding from `WORKFLOW.<slug>.md` files** (one-time, idempotent): import existing per-project
  workflow files into the database with

  ```bash
  mise exec -- mix symphony.workflows.backfill --dir .
  ```

  For each `WORKFLOW.<slug>.md` (excluding `*.example.*`), the task creates the project if missing
  and imports its front matter + prompt into the project's setup. It **never overwrites** a project
  whose setup is already DB-owned, so re-running is safe and UI edits always win. Environment/profile
  workflows that are not real projects (for example `WORKFLOW.local-dev.md`) should be kept out of
  the scanned directory to avoid creating spurious projects.

## Web dashboard

The observability UI now runs on a minimal Phoenix stack:

- The tracker SPA at `/tracker` (`/` now 302-redirects to `/tracker`; the old root LiveView dashboard was retired)
- JSON API for operational debugging under `/api/v1/*`
- Bandit as the HTTP server
- Phoenix dependency static assets for the client bootstrap

### Global observability

Each Symphony process reports its orchestrator snapshot to a central observability hub. The hub
(by default `http://localhost:4000`) aggregates all reporting runtimes in memory and exposes a
live, cross-process view of running sessions.

- **Hub model**: worker processes push their snapshot to the hub immediately on change (coalesced)
  and on a periodic heartbeat. The hub keeps the latest snapshot per runtime and marks runtimes as
  online or stale based on when they last reported.
- **Config**: set `observability.hub_url` on each worker process to point at the hub. Omit it on the
  hub process itself — the hub self-registers in-process. Tunables: `heartbeat_interval_ms`
  (default `5000`), `min_report_interval_ms` (default `250`), `label`, and an optional stable
  `runtime_id` (defaults to the workflow file path). See
  `elixir/WORKFLOW.macromarkets.example.md` for a commented example block.
- **Endpoints** (bearer auth, `SYMPHONY_TRACKER_TOKEN`):
  - `GET /api/tracker/v1/observability` — the aggregate of all runtimes
  - `POST /api/tracker/v1/observability/report` — worker → hub snapshot delivery
- **The page**: open `/tracker` and choose **Observability** in the sidebar (route
  `/observability`) for live per-runtime cards and a global running-sessions table.

### Recents & assistant chats

The sidebar shows a **Recents** group listing the most recent sessions across all projects,
unifying two row kinds: persisted **assistant chat threads** and **Codex/issue runs** (an issue
with an active run or a non-empty `branch_name`). Each row shows its project (or "Geral" when none)
and a status dot; clicking navigates to the chat view or the issue's **Agent** tab.

The assistant also supports **freeform chats** that are not bound to any project, created and opened
from the global **Assistant** area (`/assistant`, `/assistant/:threadId`). Freeform chat is
conversational only in v1 (no tracker tools). The thread model carries a `scope`
(`project`|`freeform`|`issue`) with `issue_identifier`/`title`, and `project_slug` is nullable.

Issue authoring uses the same assistant surface as the primary **New issue** path. The assistant
creates a draft issue in `assistant.draft_status`, redirects to
`/projects/:slug/assistant/issue/:id`, and continues in an issue-scoped chat that runs inside that
issue's workspace. **Simple** mode enriches the issue description directly; **Complex** mode follows
the vendored superpowers methodology as the desired design-first default, writes spec/plan/handoff
docs under `docs/superpowers/`, and keeps review read-only in the assistant and issue detail. If the
user explicitly authorizes implementation, Codex may proceed directly to code from that same issue
chat. Execution stays separate: the issue detail's Agent tab has **Authoring** for chat/docs and
**Execution** for the orchestrator run.
Codex dispatch can opt into **Goal mode** when `codex.goals_enabled: true`; Symphony derives a goal
from the issue docs for review, then sends it to Codex for long-running continuation.

- **Endpoints** (bearer auth, `SYMPHONY_TRACKER_TOKEN`):
  - `GET /api/tracker/v1/recents?limit=` — unified, recency-ranked sessions (limit clamped `1..50`,
    default `20`).
  - `GET /api/tracker/v1/assistant/threads?scope=&project_slug=&limit=` — list assistant threads
    with previews.
  - `POST /api/tracker/v1/assistant/threads` — body `{ scope, project_slug?, title? }`; v1 supports
    `freeform`, `project`, and issue-authoring threads, and returns the created thread.
  - `GET /api/tracker/v1/projects/:slug/issues/:identifier/documents` — list issue authoring docs
    from the issue workspace under `docs/superpowers/specs/`, `docs/superpowers/plans/`, and
    `docs/superpowers/handoff.md`.
  - `GET /api/tracker/v1/projects/:slug/issues/:identifier/documents/*path` — read one markdown
    document. Paths are resolved from the issue workspace, restricted to `docs/superpowers/`, and
    protected against traversal/oversized reads.
- **Channel**: the assistant channel accepts `assistant:thread:<id>` (a specific thread, project or
  freeform) alongside the existing `assistant:<project_slug>` topic. Issue threads push
  `assistant_document_changed` when complex-mode turns change authoring docs.

Manual smoke checklist:

- Click **New issue** and confirm it opens the assistant path.
- Follow the issue route `/projects/:slug/assistant/issue/:id`.
- In Complex mode, confirm docs appear and refresh after assistant edits.
- In issue detail, confirm the Agent tab separates **Authoring** and **Execution**.
- Dispatch with **Goal mode** checked for Codex when goals are enabled.

## Issue preview servers

Symphony can start long-running dev servers for an issue workspace and surface their URLs in the
tracker. Enable the feature in `WORKFLOW.md` front matter:

```yaml
dev_server:
  enabled: true
  port_range: [4100, 4199]
  idle_timeout_ms: 1800000
  auto_start_on: pull_request,human_review
```

Defaults are `enabled: false`, `port_range: [4100, 4199]`,
`idle_timeout_ms: 1800000`, and `auto_start_on: [pull_request, human_review]`.
When `base_url` is omitted, each preview URL is built as
`http://127.0.0.1:<allocated-port><url_path>`.

Set `base_url` only for proxy-backed setups:

```yaml
dev_server:
  base_url: https://previews.example.com
```

When set, `base_url` is used as the origin/base before `url_path`; it is not where
Symphony injects the allocated port unless your proxy is configured to route previews that way.

Each workspace repo can declare setup and serve steps in `.symphony/devenv.yaml` for
DevEnv proposal/discovery:

```yaml
steps:
  - description: Front dev server
    command: npm run dev
    working_dir: front
    role: serve
    port_env: PORT
    url_path: /
    ready: http
    ready_path: /health
    primary: true
```

- `role: setup` is for preparation commands; `role: serve` is for long-running preview
  servers. Multiple serve steps are supported.
- `port_env` receives Symphony's allocated port before the command runs.
- `url_path` is appended to the preview URL.
- `ready: tcp` waits for the port to accept connections; `ready: http` probes `ready_path`
  and treats any HTTP response below 500 as responsive.
- `primary: true` picks the preview shown in the Summary tab chip. If no serve step is
  primary, the first serve step becomes primary.

Preview startup uses the saved DevEnv steps for the project, so propose/save or import the
`.symphony/devenv.yaml` steps before expecting previews to auto-start.

In the tracker, the issue drawer includes a **Preview** tab with provisioning status, ready URLs,
and manual **Start Preview**, **Stop Preview**, and **Restart Preview** controls. The Summary tab
also shows a Preview link or provisioning chip when preview status is available. Auto-start checks
wait-state issues and starts previews according to `auto_start_on`: `pull_request` applies to
wait-state issues with linked PRs, and `human_review` applies to human-review wait-state issues.

## Public preview tunnel

Symphony can expose the tracker **and** each ready dev-server preview publicly through a single
Cloudflare named tunnel. A static wildcard ingress (`*.tracker.cods.dev → http://127.0.0.1:4000`)
sends all traffic to the Phoenix hub, and `SymphonyElixirWeb.PublicHostPlug` routes each request by
its `Host` header before the router runs. It is **disabled by default**.

### Host scheme

- **Tracker**: `<namespace>.tracker.cods.dev` → the Phoenix hub on `:4000` (same-origin API +
  websocket).
- **Previews**: `<project>-<issue>-<step>.<namespace>.tracker.cods.dev` → reverse-proxied to the
  matching dev server's loopback port (looked up in the `SymphonyElixir.PublicRouting` ETS
  registry as servers become `:ready`).
- Loopback requests and unknown out-of-namespace hosts pass through to the app; unknown
  in-namespace hosts return `404 Unknown preview host`.
- `<namespace>` defaults to the operator's sanitized GitHub login. Override it with the
  `PUBLIC_NAMESPACE` env var or the `public_tunnel.namespace` WORKFLOW key.

### One-time setup

1. Create a Cloudflare named tunnel and note its ID/credentials:

   ```bash
   cloudflared tunnel create cods-dev-tunnel
   ```

2. Put the tunnel name/ID and Cloudflare API credentials in `elixir/.env` (see the keys below).
3. Nested wildcard hosts (`*.<namespace>.tracker.cods.dev`) need **Cloudflare Advanced Certificate
   Manager (ACM)**: enable ACM for the zone and order an ordered certificate for
   `*.<namespace>.tracker.cods.dev`. Universal SSL only covers a single wildcard level, so the
   nested wildcard will fail TLS without ACM.
4. Create the DNS records (two proxied CNAMEs per namespace — the apex
   `<namespace>.tracker.cods.dev` and the wildcard `*.<namespace>.tracker.cods.dev`, both pointing
   at `<CLOUDFLARE_TUNNEL_ID>.cfargotunnel.com`):

   ```bash
   make tunnel-dns
   ```

### Enable and run

1. Set `public_tunnel.enabled: true` in `WORKFLOW.md`:

   ```yaml
   public_tunnel:
     enabled: true
     base_domain: tracker.cods.dev
     # namespace: your-github-login   # defaults to the GitHub login
   ```

2. Start the tunnel (foreground or background) and re-ensure DNS when needed:

   ```bash
   make tunnel        # run cloudflared in the foreground
   make tunnel-bg     # run in the background
   make tunnel-logs   # tail the background tunnel logs
   make tunnel-status # show whether the tunnel is running
   make tunnel-stop   # stop the background tunnel
   make tunnel-dns    # (re)ensure the apex + wildcard CNAMEs
   ```

### `.env` keys

| Key | Purpose |
|-----|---------|
| `CLOUDFLARED_TUNNEL_NAME` | Name of the Cloudflare named tunnel (e.g. `cods-dev-tunnel`). |
| `CLOUDFLARE_TUNNEL_ID` | Tunnel ID; CNAMEs target `<id>.cfargotunnel.com`. |
| `CLOUDFLARE_API_TOKEN` | API token used to create/ensure DNS records. |
| `CLOUDFLARE_ZONE_ID` | Zone ID for `cods.dev`. |
| `CLOUDFLARE_ZONE_NAME` | Zone name (e.g. `cods.dev`). |
| `PUBLIC_NAMESPACE` | Optional namespace override (defaults to the GitHub login). |
| `PUBLIC_TUNNEL_ROUTE_DNS` | Set truthy to let `make tunnel-dns` create/ensure the CNAMEs. |

### Security

Once enabled, previews are **unauthenticated** — anyone with the URL can reach the running app.
Only enable the tunnel for non-sensitive work, or place the hosts behind **Cloudflare Access** (or
another auth layer) before exposing anything that matters.

## Browser editor (code-server)

Symphony can open a task's workspace directory in a browser-based VS Code
([code-server](https://github.com/coder/code-server)). It is **disabled by default**.

Enable it with an `editor:` block in `WORKFLOW.md`:

```yaml
editor:
  enabled: false        # set to true to enable
  binary: code-server   # binary name or absolute path
  host: 127.0.0.1
  port: 4002
  auth: none            # "none" (localhost only) or "password"
  # password: your-password                # only used when auth: password
  # base_url: https://editor.example.com   # browser-facing URL override (remote/proxy)
```

- `code-server` must be installed on the host (or set `editor.binary` to its absolute path).
- When enabled, Symphony supervises a single `code-server` process — spawned on startup
  and bound to `host:port`.
- In the tracker `IssueDrawer`, an **Open in VS Code** button (and the `.` keyboard
  shortcut) opens the task's workspace in a new browser tab (`base_url` defaults to
  `http://<host>:<port>`). Workspaces without repo subdirectories use
  `<base_url>/?folder=<workspace path>`; workspaces with multiple editor roots use a
  generated `.symphony/editor.code-workspace` and `<base_url>/?workspace=<workspace file>`.
- When task hooks clone buildable repositories under `front/`, `repo/`, or `back/`,
  Symphony opens those roots directly. If the task workspace also has a `docs/`
  directory, it is included as an additional VS Code root so specs, plans, and handoff
  files remain visible beside the repos.
- Before opening or creating a workspace, Symphony prepares discoverable agent skills for
  Codex and Claude Code by linking `.codex/skills` and `.claude/skills` to a generated
  flat mirror under `.symphony/skills`. The same links are added inside direct editor
  roots such as `front/`, `back/`, and `docs/` when they exist.
- The button is disabled while the editor is starting or unavailable, and when the
  workspace directory does not exist yet (it is not auto-created — run the agent or open
  the Terminal tab first).
- **Security**: `auth: none` is only safe on localhost (the default bind is `127.0.0.1`).
  To expose it remotely, use `auth: password` with a `password` and set `base_url`.

## Project Layout

- `lib/`: application code and Mix tasks
- `test/`: ExUnit coverage for runtime behavior
- `WORKFLOW.md`: in-repo workflow contract used by local runs
- `../.codex/`: repository-local Codex skills and setup helpers
- `../.claude/`: repository-local Claude configuration

## Testing

```bash
make all
```

## FAQ

### Why Elixir?

Elixir is built on Erlang/BEAM/OTP, which is great for supervising long-running processes. It has an
active ecosystem of tools and libraries. It also supports hot code reloading without stopping
actively running subagents, which is very useful during development.

### What's the easiest way to set this up for my own codebase?

Launch your preferred coding agent in your repo, give it the URL to the Symphony repo, and ask it
to set things up for you.

## License

This project is licensed under the [Apache License 2.0](../LICENSE).
