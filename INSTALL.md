# Symphony — Installation Guide

> Step-oriented document, designed to be executed by a human **or** by an LLM agent.
> Each step has the exact command, the working directory, and the expected verification.

## Overview

Symphony is an agent orchestration service written in **Elixir** (directory `elixir/`) with a
tracker frontend in **TypeScript/React** (directory `tracker/`). It imports "projects"
(e.g. `projects/gamba.yaml`), dispatches GitHub issues to coding agents
(**Codex**, **Claude**, or **Cursor**), and exposes a web tracker on port `4000`.

Important rules for an agent following this guide:

- `mix` is **not on the PATH** directly on this machine. Always use one of the options:
  - The `make ...` targets (the `Makefile` already calls `mise exec -- mix` internally). **Preferred.**
  - Or `mise exec -- mix ...` when you need raw `mix`.
- Most commands run inside `elixir/`. The absolute project path here is
  `/home/gabriel/projetos/Gamba/symphony`.
- Do not commit secrets (`.env`).

---

## 1. Prerequisites

| Tool | Version / source | Used for |
|-----------|------------------|----------|
| `mise` | toolchain manager (`~/.local/bin/mise`) | provides Erlang/Elixir |
| Erlang | `28` (OTP 28) — via `mise` | BEAM runtime |
| Elixir | `1.19.5-otp-28` — via `mise` | compile/run Symphony |
| `gh` | GitHub CLI **authenticated** | tokens + repository clones |
| `node` + `npm` | LTS | tracker frontend |
| `git`, `curl`, `openssl` | base | clones, downloads, generating secrets |
| `docker` | optional | only for full-stack previews (backend/goapi) |

The Erlang/Elixir versions are pinned in `elixir/mise.toml`:

```toml
[tools]
erlang = "28"
elixir = "1.19.5-otp-28"
```

### Quick prerequisites check

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
mise install            # installs erlang/elixir per mise.toml (idempotent)
make check-tools        # validates mise, mix, authenticated gh, code-server, cloudflared
```

`make check-tools` should show `✓ mix runnable` and `✓ gh authenticated`. The optional
items (`code-server`, `cloudflared`) may appear as `…` without any issue.

Confirm the toolchain:

```bash
mise exec -- elixir --version   # Erlang/OTP 28 + Elixir 1.19.x
```

---

## 2. GitHub authentication

Symphony needs a `GITHUB_TOKEN` to sync issues/PRs and clone repositories.

```bash
gh auth status        # should list "Logged in to github.com as <user>"
```

If you are not authenticated:

```bash
gh auth login
```

---

## 3. Configure `.env` (GitHub token + tracker token)

The environment file lives at `elixir/.env`. There are two ways to create/update it.

### Option A — automatic (recommended)

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make env-setup
```

