---
github:
  repo: clouapp/distributionmachine
  project:
    mode: existing
    id: "PVT_kwDOCpPais4BZjW1"
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
  draft_status: Backlog
# Ports are offset from the macro-markets workflow so both orchestrators can run
# side by side without clashing. Adjust if you run only one at a time.
editor:
  enabled: true
  binary: code-server
  host: 127.0.0.1
  port: 4012
  auth: none
dev_server:
  enabled: true
  port_range: [4200, 4299]
  idle_timeout_ms: 1800000
  auto_start_on: pull_request,human_review
workspace:
  root: ~/code/distributionmachine-workspaces
hooks:
  # Single-repo workspace: clone the repo's default branch into the workspace root.
  # Adjust the branch (-b <branch>) and add any .env bootstrap your app needs.
  after_create: |
    gh repo clone clouapp/distributionmachine . -- --depth 1
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

Read and follow **`AGENTS.md`** (or `.cursorrules`) in the workspace root for this repo's integration branch, PR base, lint, and test conventions.

Symphony injects **recent issue and PR comments** into your prompt when available. On **Rework**, those comments (and the workpad) define what you must do next.

## Repository

This is a **single-repository** workspace. The `clouapp/distributionmachine` repo is cloned at the workspace root by `hooks.after_create`.

- Before handoff, sync with the integration branch: `git fetch origin && git merge origin/<integration-branch>`.
- Open the PR against the repo's base branch: `gh pr create --base <base-branch> --title "…"`.
- Do not target `master`/`main` unless that is the repo's configured base branch.

> Adjust `<integration-branch>` / `<base-branch>` to this repo's real conventions.

## Workflow states

Symphony reads and updates the GitHub Project **Status** field when moving cards.

| State | Role |
|-------|------|
| Backlog | Out of scope; do not modify; wait for human to move to Todo |
| Todo | Queue; **move to In Progress before work** |
| In Progress | Active implementation |
| Human Review | PR ready; poll for human decision — **no further coding turns** |
| Rework | Address review feedback |
| Merging | Land the PR per `.codex/skills/land/SKILL.md` |
| Done / Cancelled / Duplicate | Terminal |

Use the **`set_issue_status`** tool to move this issue between states (for example, `Todo` → `In Progress` when you start). It updates Symphony's local-first board immediately and syncs to GitHub in the background, so it never blocks on GitHub's API rate limits.

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/distributionmachine#N`.

Raw GitHub GraphQL is available via the `github_graphql` tool.

## Agent routing (GitHub labels)

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | Default (**Codex** when this WORKFLOW includes `codex:`) |

Symphony only dispatches issues whose label resolves to an agent configured above.

## Tests and validation (mandatory)

Symphony does **not** run your test suite automatically. **You** must validate before moving to **Human Review**:

- Run this repo's lint and tests (see `AGENTS.md`); add/update tests for the code you changed.
- Record in the workpad **Validation** section: `targeted tests: <command>` and the outcome.
- Do **not** move to **Human Review** until acceptance criteria are met, tests pass on the latest commit, and a PR is open against the base branch (linked on the issue).
- In **Human Review**, do not implement; wait and poll for human feedback.
