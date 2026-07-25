# Dev10x Elixir

This directory contains the current Elixir/OTP implementation of Dev10x — a multi-project agent
orchestrator with a React tracker UI, local-first remote sync, and optional public preview tunnels —
based on [`SPEC.md`](../SPEC.md) at the repository root.

> [!WARNING]
> Dev10x Elixir is prototype software intended for evaluation only and is presented as-is.
> We recommend implementing your own hardened version based on `SPEC.md`.

## Screenshot

![Symphony Elixir screenshot](../.github/media/elixir-screenshot.png)

## How it works

1. Keeps a **local-first mirror** of each remote tracker (GitHub, Linear, or JIRA) in SQLite;
   the UI and orchestrator read from the local store while a background sync engine pushes
   outbox writes and pulls remote changes on a coalesced schedule
2. Polls active projects for candidate work (each project carries its own tracker config and prompt)
3. Creates an isolated workspace per issue under `<workspace.root>/<project_slug>/<issue>`
4. Launches the configured coding agent (Codex or Claude) inside the workspace
5. Sends the project's workflow prompt to the agent
6. Keeps the agent working on the issue until the work is done

During Codex app-server sessions, Symphony also serves client-side dynamic tools (`linear_graphql`,
`github_graphql`) so repo skills can make raw GraphQL calls.

If a claimed issue moves to a terminal state (`Done`, `Closed`, `Cancelled`, or `Duplicate`),
Symphony stops the active agent for that issue and cleans up matching workspaces.

## Session / Run Quick-Open Launcher