This runs `scripts/setup-env.sh`, which:
- creates `elixir/.env` from `.env.example` (if it doesn't exist);
- generates a new `SYMPHONY_TRACKER_TOKEN` (`openssl rand -hex 24`);
- fills `GITHUB_TOKEN` from `gh auth token`.

> Requires a recent `gh` that supports `gh auth token`. If your `gh` is old and
> `gh auth token` fails with "unknown command", use Option B.

### Option B — manual

Edit `elixir/.env` and make sure these two keys are filled in:

```bash
SYMPHONY_TRACKER_TOKEN=<random secret; e.g. openssl rand -hex 24>
GITHUB_TOKEN=<your GitHub token>
```

To get the `gh` token when `gh auth token` doesn't exist:

```bash
# the token used by gh is in ~/.config/gh/hosts.yml (oauth_token field)
grep oauth_token ~/.config/gh/hosts.yml
```

> Other `.env` variables (JIRA, Cloudflare tunnel, VAPID, etc.) are optional.
> Blank secrets are treated as "undefined" by the application.

---

## 4. Install Elixir dependencies

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
mise exec -- mix deps.get
```

Expected: `All dependencies have been fetched` (or the list of resolved packages).

> Run `mix deps.get` whenever `mix.exs` changes after a `git pull`
> (e.g. a change in push notification dependencies).

---

## 5. Build

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make build
```

Expected:

```
Generated symphony_elixir app
Generated escript bin/symphony with MIX_ENV=dev
```

`make build` compiles the app and generates the `bin/symphony` escript (plus the
`bin/symphony-claude` wrapper).

---

## 6. Database (migrations)

Symphony uses a local SQLite database. `make serve` already runs migrations automatically, but
you can apply them manually:

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make migrate     # creates the DB (if needed) and applies migrations — idempotent
```

---

## 7. Import a project (e.g. `projects/gamba.yaml`)

Project YAML bundles live in the `projects/` directory at the repo root. This folder is
**gitignored** — each developer keeps their own copies (export from an existing setup or
create from scratch).

```bash
mkdir -p /home/gabriel/projetos/Gamba/symphony/projects
cd /home/gabriel/projetos/Gamba/symphony/elixir
make project-import FILE=../projects/gamba.yaml
```

Expected at the end:

```
✓  Imported project gamba (Gamba) from ../projects/gamba.yaml
```

This registers the project, the repositories, the `dev_env_steps`, and the `workflow_markdown`.

Related commands:

```bash
# Import into a specific slug
make project-import FILE=../projects/gamba.yaml INTO=gamba

# Import from a shared URL (raw gist or HTTPS YAML link)
make project-import FILE=https://gist.githubusercontent.com/you/abc123/raw/gamba.yaml

# Export an existing project back to YAML (writes to projects/ by default)
make project-export SLUG=gamba
make project-export SLUG=gamba FILE=../projects/gamba.yaml

# Share via GitHub Gist (requires GITHUB_TOKEN; prints import URL)
make project-share SLUG=gamba
```

---

## 8. Install the Cursor Agent (CLI)

Required to run issues with the **Cursor** agent (`symphony:cursor`).

```bash
curl https://cursor.com/install -fsS | bash
```

This installs the `cursor-agent` binary (usually in `~/.local/bin`). Verify:

```bash
cursor-agent --version    # or: command -v cursor-agent
```

> If `cursor-agent` is not found, add `~/.local/bin` to your `PATH`.
> The command used by Symphony is configurable via `SYMPHONY_CURSOR_COMMAND`
> (default: `cursor-agent`).

---

## 9. (Optional) In-browser editor — code-server (VS Code)

Used by the optional `editor:` block in the workflow to open a task's workspace in the
browser.

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make install-code-server       # downloads code-server to ~/.local (idempotent)
make configure-code-server     # installs Codex/Claude extensions and disables Copilot
```

Reinstall the latest version:

```bash
FORCE=1 make install-code-server
```

To enable the editor, set in the environment (process-wide):

```bash
SYMPHONY_EDITOR_ENABLED=true
# optional: SYMPHONY_EDITOR_PORT=4002  SYMPHONY_EDITOR_HOST=127.0.0.1
```

> `~/.local/bin` must be on the `PATH` for `code-server` to be found.

---

## 10. Tracker frontend (optional for development)

`make serve` already serves the built tracker. For frontend development:

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make tracker-setup     # elixir setup + npm ci + migrations
make tracker-dev       # tracker dev server (Vite)
# or production build:
make tracker-build
```

---

## 11. Start / Stop / Restart

All from `elixir/`.

### Start

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir
make serve
```

Starts the detached daemon (DB + orchestrator + web + editor), ensures deps and migrations,
loads `.env`, and listens on port `4000`. Logs in `.symphony/serve.log`.
It is idempotent: if it's already running, it just ensures the state.

Custom port:

```bash
make serve TRACKER_PORT=4005
```

Tracker available at: `http://localhost:4000/tracker`

### Restart after code changes (without tearing everything down)

```bash
make update                       # recompiles and restarts only the web (default)
make update ARGS="--orchestrator" # restarts the orchestrator
make update ARGS="--all"          # restarts everything
```

Restarting only the web preserves in-progress agent turns.

### Stop

```bash
make stop                  # stops the entire daemon
make stop ARGS="--web"     # stops only one subtree (e.g. --web, --orchestrator)
```

---

## 12. Full sequence (from scratch)

For an agent to run end to end:

```bash
cd /home/gabriel/projetos/Gamba/symphony/elixir

# 1) Toolchain
mise install
make check-tools

# 2) GitHub
gh auth status            # authenticate with `gh auth login` if needed

# 3) Environment
make env-setup            # or edit elixir/.env manually (Option B)

# 4) Dependencies + build
mise exec -- mix deps.get
make build

# 5) Database + project
make migrate
make project-import FILE=../projects/gamba.yaml

# 6) Cursor agent (outside elixir/, it's a global installer)
curl https://cursor.com/install -fsS | bash

# 7) (optional) in-browser editor
make install-code-server
make configure-code-server

# 8) Start
make serve
# -> http://localhost:4000/tracker
```

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|----------------|---------|
| `Command 'mix' not found` | `mix` is not on the PATH | Use `make ...` or `mise exec -- mix ...` |
| `the dependency is not available, run "mix deps.get"` | missing deps | `mise exec -- mix deps.get` |
| `make env-setup` fails with `unknown command "token"` | old `gh` without `gh auth token` | Use Option B (manual `.env` editing) |
| `cursor-agent: command not found` | `~/.local/bin` not on the PATH | Add `~/.local/bin` to the PATH |
| Build breaks after `git pull` | `mix.exs` changed (deps) | `mise exec -- mix deps.get` before `make build` |
| Tracker doesn't open on 4000 | daemon is not running | `make serve`; logs in `.symphony/serve.log` |

---

## 14. Reference for the main environment variables (`elixir/.env`)

| Variable | Required | Description |
|----------|-------------|-----------|
| `GITHUB_TOKEN` | yes | GitHub token (issues/PRs/clones) |
| `SYMPHONY_TRACKER_TOKEN` | yes | tracker API access token |
| `SYMPHONY_LOCAL_TRACKER_DATABASE` | no | SQLite path (default `.symphony/tracker.sqlite3`) |
| `SYMPHONY_DEFAULT_AGENT_KIND` | no | default agent (`codex` \| `claude` \| `cursor`) |
| `SYMPHONY_CURSOR_COMMAND` | no | Cursor command (default `cursor-agent`) |
| `SYMPHONY_EDITOR_ENABLED` | no | enables code-server (`true`/`false`) |
| `JIRA_*`, `CLOUDFLARE_*`, `SYMPHONY_VAPID_*` | no | optional integrations |
