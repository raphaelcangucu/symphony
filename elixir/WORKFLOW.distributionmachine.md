---
github:
  repo: clouapp/distributionmachine
  project:
    mode: existing
    id: "PVT_kwDOCpPais4BZrBN"
  comment_context_limit: 30
  # Base label; issues with symphony, symphony:codex, or symphony:claude are admitted.
  admission_label: symphony
tracker:
  field_states:
    - Backlog
    - Todo
    - In Progress
    - Human Review
    - Rework
    - Merging
    - Done
    - Cancelled
    - Duplicate
  active_states:
    - Todo
    - In Progress
    - Rework
    - Merging
  wait_states:
    - Human Review
  terminal_states:
    - Done
    - Cancelled
    - Duplicate
polling:
  interval_ms: 5000
assistant:
  # Draft issues created by the New issue assistant start here.
  draft_status: Backlog
editor:
  enabled: true
  binary: code-server
  host: 127.0.0.1
  port: 4003
  auth: none
dev_server:
  # This project is a Python standalone application, so previews are disabled
  # until the repository declares a serve step in `.symphony/devenv.yaml`.
  enabled: false
  port_range: [4200, 4299]
  idle_timeout_ms: 1800000
  auto_start_on: pull_request,human_review
  # base_url: https://previews.example.com  # optional proxy-facing base URL
# Public preview tunnel (Cloudflare). Same tracker tunnel domain as macro-markets.
public_tunnel:
  enabled: true
  base_domain: tracker.cods.dev
  # namespace: raphaelcangucu   # defaults to the GitHub login when unset
workspace:
  root: ~/code/distributionmachine-workspaces
hooks:
  after_create: |
    gh repo clone clouapp/distributionmachine distributionmachine -- --depth 1
agent:
  max_concurrent_agents: 5
  max_turns: 20
  completion_transitions:
    Todo: Human Review
    In Progress: Human Review
    Rework: Human Review
    Merging: Done
codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
claude:
  command: symphony-claude
---

You are working on GitHub issue `{{ issue.identifier }}` in the **Distribution Machine** board (`clouapp/distributionmachine`).

Read and follow **`AGENTS.md`** in the workspace root when present. If it is absent, follow the repository's README, Python packaging metadata, and local test conventions.

Symphony injects **recent issue and PR comments** into your prompt when available. On **Rework**, those comments and the workpad define what you must do next.

## Repository

This is a **single-repository** workspace for a Python standalone application.

| Repo | Path | Integration branch | PR base |
|------|------|--------------------|---------|
| `clouapp/distributionmachine` | `distributionmachine/` | `main` | `main` |

- Workspaces are cloned by `hooks.after_create` into `distributionmachine/`.
- If the repository default branch is not `main`, update this workflow before dispatching work.
- Before handoff, sync the repo with its integration branch:
  - `cd distributionmachine && git fetch origin && git merge origin/main`
- Open PRs against the repo base:
  - `cd distributionmachine && gh pr create --base main --title "..."`
- On **Rework**, sync with the integration branch and address feedback before pushing updates.

## Python standalone conventions

- Prefer the repository's existing package manager and commands. Check, in order:
  - `pyproject.toml`
  - `setup.py`
  - `requirements*.txt`
  - `Makefile`
  - `README.md`
- Keep changes scoped to the standalone runtime, packaging, CLI/config handling, tests, and documentation needed by the issue.
- Do not introduce a new framework, service layer, or packaging tool unless the issue explicitly requires it or the repo already uses it.
- Preserve command-line behavior and existing config/environment semantics unless the issue asks for a breaking change.

## Agent routing (GitHub labels)

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | Default (**Codex** when this WORKFLOW includes `codex:`) |

Symphony only dispatches issues whose label resolves to an agent configured above.

Symphony reads and updates the GitHub Project **Status** field when moving cards.

| State | Role |
|-------|------|
| Backlog | Out of scope; do not modify; wait for human to move to Todo |
| Todo | Queue; move to In Progress before work |
| In Progress | Active implementation |
| Human Review | PR ready; poll for human decision; no further coding turns |
| Rework | Address review feedback |
| Merging | Merge only after review approval and green validation |
| Done / Cancelled / Duplicate | Terminal |

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/distributionmachine#N`.

## Assistant authoring handoff

The tracker **New issue** button opens the issue authoring assistant by default. It creates a draft in `assistant.draft_status`, then continues at `/projects/:slug/assistant/issue/:id`.

Before execution, read any generated specs, plans, handoff notes, issue comments, and linked PR comments when present. The Agent tab separates **Authoring** from **Execution**.

## Rework flow (required)

When the Project **Status** is **Rework**:

1. Read all feedback before editing code:
   - Injected **Recent discussion** section in this prompt.
   - `gh issue view <number> --comments` for the full issue thread.
   - `gh pr view` and `gh pr view --comments` for the open PR tied to this work, if any.
   - Inline review threads on the PR through GitHub UI, `gh api`, or `github_graphql`.
2. Find or create the `## Codex Workpad` comment. Summarize human feedback into **Acceptance criteria** and a short **Rework plan** before implementation.
3. Sync the branch:
   - `cd distributionmachine && git fetch origin && git merge origin/main`
4. Implement fixes; add or update focused tests.
5. Push and update the PR against `main`; record validation results in the workpad.
6. Move to **Human Review** only when feedback is addressed and tests are green.

Do not ignore human comments that only appear on the PR; they are part of the rework scope.

## Tests and validation (mandatory)

Symphony does **not** run the test suite automatically. Validate before **Human Review**.

- Treat ticket `Validation`, `Test Plan`, or `Testing` sections as required; mirror them in the workpad.
- First discover the repository's intended commands:
  - `cd distributionmachine && rg -n "pytest|unittest|ruff|mypy|tox|nox|coverage|make test|python -m" README.md pyproject.toml setup.py setup.cfg tox.ini noxfile.py Makefile requirements*.txt`
- When available, prefer the repo's declared commands.
- Typical Python validation candidates:
  - `cd distributionmachine && python -m pytest`
  - `cd distributionmachine && python -m unittest`
  - `cd distributionmachine && ruff check .`
  - `cd distributionmachine && mypy .`
  - `cd distributionmachine && python -m build`
- For packaging or entrypoint changes, validate installability or execution with the repo's documented command.
- Record in workpad **Validation**: `targeted tests: <command>` and outcome.
- Do **not** move to **Human Review** until:
  - Acceptance criteria are met
  - Tests pass for the latest commit, or failures are documented as unrelated
  - A PR is open against `main`, linked on the issue, with checks green where applicable
- In **Human Review**, do not implement; wait and poll for human feedback.