Press **⌘J** / **Ctrl+J** anywhere in a project workspace to open the tabbed **New Session**
launcher (mirrors Jean's worktree modal). v1 ships four source tabs:

| Tab | Source | Action |
|-----|--------|--------|
| **Actions** | Curated quick commands (new issue, board, filters, assistant, KB) | Navigate |
| **Issues** | Project issue list (fuzzy + exact-number search) | Jump to Agent → Execution |
| **PRs** | Open PRs across configured repos | Deep-link via `Symphony-Issue:` marker, else open PR externally |
| **Branches** | Repo branches via GitHub REST | Map to issue via `issue.branchName`, else open branch on GitHub |

**Hold ⌥/Alt** while selecting an issue-linked row to **resume the run in the background**
(`dispatchIssueAgent` with `action: "resume"`) without navigating away.

Project-scoped read endpoints (cached 60s via `GitHub.ReadCache`):

- `GET /api/tracker/v1/projects/:project_slug/pull_requests` — open PRs annotated with marker-derived `issue_identifier`
- `GET /api/tracker/v1/projects/:project_slug/branches` — repo branches with protection metadata

Both return `{ data, supported }`; projects without configured repos report `supported: false`.

## In-App Workspace Diff

The tracker composer exposes a **Diff** action with **⌘G** / **Ctrl+G**. It opens an in-app workspace
diff viewer with `Branch`, `Uncommitted`, and issue-scoped `Commits` views. The viewer is multi-repo
aware: backend responses are grouped per repo and the frontend prefixes file paths with the repo name
before building the file tree.

Local workspace diffs are exposed through:

- `GET /api/tracker/v1/projects/:project_slug/issues/:identifier/diff?type=branch|uncommitted`
- `GET /api/tracker/v1/assistant/threads/:thread_id/diff?type=branch|uncommitted`

The `Commits` tab reuses the commit evidence endpoints for agent commits ahead of the integration
branch.

## Installation

Symphony does **not** use a global `WORKFLOW.md`. Process settings live in `elixir/.env`
(`SYMPHONY_*` variables); each project's workflow (YAML front matter + agent prompt) is stored as
`workflow_markdown` in the SQLite database and edited from the tracker UI.

### Development checkout versus installed service

`make serve` is the development daemon. It runs from the source checkout and
supports the existing `make update` hot-reload workflow. It is not replaced or
managed by the installed-service commands.

For a self-contained production release:

```bash
make release
make release-smoke
```

`make release-smoke` boots the packaged OTP release with bundled ERTS, SQLite
NIF, migrations, static assets, and skills from a temporary directory. It does
not use source, `deps`, or `_build` at runtime. The generated
`symphony-<version>-linux-<architecture>.tar.gz` carries a target-identity
manifest and per-file SHA-256 checksums validated before installation.

Install the release as a resilient `systemd --user` service:

```bash
make daemon-install ARGS="--i-understand-that-this-will-be-running-without-the-usual-guardrails"
symphony daemon status
```

The installed service runs immutable versioned releases under
`~/.local/lib/symphony`; source edits and `make update` do not change it. Build
and install a new release to upgrade it. See [`INSTALL.md`](../INSTALL.md) for
XDG paths, migration, lingering, rollback, port-conflict, journal, and uninstall
details.

## Telegram gateway

Symphony can expose the maestro through a Telegram bot. The first gateway implementation is
Telegram-only, while the backend uses a provider-neutral gateway adapter so future chat gateways can
reuse the same binding, command, and session flow.

Configure Telegram from the tracker UI:

1. Open **Settings → Gateways**.
2. Store the Telegram bot token from BotFather. Tokens are stored as encrypted credentials.
3. Enable the Telegram gateway and long polling.
4. Generate a group pairing code and send `/symphony_setup <code>` in the target Telegram group.
5. Add Telegram user IDs to the group allowlist and direct-message allowlist.

Project topics are configured per project:

1. Open **Project settings → Integrations**.
2. Generate a project pairing code.
3. Send `/symphony_pair <code>` inside the desired Telegram forum topic.
4. Messages in that topic use the project's maestro session, scoped by Telegram topic id.

Direct 1:1 chats with the bot are freeform assistant chats. They are scoped to the Telegram direct
chat/sender and require the sender's Telegram user ID in the direct-message allowlist.

The group's **General** topic (and plain group messages in that chat) use one shared freeform
session for the group, gated by the group allowlist — same pattern as a project topic, without a
project pairing.

Supported Telegram commands:

- `/help`, `/ajuda`
- `/status`, `/estado`
- `/agent`, `/agente`
- `/mode`, `/modo`
- `/new`, `/novo`, `/reset`
- `/stop`, `/parar`
- `/setup`, `/configurar`

Project-specific modes (`explore`, `project`, `issue`, `kb`) require a paired project topic. Direct
1:1 chats use `freeform` mode in this release.

### 1. Prerequisites

**Core setup** (`make env-setup` + `make serve`) needs only the tools marked **required** below.
`code-server` and `cloudflared` are **not** required to boot the tracker — install them only when
you enable the matching feature.

| Tool | Required | Needed for |
|------|----------|------------|
| [mise](https://mise.jdx.dev/) | recommended | Pins Elixir `1.19` / OTP `28` from `.mise.toml` |
| [GitHub CLI](https://cli.github.com/) (`gh`) | **yes** | `make env-setup` → `GITHUB_TOKEN` |
| Git | **yes** | cloning, workspaces |
| [Codex CLI](https://github.com/openai/codex) | **yes** (default agent) | `codex app-server` on `PATH` |
| Node.js 20+ | frontend dev only | `make tracker-build` — skip if using committed `priv/static/tracker` |
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) | if using Claude | local `claude` on `PATH` (run `claude` once to log in); the Claude backend is built in |
| [code-server](https://github.com/coder/code-server) | if using browser editor | `SYMPHONY_EDITOR_ENABLED=true` → `make install-code-server` |
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) | if using public tunnel | `public_tunnel.enabled: true` + `make tunnel` |

Run `make check-tools` to see what is installed (required tools report ✗ when missing; optional
tools report … when absent).

| Feature | Enable | Install |
|---------|--------|---------|
| Browser VS Code | `SYMPHONY_EDITOR_ENABLED=true` in `.env` | `make install-code-server` (optional: `make configure-code-server`) |
| Local Telegram voice transcription | `SYMPHONY_WHISPER_CPP_BIN` + `SYMPHONY_WHISPER_MODEL` in `.env` | Install `ffmpeg`, build `whisper.cpp`, download a `ggml-*` model |
| Public preview tunnel | `public_tunnel.enabled: true` in project `workflow_markdown` + Cloudflare `.env` keys | [Install `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then `cloudflared tunnel create …` |

**Cursor Desktop** ("Open in Cursor" in the issue drawer) uses the local `cursor://` handler — no
`code-server` install needed.

Your target codebase should follow [harness engineering](https://openai.com/index/harness-engineering/)
practices so agents can work autonomously.

### 2. Clone and install dependencies

```bash
git clone https://github.com/sapsaldog/symphony
cd symphony/elixir
mise trust
mise install
make setup          # Elixir deps, compile, DB setup
```

### 3. Configure environment

Requires `gh` authenticated (`gh auth login`). Symphony needs `repo` and `project` scopes — refresh
if needed:

```bash
gh auth refresh -s repo,project,read:org
```

Bootstrap `.env` with a **new** tracker secret and your GitHub token from `gh`:

```bash
make env-setup
```

Equivalent one-liner:

```bash
bash scripts/setup-env.sh
```

The script copies `.env.example` → `.env` when missing, then sets:

- `SYMPHONY_TRACKER_TOKEN` — `openssl rand -hex 24`
- `GITHUB_TOKEN` — `gh auth token`

Edit `elixir/.env` afterwards for optional trackers (Linear, JIRA) and tunables. See
`.env.example` for the full list (editor, tunnel, sync cadence, Codex defaults).

### 4. Build the tracker UI (first time or after frontend changes)

```bash
make tracker-build    # writes to priv/static/tracker
```

Skip this step if you only need the pre-built assets already in the repo.

### 5. Start Symphony

```bash
make serve            # http://localhost:4000/tracker
```

Logs: `.symphony/serve.log`. Stop with `make stop`.

### 6. Create your first project (tracker UI)

1. Open `http://localhost:4000/tracker` and authenticate with `SYMPHONY_TRACKER_TOKEN`.
2. Click **New project** and pick a slug.
3. Open **Settings** → workflow editor: paste or write `workflow_markdown` (see
   [workflow_markdown format](#workflow_markdown-format) below).
4. Link the GitHub repo / Linear project / JIRA project key as needed.
5. Create or label an issue — the orchestrator picks it up on the next poll.

Optionally copy Symphony skills (`commit`, `push`, `pull`, `land`, `linear`, `github-projects`)
into your target repo. The `linear` skill expects Symphony's `linear_graphql` app-server tool.

## Tracker setup (per project)

Configure each project from the tracker **Settings** tab (`workflow_markdown` front matter).

### GitHub

Set `github.repo` to `owner/repo`. Symphony bootstraps a repo-level GitHub Project v2 named
`Symphony` (configurable via `github.project.title`) on first run and tracks issue state through
the GitHub Project `Status` single-select field — the single source of truth — whose options come
from `tracker.field_states` when set, otherwise `tracker.active_states` plus
`tracker.terminal_states`. Use `field_states` to include board-only options such as `Backlog` that
are not polled. Local project metadata is cached in `.symphony/github-project.json` (gitignored).

Issues are admitted when they carry `symphony`, `symphony:codex`, or `symphony:claude` (base label
configurable via `github.admission_label`, default `symphony`). Agent routing:

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | project/process default (`codex` unless `claude:` is configured) |

The project's `workflow_markdown` must include a `codex:` and/or `claude:` section for the targeted
agent. New labeled issues are added on the next poll.

Optional `github.assignee` further restricts routing (GitHub login or `"me"`). Omit `assignee` to
route by label only.

Blockers are parsed from `trackedInIssues` and from issue-body lines such as `Blocked by #42` or
`Depends on clouapp/front#12`. Linked PR branches populate `issue.branch_name` when GitHub exposes
`linkedBranches`.

Codex sessions expose a `github_graphql` dynamic tool (same contract as `linear_graphql`) for raw
GitHub GraphQL from the agent.

See `elixir/WORKFLOW.macromarkets.example.md` for a dogfood setup on `clouapp/front` (project
**Macro Markets**). Bootstrap the board with `mix run --no-start scripts/bootstrap_macro_markets.exs`.

Required `GITHUB_TOKEN` scopes: `repo` (read+write) and `project` (read+write).

GitHub-backed projects surface a **board URL** in the tracker (from the linked Project v2). When a
linked PR has failing checks, use **Request fix** on the issue drawer to post log tails as a comment
and move the issue to `Rework` for re-dispatch.

For wait-state issues, projects can also enable `pr_monitor` in `workflow_markdown` so Symphony
follows linked PRs in the background: merges can auto-transition to `Done`, fixable CI/review-bot
findings can auto-transition to `Rework` (up to a configured cap), and unrelated/flaky failures stay
in `Human Review` with rerun guidance.

### Linear

To get your project's slug, right-click the project and copy its URL. The slug is part of the URL.
This repo's dogfood setup depends on non-standard Linear issue statuses: "Rework", "Human Review",
and "Merging". Customize them in Team Settings → Workflow in Linear.

### Notion import

Configure a Notion Integration token under **Settings → Providers** (or set `NOTION_API_KEY`).
Share the target page or database with the Integration in Notion.

Codex sessions expose the `import_notion_page` dynamic tool. Pass a Notion URL; the tool writes
temporary Markdown, assets, and metadata under `/tmp/symphony-notion/` (`markdown_path`,
`assets_dir`, `meta_path`). See the `notion` skill in `skills/notion/SKILL.md`.

### JIRA Cloud

Add a `jira:` section and configure workflow states in `tracker:`:

```yaml
jira:
  base_url: $JIRA_BASE_URL
  email: $JIRA_EMAIL
  api_token: $JIRA_API_TOKEN
  project_key: PROJ
  assignee: $JIRA_ASSIGNEE   # optional; defaults to JIRA_EMAIL
tracker:
  active_states:
    - To Do
    - In Progress
    - Rework
  terminal_states:
    - Done
```

Create an API token at [Atlassian account security](https://id.atlassian.com/manage-profile/security/api-tokens).

### Local tracker (SQLite-only)

Add a top-level `local:` section in the project's `workflow_markdown`:

```yaml
local:
  database_path: .symphony/tracker.sqlite3
  project_slug: macro-markets
tracker:
  active_states:
    - Todo
    - In Progress
    - Rework
  terminal_states:
    - Done
    - Closed
```

## Run

Day-to-day operation after [Installation](#installation):

```bash
cd elixir
make serve            # boot daemon → http://localhost:4000/tracker
make stop             # shut down
make update           # hot-restart web (default); see table below for other subtrees
```

Use `make update` to hot-restart subtrees (web, orchestrator, or code-server) without stopping
in-flight agent turns. See [Running the dev daemon](#running-the-dev-daemon-restart-only-what-you-changed).

### Homebrew (packaged binary)

```bash
brew tap sapsaldog/symphony
brew install symphony

export SYMPHONY_TRACKER_TOKEN=...
export GITHUB_TOKEN=...
symphony --port 4000
```

The Claude backend is built in — Symphony drives your locally installed `claude` CLI directly
(run `claude` once to log in). The packaged `bin/symphony-claude` escript exposes the same
app-server protocol over stdio for external orchestrators (a dynamicTools-capable drop-in for
the retired external bridge), so no separate `symphony-claude` install is needed.

The packaged escript (`bin/symphony`) cannot load the SQLite NIF — **`make serve` from source is
required** for the full local tracker. Homebrew builds may differ; prefer `make serve` for development.

### Packaged escript (debugging only)

```bash
mise exec -- mix build
mise exec -- ./bin/symphony --i-understand-that-this-will-be-running-without-the-usual-guardrails --port 4000
```

No workflow file argument — config comes from `elixir/.env` and the DB, same as `make serve`.

## Configuration

Configuration is split into two layers:

### Process-level settings (`SYMPHONY_*` env / `config/runtime.exs`)

These apply to the whole BEAM process and are read from `elixir/.env` when using `make serve`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SYMPHONY_TRACKER_PORT` | `4000` | HTTP port for the tracker + API |
| `SYMPHONY_TRACKER_TOKEN` | — | Bearer token for tracker API and websocket auth |
| `SYMPHONY_POLL_INTERVAL_MS` | `60000` | Orchestrator poll loop interval |
| `SYMPHONY_PR_MONITOR_INTERVAL_MS` | `60000` (falls back to `SYMPHONY_POLL_INTERVAL_MS`) | PR follow-up monitor tick interval |
| `SYMPHONY_TRACKER_SYNC_MIN_PULL_MS` | `60000` | Min spacing between remote pulls per project |
| `SYMPHONY_TRACKER_PR_SYNC_TTL_MS` | `300000` | TTL before re-enriching an issue's linked PRs |
| `SYMPHONY_MAX_CONCURRENT_AGENTS` | `10` | Global agent concurrency cap |
| `SYMPHONY_MAX_TURNS` | `20` | Default max turns per agent invocation |
| `SYMPHONY_CODEX_COMMAND` | `codex … app-server` | Default Codex app-server command |
| `SYMPHONY_CODEX_APPROVAL_POLICY` | `never` | Instance Codex approval policy |
| `SYMPHONY_CODEX_THREAD_SANDBOX` | `workspace-write` | Instance Codex thread sandbox |
| `SYMPHONY_CLAUDE_COMMAND` | `claude` | Claude Code CLI invoked per turn by the native backend |
| `SYMPHONY_DEFAULT_AGENT_KIND` | `codex` | Fallback agent when a project omits `codex:`/`claude:` |
| `SYMPHONY_EDITOR_*` | — | Browser editor (code-server) overrides |
| `SYMPHONY_LOCAL_TRACKER_DATABASE` | `.symphony/tracker.sqlite3` | SQLite path |
| `SYMPHONY_LOCAL_TRACKER_BUSY_TIMEOUT_MS` | `5000` | How long a write waits for SQLite's single writer lock before raising `Database busy` |
| `SYMPHONY_BACKUP_DIR` | `.symphony/backups` | Backup storage directory |
| `SYMPHONY_BACKUP_RETENTION_DAYS` | `30` | Backup retention window |
| `SYMPHONY_EDITOR_ENABLED` | `false` | Enable browser code-server |
| `SYMPHONY_EDITOR_PORT` | `4002` | code-server listen port |
| `SYMPHONY_EDITOR_HOST` | `127.0.0.1` | code-server bind address |

Packaged CLI flags: `--logs-root <path>`, `--port <port>` (no workflow file argument).

### Per-project settings (`workflow_markdown` in the tracker DB)

Each project's setup stores a single `workflow_markdown` document: YAML front matter plus a Markdown
prompt body. At dispatch, `SymphonyElixir.ProjectConfig.resolve/1` validates the front matter against
the schema; omitted keys inherit **schema defaults**. The prompt comes solely from the markdown body —
projects without a prompt are skipped.

Edit from the tracker UI (**Settings** → workflow editor) or via `PUT /api/tracker/v1/projects/:id/setup`.

### workflow_markdown format

Each project stores one markdown document: YAML front matter between `---` fences, then the agent
prompt body. Example files live in `WORKFLOW.*.example.md` (e.g. `WORKFLOW.macromarkets.example.md`).
If `workspace.root` is omitted, Symphony defaults workspaces to `~/code/workspaces`.

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
pr_monitor:
  enabled: false
  max_auto_rework: 2
  done_on_merge: true
source_control:
  branch_pattern: "symphony/{issue}"
  pr_title_pattern: "{issue}: {title}"
  issue_marker_key: "Symphony-Issue"
claude:
  command: claude
---

You are working on issue {{ issue.identifier }}.

Title: {{ issue.title }} Body: {{ issue.description }}
```

Minimal example (JIRA + Codex):

```md
---
tracker:
  kind: jira
jira:
  base_url: $JIRA_BASE_URL
  email: $JIRA_EMAIL
  api_token: $JIRA_API_TOKEN
  project_key: PROJ
tracker:
  active_states:
    - To Do
    - In Progress
  terminal_states:
    - Done
workspace:
  root: ~/code/workspaces
codex:
  command: codex app-server
---

You are working on JIRA issue {{ issue.identifier }}.

Title: {{ issue.title }} Body: {{ issue.description }}
```

Notes:

- If a value is missing, schema defaults are used.
- **`source_control`** declares the PR↔issue association contract (all optional;
  defaults shown above): `branch_pattern` and `pr_title_pattern` are advisory
  naming conventions, while `issue_marker_key` is the **authoritative** link —
  Symphony writes `<issue_marker_key>: <identifier>` (e.g. `Symphony-Issue: GAM-2`)
  into PR bodies and discovers PRs by that marker plus the parseable
  `symphony:prs` block in the issue's `## Codex Workpad` comment. The PR monitor
  reconciles detected PRs back onto the task (local cache + workpad).
- **Tracker backends**: `github` (default), `linear`, `jira`, `local` (SQLite-only), `memory`
  (testing). Detected from which YAML section (`github:`, `linear:`, `jira:`, `local:`, or
  `memory:`) is present in the front matter. Remote-backed projects (`github`, `linear`, `jira`)
  use **local-first sync** by default (see below).
- **Coding agent backends**: `codex`, `claude`. Detected from which YAML section (`codex:` or
  `claude:`) is present. The process default is `SYMPHONY_DEFAULT_AGENT_KIND` (`codex`); a project's
  own `codex:`/`claude:` section overrides it. Issue create/edit always offers both Codex and Claude
  as per-task agent choices (GitHub label routing: `symphony:codex` / `symphony:claude`).
- **Per-project agent overrides** in `agent:` front matter (`max_turns`, `turn_timeout_ms`,
  `read_timeout_ms`, `stall_timeout_ms`, `completion_transitions`,
  `max_concurrent_agents_by_state`) fall back to the matching `SYMPHONY_*` process default when unset.
- **Codex-specific policy settings** (instance defaults via `SYMPHONY_CODEX_*`; per-project overrides
  in `codex:` front matter):
  - Instance `SYMPHONY_CODEX_APPROVAL_POLICY` defaults to `never`. Per-project `codex.approval_policy`
    overrides it. Supported values depend on the Codex app-server version. String values include
    `untrusted`, `on-failure`, `on-request`, and `never`; object-form `reject` is also supported.
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
  - Issue authoring chat does **not** mirror normal replies as tracker comments (they stream in the
    chat UI). Stable fields go through `update_issue`; `add_comment` is available when the user
    explicitly asks to record a comment on the issue. `dispatch_codex` still posts a single
    milestone comment on handoff. This keeps the chat from spamming the remote tracker.
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
- Per-project `workflow_markdown` requires an explicit prompt body — projects with a blank body are
  skipped by the orchestrator.
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

- Each project is validated independently at save time and at dispatch — a misconfigured project is
  skipped with a warning; other projects keep running.
- `SYMPHONY_TRACKER_PORT` or CLI `--port` enables the Phoenix tracker and JSON API at `/tracker`,
  `/api/v1/*`, and `/api/tracker/v1/*`.

### Local-first tracker sync

By default (`config :symphony_elixir, :tracker, sync_enabled: true` outside `:test`), remote-backed
projects mirror issues into SQLite and serve reads from the local store:

- **Writes** (create, update, move, archive) persist locally, enqueue an outbox entry, and are pushed
  to the remote by `SymphonyElixir.Tracker.Sync.Engine`.
- **Reads** (board, issue detail, comments) hit the local mirror — the UI stays responsive even when
  GitHub/Linear/JIRA is rate-limited.
- **Pull coalescing**: the orchestrator poll triggers a background sync, but each project's remote
  pull is skipped when it ran within `SYMPHONY_TRACKER_SYNC_MIN_PULL_MS` (default 60s). Outbox pushes
  still flush on every poll.
- **PR enrichment**: linked PRs and check runs are re-fetched at most once per
  `SYMPHONY_TRACKER_PR_SYNC_TTL_MS` (default 5 min) per issue.

Tune `SYMPHONY_POLL_INTERVAL_MS`, `SYMPHONY_TRACKER_SYNC_MIN_PULL_MS`, and
`SYMPHONY_TRACKER_PR_SYNC_TTL_MS` in `elixir/.env` to reduce GitHub API pressure.

### Publish gate (run contract)

After each agent run, the orchestrator verifies deliverables before applying
`completion_transitions`: every repo in the workspace with committed work must
have a pushed branch and a non-closed pull request. Violations trigger up to 2
corrective agent turns; if work remains unpublished, Symphony pushes the branch
(`symphony/<identifier>` when work sits on the default branch) and opens the PR
mechanically. If even that fails, the issue receives the `symphony:blocked`
label plus a workpad note and is NOT transitioned. Verified/created PRs are
linked to the issue deterministically (origin `agent`).

### Plan gate and reliable workpad

Right after the agent's first turn, the orchestrator verifies that the issue has
a `## Codex Workpad` comment (the single human-readable source of truth: plan,
acceptance criteria, validation, outcome — see the `workpad` skill). A missing
workpad triggers one corrective turn; if it is still missing the run continues
with a logged warning (the plan gate never strands implementation work).

Plan-driven runs also use the workpad as a machine-readable execution contract:

```markdown
### Plan
source_plan: docs/superpowers/plans/2026-06-23-dis-6-admin-i18n-complete-plan.md
mode: full-plan
scope_status: in_progress
final_validate_allowed: false
final_publish_allowed: false

- [x] Task 1: Stabilize existing first slice
- [~] Task 2: Add Tasks namespace
- [ ] Task 3: Add Distribution namespace
```

`Workpad.ExecutionContract` parses this single Plan block. While any plan item
is `[ ]` or `[~]`, Symphony treats the issue as scope-incomplete: final VALIDATE
and publish corrective turns are skipped, goal-mode continuation is not stopped
just because a turn ended, and an open PR is treated as a checkpoint rather than
completion. Once every task is `[x]`, the agent sets `scope_status: complete`
and flips `final_validate_allowed` / `final_publish_allowed` to `true`, allowing
the final evidence and publish gates to run.

Workpads are first-class in sync:

- Locally authored comments are classified by body (`Tracker.Workpad`) and start
  with `sync_status: "pending"`; pushing through the outbox flips them to
  `"synced"` (or `"error"` after exhausted attempts), surfaced as a badge in the
  issue detail UI.
- `Tracker.upsert_workpad/2` edits the existing workpad in place instead of
  stacking comments, enqueueing a coalesced `comment:update` outbox operation.
  Symphony-generated notes (incomplete runs, publish-gate blocks) use this path.
- All three remote drivers push comment updates in place: GitHub
  (`updateIssueComment` GraphQL / REST `PATCH`), Linear
  (`commentCreate`/`commentUpdate` GraphQL), and Jira (REST `PUT`). An update
  whose create was never pushed degrades to a create.

### Validate gate and evidence

Projects can require test evidence per run via an `evidence:` block in the
workflow config:

```yaml
evidence:
  test_command:
    frontend: "npm test -- --watchAll=false"
    backend: "php artisan test"
  e2e_command:
    frontend: "npx playwright test"
  ui_paths:
    - "frontend/src/**"
  required: true
```

When `required: true` and the run changed any repo, the final VALIDATE gate runs
before the publish gate only after the execution contract says the plan scope is
complete. Earlier test runs are slice evidence: useful for the current task
slice, but not a handoff signal. The agent (guided by the `evidence` skill) must write
`.symphony/evidence/manifest.json` with its test runs and artifacts. The
orchestrator verifies — never trusting the agent's judgment — that:

1. the manifest is valid and every referenced artifact exists on disk;
2. every changed repo has a `unit` run with `status: "passed"`;
3. when changed files match the `ui_paths` globs (computed by
   `Evidence.GitDiff`, not declared by the agent), a passing `e2e` run exists
   with at least 1 screenshot and 1 video;
4. every declared command actually appears in the Codex session log
   (`Evidence.SessionAudit` — anti-fraud, fails closed).

Violations trigger up to 2 corrective turns; if still unsatisfied the run ends
incomplete (`validate_gate`) and the issue is annotated instead of silently
moving to review. On successful completion the manifest and artifacts are
copied to a durable store (`.symphony/evidence/<project>/<issue>/<run_id>/`,
persisted in the `issue_evidence` table — they survive workspace cleanup), a
`## Codex Evidence` comment (table + screenshot links) is posted to the issue,
and everything is browsable in the issue drawer's **Evidence** tab
(screenshot gallery, videos, reports, per-attempt history).

The evidence comment is edited **in place** on every update (classified by
`Tracker.Workpad`), so remote trackers never get spammed with duplicate
comments. Embedded artifact URLs are made reachable per provider before the
comment is pushed:

- **GitHub** renders the Symphony-served URLs directly; when the public tunnel
  is enabled the comment uses the tunnel URL (`PublicRouting.public_base_url/0`)
  so images load outside localhost.
- **Linear** and **Jira** upload the artifacts **natively** at push time
  (`Evidence.RemoteArtifacts` rewrites the body): Linear via `fileUpload`
  (`Linear.Uploads`, embeds the `assetUrl`), Jira as issue **attachments**
  (`Jira.Uploads`, links the Jira `content` URL — the files also appear in the
  issue's Attachments panel). Uploads are cached by content hash
  (`evidence_remote_assets`) so repeated in-place updates never re-upload.

### Agent preference

Symphony resolves which coding agent runs an issue through a four-level chain, from most
specific to least:

1. **Task label** — an issue labeled `symphony:codex`, `symphony:claude`, or `symphony:cursor`
   overrides everything.
2. **Project `agent.kind`** — the WORKFLOW front matter `agent.kind: codex|claude|cursor` sets the
   project default.
3. **User default** — the operator default configured in **Settings** (tracker sidebar →
   Settings → Coding agent), shown with availability indicators (green dot = CLI found,
   grey = not found).
4. **Fallback** — Codex if nothing else is set.

Where to configure each level:

- **Settings page** (tracker sidebar → Settings → Coding agent): set the instance-wide default
  agent and see whether the `codex`, `claude`, and `cursor-agent` CLIs are available on the
  server's `PATH`.
- **Project picker** (Project settings → Workflow tab): set `agent.kind` for a single project
  without editing the WORKFLOW file directly.
- **Per-issue chips**: the issue create dialog and the issue's Agent tab let you add or remove
  `symphony:codex` / `symphony:claude` / `symphony:cursor` labels to pin a specific agent to
  that issue.
- **Assistant composer**: the agent menu in the composer lets you choose which agent runs the
  next `dispatch_coding_agent` call (also exposed as `dispatch_codex` for back-compat).

The Claude and Cursor model catalogs are static. Effort levels (`codex.approval_policy`, sandbox
policy) are Codex-only and have no equivalent in the Claude/Cursor backends.

#### Cursor Agent backend

The `cursor` agent runs the [Cursor CLI](https://cursor.com/docs/cli) (`cursor-agent`) per turn in
headless mode (`--print --output-format stream-json --stream-partial-output`), resuming the
chat across turns via `--resume <chat id>`. The `--force` flag (bypass approvals) is added only when
the operator selects the **Yolo** execution mode (see _Execution control_ below). Configure it with:

- `SYMPHONY_CURSOR_COMMAND` — instance-wide CLI command (default `cursor-agent`).
- A `cursor:` section (`command:` key) in a project's `workflow_markdown` for per-project overrides.
- The CLI must be authenticated on the host (`cursor-agent login` or `CURSOR_API_KEY`).

Symphony's dynamic tools (`set_issue_status`, `github_graphql`, ...) are exposed through the shared
MCP gateway: the session merges a `symphony` server entry into `<workspace>/.cursor/mcp.json`
(restored on session stop) and the run passes `--approve-mcps`.

### Execution control (model / effort / mode)

The execution composer (issue → Agent tab) lets the operator pick the **model**, **reasoning
effort**, and an **execution mode** that actually drive the orchestrator run — not just the
assistant chat. These are sent on the dispatch endpoint and persisted per issue.

- **Dispatch params.** `POST /api/tracker/projects/:slug/issues/:id/dispatch` accepts, in addition
  to `action`/`agent`/`goal`/`instructions`/`target_status`, the optional `model`, `effort`, and
  `mode` fields. Blank values are ignored.
- **Persistence.** Selections are written to the `local_tracker_issue_agent_settings` table (keyed
  by `project_slug` + `identifier`, so it works for GitHub/Jira/Linear/local issues alike) and read
  back by `AgentRunner` when building the run. Explicit caller opts win over persisted settings,
  which win over project/workflow defaults.
- **Execution mode is an operator override.** When no mode is selected, the Codex adapter behaves
  exactly as before — the project/workflow `codex:` config governs sandbox and approval. A selected
  mode maps to per-agent policy knobs (`SymphonyElixir.ExecutionMode`). The default mode is **yolo**:
  agent runs are non-interactive, so a mid-run approval prompt cannot be answered and would stall or
  fail the turn.

  | mode  | Codex sandbox / approval                     | Claude `permission_mode` | Cursor                                      |
  | ----- | -------------------------------------------- | ------------------------ | ------------------------------------------- |
  | plan  | `read-only` (approval unchanged)             | `plan`                   | `--mode plan` (no `--force`)                |
  | build | `workspace-write` (approval unchanged)       | `bypassPermissions`\*    | `--force` + Symphony MCP approval card      |
  | yolo  | `danger-full-access`, approval pinned `never`| `bypassPermissions`      | `--force` (no approval prompts)             |

  \*Interactive Claude `build` uses `--permission-mode default` plus the MCP approval shim; the
  autonomous ceiling is `bypassPermissions`. Cursor headless runs need `--force` for MCP write
  tools to reach the Symphony gateway; interactive `build` then pauses mutating Symphony tools on
  the composer approval card.

  Claude has no OS sandbox, so `permission_mode` is its only knob. Headless (`--print`) runs have no
  TTY to approve tool use, and `acceptEdits` still prompts for `Bash`/non-edit tools — so both
  `build` and `yolo` use `bypassPermissions`; only `plan` stays read-only.

- **UI.** The composer's `ExecutionModeMenu` shows Plan/Build/Yolo with icons and a one-line
  description; `Shift+Tab` while typing cycles through the modes available for the active agent.
  The model picker marks the catalog default with a ★ and shows a thinking-intensity icon per
  reasoning-effort level.

### Assistant turn tracking & Resume

Each assistant chat turn is tracked durably so the UI can recover after a refresh or a full serve
restart. Design spec: `docs/superpowers/specs/2026-06-21-assistant-turn-session-tracking-design.md`.

- **Durable state, no new table.** The thread's latest turn lives in `assistant_threads.metadata`
  under `current_turn` (status, prompt, Codex thread/turn ids, timing) — written through
  `SymphonyElixir.Assistant.History`. Full per-turn history stays in `log/symphony.log`.
- **`Assistant.TurnManager`** is an always-on GenServer (started by `SharedSupervisor` after
  `Repo`, independent of the web server). It owns the turn lifecycle: it spawns + monitors the
  worker, holds the live worker pid in a `:unique` registry keyed by `thread_id`, and streams
  lifecycle over the per-thread PubSub topic. On boot it reconciles any turn still marked `running`
  to `interrupted (serve_restart)`.
- **Re-attach after refresh.** The channel join exposes `last_turn` + `turn_running`, so a reloaded
  tab immediately shows the running indicator (or an **Interrupted** banner with a **Resume** button
  that re-dispatches the saved prompt, continuing the same Codex thread).
- **Steer-then-queue.** A new message sent while a turn runs steers the live turn (cross-channel via
  the registry) instead of starting a second Codex session; if it cannot steer, it is queued and run
  next. Project-scoped chats (no durable thread) keep the legacy single-turn busy guard.

### Local Tracker Development

The local tracker runs from the same Phoenix server as the API and stores data in the SQLite path
configured by `SYMPHONY_LOCAL_TRACKER_DATABASE` (default `.symphony/tracker.sqlite3`). The React app
uses `SYMPHONY_TRACKER_TOKEN` as a bearer token for `/api/tracker/v1/*` and the tracker channel.

The simplest way to run the tracker locally is the resilient `make serve` target. It ensures
dependencies and database migrations and boots the app through Mix — which is required because
the packaged escript (`bin/symphony`) cannot load the native SQLite driver NIF. Per-project config
is DB-owned (`workflow_markdown`). See [Installation](#installation) for the full bootstrap flow.
Quick start:

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

#### Tracker CLI (`mix symphony.tracker`)

A thin shell over the same assistant tools the chat assistant and coding agents
use. It connects to the **running** daemon over distributed Erlang (`make serve`
first) so the SQLite DB keeps a single owner — it never starts its own app.

```bash
mix symphony.tracker projects                              # list local tracker projects
mix symphony.tracker issues <slug> [--search TEXT]         # list issues
mix symphony.tracker issue <slug> <id>                     # get one issue
mix symphony.tracker move <slug> <id> <status>             # move to a workflow status
mix symphony.tracker comment <slug> <id> <body>            # add a comment
mix symphony.tracker comments <slug> <id>                  # list comments
mix symphony.tracker dispatch <slug> <id> --instructions "…" [--agent codex]
mix symphony.tracker running [slug]                        # live agents running/retrying (omit slug = all projects)
mix symphony.tracker steer <slug> <id> <message>          # inject a message into a running agent's turn
mix symphony.tracker sync <slug> <id>                      # pull remote tracker state
mix symphony.tracker evidence <slug> <id>                  # evidence gate status
mix symphony.tracker handoff <slug> <id>                   # validate + publish gates
mix symphony.tracker orchestrator <slug> <id>              # live running/retry/idle state
mix symphony.tracker dispatch-explain <slug> <id>          # why an issue is / isn't dispatchable
mix symphony.tracker pr-link <slug> <id> <url>             # attach a PR URL
mix symphony.tracker preview <slug> <id> [status|start|stop|restart]
mix symphony.tracker dev-env <slug> <action> [--step-id ID] [--category CAT]
mix symphony.tracker blockers <slug> <id>                  # list blockers
mix symphony.tracker blockers-add <slug> <id> <target>     # add blocked_by relation
mix symphony.tracker blockers-rm <slug> <id> <target>      # remove blocked_by relation
```

Add `--json` to print the full structured `{tool, message, data}` as one JSON line
(ideal for scripts / `jq`); the default prints a human summary plus pretty data.

#### SQLite backups

Symphony snapshots the tracker database to `.symphony/backups/database/` (configurable via
`SYMPHONY_BACKUP_DIR`). Retention defaults to 30 days (`SYMPHONY_BACKUP_RETENTION_DAYS`).

```bash
make backup              # create a snapshot
make backup-list         # list snapshots
make backup-stats        # storage summary
make backup-cleanup      # remove expired snapshots
```

Restore via Mix: `mix symphony.backup restore <id>`. The tracker API also exposes
`/api/tracker/v1/backups` for create, list, download, restore, and delete.

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
project** on boot — a single BEAM process and single SQLite writer, with each project resolving its
own `workflow_markdown`. There is no global workflow file that gates which projects run.

- **The database is the source of truth.** Each project's setup row stores `workflow_markdown` — a
  single document with YAML front matter and a Markdown prompt body.
  `SymphonyElixir.ProjectConfig.resolve/1` validates the front matter; omitted keys inherit schema
  defaults. Projects without a prompt are skipped with a warning.
- **Per-project behavior**: candidate polling uses each project's `tracker.active_states`; the
  prompt, agent kind (`codex:`/`claude:` overrides), and workspace path come from that project's
  setup. Issue workspaces nest under the project slug (`<workspace.root>/<project_slug>/<issue>`).
- **Project lifecycle**: archive a project to stop orchestration without deleting data; permanently
  delete only after archiving. Issues can be archived/restored independently.
- **Repository management**: the project **Settings** tab links GitHub repos, workspace templates,
  and the workflow editor (Write/Preview markdown, **Load default** from templates).
- **Observability** reports one runtime card per project, using a composite `runtime_id`
  (`<base>:<project_slug>`) with that project's filtered snapshot.
- **Editing**: save via `PUT /api/tracker/v1/projects/:id/setup` or the tracker UI. To bootstrap a
  new project, use **New project** in the sidebar or paste content from a `WORKFLOW.*.example.md`
  template into the workflow editor.

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

### Agent plan usage (rate-limit windows)

Settings → **Plan usage** shows how much of each agent's plan quota is consumed and when each
window resets (the rolling session window, the weekly window, and any credits) — mirroring the
agent CLI's own usage view.

- **Source**: the agent rate-limit payloads already flowing through Symphony. The Codex
  app-server stream carries a `token_count` `rate_limits` map (`%{limit_name, primary, secondary,
  credits}`, each bucket with `usedPercent`, `windowDurationMins`, and a reset field). Those buckets
  reach the observability snapshot per run (`presenter.ex` / `status_dashboard.ex` already format
  them).
- **Normalization**: `SymphonyElixir.AgentUsage.Window.normalize/3` is the single place that maps a
  raw payload into a normalized `Snapshot{agent_kind, plan, credits_remaining, windows[], ...}` where
  each `Window{kind, used_percent, resets_at, window_minutes}` clamps `used_percent` to `0..100` and
  resolves relative `reset_in_seconds` into an absolute epoch (`primary → :session`,
  `secondary → :weekly`).
- **Capture (passive, Codex)**: `SymphonyElixir.Observability.Registry` is the one process-global
  place that sees both `agent_kind` and `rate_limits` per report, so on each report it best-effort
  writes the normalized snapshot into `SymphonyElixir.AgentUsage` (a `:persistent_term`, TTL'd store,
  ~10 min, mirroring `AgentAvailability`). The store outlives a single run/idle so the panel still
  shows "plan X% used" when nothing is running; entries past the TTL are returned but flagged `stale`.
- **Probe (active, Claude)**: Claude has no usable rate-limit signal on the stream (the CLI emits a
  `rate_limit` event, but the adapter does not surface it). So, mirroring the Jean desktop app,
  `SymphonyElixir.Claude.Usage` reads the Claude CLI OAuth token from `~/.claude/.credentials.json`
  and calls Anthropic's OAuth usage API (`GET https://api.anthropic.com/api/oauth/usage`, header
  `anthropic-beta: oauth-2025-04-20`), mapping `five_hour → :session`, `seven_day → :weekly`,
  `seven_day_sonnet → :sonnet_weekly` and `extra_usage` into credits. The usage endpoint triggers it
  best-effort (self-throttled 60s backoff; skipped while a fresh snapshot exists), so it never blocks
  or hammers. It is off under `:test` (`config :claude_usage_probe_enabled`) and fails soft on a
  missing/expired token. Token refresh is a deliberate follow-up (an expired token surfaces as
  `:token_expired` → re-auth via `claude`).
- **Cursor**: no plan-usage source exists (the Jean reference has none either), so Cursor shows
  "Usage unavailable" until one appears.
- **Endpoint** (bearer auth): `GET /api/tracker/v1/settings/agents/usage` returns
  `{ codex, claude, cursor }`, each either `null` (no data / unavailable for that agent) or
  `{ plan, credits_remaining, credits_unlimited, fetched_at, stale, windows: [{ kind, used_percent,
  resets_at, window_minutes }], model_limits }`.
- **UI**: the tracker `AgentUsagePanel` (`useAgentUsage` hook, 5-minute refresh + manual refresh)
  renders a `UsageWindowBar` per window with the reset time; agents without a signal show
  "Usage unavailable for this agent". Usage is intentionally ephemeral (no DB) for v1; a durable
  `agent_usage_snapshots` table for trends is a deliberate follow-up.

### Recents & assistant chats

The sidebar shows a **Recents** group listing the most recent sessions across all projects,
unifying two row kinds: persisted **assistant chat threads** and **Codex/issue runs** (an issue
with an active run or a non-empty `branch_name`). Each row shows its project (or "Geral" when none)
and a status dot; clicking navigates to the chat view or the issue's **Agent** tab. Threads can be
**archived** to hide them from Recents without deleting history.

The assistant also supports **freeform chats** that are not bound to any project, created and opened
from the global **Assistant** area (`/assistant`, `/assistant/:threadId`). Freeform chat is
conversational only in v1 (no tracker tools). The thread model carries a `scope`
(`project`|`freeform`|`issue`) with `issue_identifier`/`title`, and `project_slug` is nullable.
Assistant tool calls record IN/OUT arguments and output for debugging in the chat transcript.

- Assistant file activity renders as compact, expandable cards in the chat:
  file reads come from the existing MCP read-tool calls, while Codex's native
  edits and shell commands are surfaced by relaying its item events through the
  tool-call pipeline.
- Tool calls are keyed by their stable id (Claude `tool_use_id` / Codex id), so
  repeated same-name calls no longer overwrite each other and arrival order is
  preserved during streaming (`tracker` `assistantStream.ts`).
- Consecutive **same-kind** tool calls collapse into a single expandable group
  ("Read N files", "Ran N commands", etc.) via `lib/toolCallGroups.ts` and the
  `ToolActivityTimeline` / `ToolActivityGroup` components. A lone call still
  renders as a single row; a group shows a live spinner while any child runs and
  a red badge if any child failed. Groups update in real time as calls stream in.

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
tracker. Enable the feature in a project's `workflow_markdown` front matter:

```yaml
dev_server:
  enabled: true
  # port_range: [4100, 4199]   # optional — omit to auto-lease from the pool
  # reclaim_ports: true        # optional — kill stale listeners to keep ports stable
  idle_timeout_ms: 1800000
  auto_start_on: pull_request,human_review
```

Defaults are `enabled: false`, `reclaim_ports: false`, `port_range: nil`
(auto-lease, see below), `idle_timeout_ms: 1800000`, and
`auto_start_on: [pull_request, human_review]`.

`reclaim_ports` hardens the port bridge. When `true`, before (re)starting a
serve step Symphony frees that step's **canonical** port (the deterministic
`band/slot/offset` port) by terminating any stale process still listening on it
(`SIGTERM`, then `SIGKILL`, waiting until the socket is bindable), then reuses
the same port instead of drifting onto the next free one. This keeps the
Symphony → preview → public-tunnel mapping stable across restarts and crashes.
A port already served by a healthy, Symphony-tracked instance is never touched.
Leave it `false` (default) for projects that deliberately keep a long-lived
resource (e.g. a shared docker container) bound to a service's port across
restarts, since that resource must not be killed.
When `base_url` is omitted, each preview URL is built as
`http://127.0.0.1:<allocated-port><url_path>`.

Set `base_url` only for proxy-backed setups:

```yaml
dev_server:
  base_url: https://previews.example.com
```

When set, `base_url` is used as the origin/base before `url_path`; it is not where
Symphony injects the allocated port unless your proxy is configured to route previews that way.

### Preview port scheme

Local preview ports are assigned from a node-level pool so multiple projects and
issues never collide and the same project+issue+service keeps a stable port while
it runs. The pool is configured instance-wide (not per project):

| Env var | Default | Meaning |
| --- | --- | --- |
| `SYMPHONY_PREVIEW_POOL` | `10000-30000` | Inclusive global port range. |
| `SYMPHONY_PREVIEW_SLOTS_PER_PROJECT` | `32` | Issue slots per project band. |
| `SYMPHONY_PREVIEW_PORTS_PER_SLOT` | `8` | Ports (serve steps) per issue slot. |

The pool is carved into fixed bands of `SLOTS_PER_PROJECT * PORTS_PER_SLOT` ports.
Each project leases one band (auto, persisted in the tracker DB); each running
issue leases a slot inside that band; each serve step occupies a fixed offset, so
`port = band_start + slot_index * PORTS_PER_SLOT + service_offset`. Slots are
released when an issue's previews stop and garbage-collected if they leak.

Omitting `dev_server.port_range` auto-leases a band from the pool. Setting it
**pins** the project to exactly that range (still carved into slots/offsets),
which is useful for proxy setups that expect fixed ports.

**Migration note:** projects that previously relied on the old `[4100, 4199]`
default now auto-lease from `10000-30000`, so local `127.0.0.1:<port>` URLs move
into that range. Public preview tunnel hostnames are unchanged. To keep the old
neighborhood, set `dev_server.port_range: [4100, 4199]` explicitly.

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

> **Requires `cloudflared`** on the host (see [Prerequisites](#1-prerequisites)). Not needed for
> local-only development.

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

1. Set `public_tunnel.enabled: true` in a project's `workflow_markdown`:

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
| `PUBLIC_TUNNEL_BASE_DOMAIN` | Base domain for preview hosts (e.g. `tracker.cods.dev`). |
| `PUBLIC_NAMESPACE` | Optional namespace override (defaults to the GitHub login). |
| `PUBLIC_TUNNEL_ROUTE_DNS` | Set `true` to let `make tunnel` run DNS setup before starting. |

### Security

Once enabled, previews are **unauthenticated** — anyone with the URL can reach the running app.
Only enable the tunnel for non-sensitive work, or place the hosts behind **Cloudflare Access** (or
another auth layer) before exposing anything that matters.

## Browser editor (code-server)

> **Requires `code-server`** when the browser editor is enabled (`SYMPHONY_EDITOR_ENABLED=true`).
> Install with `make install-code-server`. **Cursor Desktop** does not need `code-server`.

Symphony can open a task's workspace directory in a browser-based VS Code
([code-server](https://github.com/coder/code-server)) or in **Cursor Desktop**. The browser editor
is **disabled by default**.

Enable it in `elixir/.env`:

```bash
SYMPHONY_EDITOR_ENABLED=true
SYMPHONY_EDITOR_HOST=127.0.0.1
SYMPHONY_EDITOR_PORT=4002
# SYMPHONY_EDITOR_BINARY=code-server
# SYMPHONY_EDITOR_AUTH=password
# SYMPHONY_EDITOR_PASSWORD=your-password
# SYMPHONY_EDITOR_BASE_URL=https://editor.example.com
```

Install code-server with `make install-code-server`; optionally run `make configure-code-server` to
install Codex + Claude Code extensions.

- When enabled, Symphony supervises a single `code-server` process — spawned on startup
  and bound to `host:port`.
- In the tracker `IssueDrawer`, **Open in VS Code** (and the `.` keyboard shortcut) opens the task's
  workspace in a browser tab (`base_url` defaults to `http://<host>:<port>`). **Open in Cursor**
  launches Cursor Desktop via a `cursor://` URL (WSL-aware when `WSL_DISTRO_NAME` is set). Workspaces
  without repo subdirectories use `<base_url>/?folder=<workspace path>`; workspaces with multiple
  editor roots use a generated `.symphony/editor.code-workspace` and
  `<base_url>/?workspace=<workspace file>`.
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

## Local Telegram voice transcription (whisper.cpp)

Telegram voice/audio messages can be transcribed locally before they are sent to the assistant. This
avoids depending on the OpenAI audio API for Telegram DMs and project topics.

Install the native tools:

```bash
# Ubuntu/WSL
sudo apt update
sudo apt install -y ffmpeg build-essential cmake git

# Build whisper.cpp somewhere outside this repo.
mkdir -p ~/code
git clone https://github.com/ggerganov/whisper.cpp ~/code/whisper.cpp
cd ~/code/whisper.cpp
cmake -B build
cmake --build build -j

# Download a model. `small` is a good first choice for Portuguese quality.
bash ./models/download-ggml-model.sh small
```

Then configure `elixir/.env`:

```bash
SYMPHONY_FFMPEG_BIN=ffmpeg
SYMPHONY_WHISPER_CPP_BIN=/home/<user>/code/whisper.cpp/build/bin/whisper-cli
SYMPHONY_WHISPER_MODEL=/home/<user>/code/whisper.cpp/models/ggml-small.bin
```

Reload the backend after changing `.env`:

```bash
make update ARGS="--orchestrator"
```

If the local Whisper variables are absent, Symphony falls back to OpenAI transcription when
`OPENAI_API_KEY` is present. If neither local Whisper nor OpenAI is configured, Telegram audio
messages produce a clear transcription error instead of being silently ignored.

## Project Layout

- `lib/`: application code and Mix tasks
- `lib/symphony_elixir/tracker/sync/`: local-first sync engine, outbox, and remote drivers
- `lib/symphony_elixir/jira/`: JIRA Cloud tracker adapter
- `test/`: ExUnit coverage for runtime behavior
- `WORKFLOW.*.example.md`: reference `workflow_markdown` templates (e.g. `WORKFLOW.macromarkets.example.md`)
- `.env.example`: process-level env template for `make serve`
- `../tracker/`: React tracker SPA (builds to `priv/static/tracker`)
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
