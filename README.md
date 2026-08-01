# Dev10x

Dev10x turns project work into isolated, autonomous implementation runs, allowing teams to manage
work instead of supervising coding agents.

The reference implementation is an Elixir/OTP **multi-project orchestrator** with a React **tracker
UI**, **local-first** sync against GitHub / Linear / JIRA, and optional browser editing and public
preview tunnels.

[![Symphony demo video preview](.github/media/symphony-demo-poster.jpg)](.github/media/symphony-demo.mp4)

_In this [demo video](.github/media/symphony-demo.mp4), Dev10x monitors a Linear board for work and spawns agents to handle the tasks. The agents complete the tasks and provide proof of work: CI status, PR review feedback, complexity analysis, and walkthrough videos. When accepted, the agents land the PR safely. Engineers do not need to supervise Codex; they can manage the work at a higher level._

> [!WARNING]
> Dev10x is a low-key engineering preview for testing in trusted environments.

## Running Dev10x

### Requirements

Dev10x works best in codebases that have adopted
[harness engineering](https://openai.com/index/harness-engineering/). Dev10x is the next step —
moving from managing coding agents to managing work that needs to get done.

### Option 1. Make your own

Tell your favorite coding agent to build Dev10x in a programming language of your choice:

> Implement Dev10x according to the following spec:
> [`SPEC.md`](SPEC.md)

### Option 2. Use the Elixir reference implementation

Full documentation: **[elixir/README.md](elixir/README.md)**.

There is **no global `WORKFLOW.md`**. Process settings live in `elixir/.env` (`SYMPHONY_*`); each
project's agent prompt and tracker config are stored as `workflow_markdown` in SQLite and edited
from the tracker UI.

#### Quick start

Prerequisites for the core path: **mise** (recommended), **gh** (authenticated), and **Git**.
Codex, Claude, Cursor, and OpenCode can be installed into Symphony's isolated data directory from
**Settings → Coding agents**; an existing CLI on the system `PATH` remains a transparent fallback.
**`code-server`** and **`cloudflared`** are optional — only needed when you enable the browser
editor or the public preview tunnel.

```bash
git clone <this-repo>
cd symphony/elixir

mise trust && mise install && make setup

gh auth login
gh auth refresh -s repo,project,read:org
make env-setup          # SYMPHONY_TRACKER_TOKEN + GITHUB_TOKEN from gh

make serve              # http://localhost:4000/tracker
```

Then in the tracker UI: **New project** → **Settings** → configure `workflow_markdown` (see
`WORKFLOW.*.example.md` templates in `elixir/`).

```bash
make check-tools        # verify gh, codex, optional code-server / cloudflared
make stop               # shut down the daemon
```

Ask a coding agent to walk through setup:

> Set up Dev10x for my repository based on
> [`elixir/README.md`](elixir/README.md)

#### What you get

- **Tracker** at `/tracker` — boards, issue detail, assistant chats, observability
- **Orchestrator** — isolated workspaces per issue; Codex, Claude, Cursor, or OpenCode per project/task
- **Local-first sync** — SQLite mirror of remote trackers; background push/pull
- **Optional**: browser VS Code (`make install-code-server`), Cursor Desktop, dev-server previews,
  Cloudflare public tunnel (`cloudflared`)

For wait-state issues with linked PRs, Dev10x now follows PR outcomes in the background: merged PRs
can auto-move issues to `Done`, fixable CI/review-bot failures can auto-route to `Rework`, and
unrelated/flaky failures stay in `Human Review` with rerun guidance.

Implementation details, configuration tables, and feature guides live in
[elixir/README.md](elixir/README.md).

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
