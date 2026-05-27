---
github:
  repo: clouapp/front
  project:
    mode: existing
    id: "PVT_kwDOCpPais4BY509"
  status_field: Symphony State
  native_status_field: Status
  sync_native_status: true
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
workspace:
  root: ~/code/macro-markets-workspaces
hooks:
  after_create: |
    git clone --depth 1 -b homolog https://github.com/clouapp/front .
agent:
  max_concurrent_agents: 5
  max_turns: 20
codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
claude:
  command: symphony-claude
---

You are working on GitHub issue `{{ issue.identifier }}` in the **Macro Markets** board (`clouapp/front`).

Read and follow **`AGENTS.md`** in the workspace root (integration branch, PR base, lint, and unit tests).

## Integration branch (`homolog`)

- The repo integration branch is **`homolog`**, not `master` or `main`.
- Workspaces are cloned from `homolog` via `hooks.after_create`.
- Before handoff, merge latest integration: `git fetch origin && git merge origin/homolog`.
- Open PRs against **`homolog`**: `gh pr create --base homolog --title "…"`.
- On **Rework**, sync with `origin/homolog` and address review feedback; do not target `master` for PRs.

## Agent routing (GitHub labels)

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | Default (**Codex** when this WORKFLOW includes `codex:`) |

Symphony only dispatches issues whose label resolves to an agent configured above.

Symphony updates **both** `Symphony State` and the built-in GitHub **Status** field when moving cards (same option names). States align with the clouapp Linear board:

| State | Role |
|-------|------|
| Backlog | Out of scope; do not modify; wait for human to move to Todo |
| Todo | Queue; move to In Progress before work |
| In Progress | Active implementation |
| Human Review | PR ready; poll for human decision — **no further coding turns** |
| Rework | Address review feedback |
| Merging | Follow `.codex/skills/land/SKILL.md` (merge target branch is **`homolog`**) |
| Done / Cancelled / Duplicate | Terminal |

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/front#N`.

Raw GitHub GraphQL: `github_graphql` (same shape as `linear_graphql`).

## Tests and validation (mandatory)

Symphony does **not** run your test suite automatically. **You** must validate before **Human Review**, per `AGENTS.md` and [`.cursor/rules/testing-standards.mdc`](.cursor/rules/testing-standards.mdc):

- Treat ticket `Validation`, `Test Plan`, or `Testing` sections as required; mirror them in the workpad.
- For every changed component, hook, or util: add or update Vitest tests under `tests/` (mirror `src/`).
- Run lint when touching TS/TSX: `npm run lint`.
- Run unit tests: `npm run test:unit` (or targeted: `npm run test:unit -- tests/...`).
- Record in workpad **Validation**: `targeted tests: <command>` and outcome.
- Do **not** move to **Human Review** until:
  - Acceptance criteria are met
  - `npm run test:unit` passes for the latest commit
  - PR is open against **`homolog`**, linked on the issue, and CI/checks are green where applicable
- In **Human Review**, do not implement; wait and poll for human feedback.
