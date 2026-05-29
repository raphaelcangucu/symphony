---
local:
  database_path: .symphony/tracker.sqlite3
  project_slug: symphony
  api_token_env: SYMPHONY_TRACKER_TOKEN
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
    - Canceled
    - Duplicate
    - Closed
  active_states:
    - Todo
    - In Progress
    - Human Review
    - Merging
    - Rework
  terminal_states:
    - Done
    - Cancelled
    - Canceled
    - Duplicate
    - Closed
polling:
  interval_ms: 5000
workspace:
  root: ~/code/symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/openai/symphony .
agent:
  max_concurrent_agents: 1
  max_turns: 5
codex:
  command: codex --config shell_environment_policy.inherit=all --model gpt-5.3-codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
---

Local tracker dev workflow for manual UI validation.
