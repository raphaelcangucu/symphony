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
    git clone --depth 1 https://github.com/clouapp/front .
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
| Merging | Follow `.codex/skills/land/SKILL.md` |
| Done / Cancelled / Duplicate | Terminal |

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/front#N`.

Raw GitHub GraphQL: `github_graphql` (same shape as `linear_graphql`).

## Tests and validation (agent responsibility)

Symphony does **not** run your test suite automatically. **You** (the coding agent) are responsible for validation before handoff, following the same bar as `WORKFLOW.md`:

- Treat any ticket-authored `Validation`, `Test Plan`, or `Testing` section as required acceptance input; mirror it in the workpad.
- Run targeted tests for the scope you changed (`clouapp/front` conventions: use the repo’s existing scripts, e.g. lint/typecheck/test commands documented in the repo README or package scripts).
- Record commands and outcomes in the workpad **Validation** section (`targeted tests: <command>`).
- Do **not** move to **Human Review** until:
  - Acceptance criteria are met
  - Validation/tests are green for the latest commit
  - A PR is open, linked on the issue, and checks are green where applicable
- In **Human Review**, do not implement; wait and poll for human feedback.

Project-specific test commands belong in the **issue description** or linked docs for `clouapp/front`; this WORKFLOW states the policy, not every command.
