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
dependencies and database migrations, injects a dev bearer token, and boots the app through Mix —
which is required because the packaged escript (`bin/symphony`) cannot load the native SQLite
driver NIF:

```bash
cd elixir
make serve            # http://localhost:4000/tracker  (dev token: dev-local-token)
make stop             # stop the running server
```

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
