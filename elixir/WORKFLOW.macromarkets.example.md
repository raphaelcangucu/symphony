---
github:
  repo: clouapp/front
  assignee: me
  project:
    mode: existing
    # Replace after running: mix run scripts/bootstrap_macro_markets.exs
    id: "PVT_REPLACE_ME"
  status_field: Symphony State
  admission_label: symphony
tracker:
  active_states:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_states:
    - Done
    - Cancelled
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
---

You are working on GitHub issue `{{ issue.identifier }}` in the **Macro Markets** board (`clouapp/front`).

Use a single `## Codex Workpad` comment for progress. Blockers can be declared in the issue body as `Blocked by #N` or `Depends on clouapp/front#N`.

When you need raw GitHub GraphQL, use the `github_graphql` tool (same shape as `linear_graphql`).
