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
# Public preview tunnel (Cloudflare). Exposes the tracker and ready dev-server
# previews publicly via a named tunnel. Disabled by default; previews become
# UNAUTHENTICATED to anyone with the URL once enabled.
public_tunnel:
  enabled: false              # set true to expose previews via the Cloudflare tunnel
  base_domain: tracker.cods.dev
  # namespace: your-github-login   # defaults to the GitHub login
# Browser VS Code (code-server) for task workspaces. Disabled by default.
# Requires code-server installed on the host. auth: none is only safe on localhost.
# Set enabled: true after `make install-code-server`.
editor:
  enabled: false
  binary: code-server   # binary name on PATH, or an absolute path
  host: 127.0.0.1
  port: 4002
  auth: none            # "none" (localhost only) or "password"
  # password: your-password               # required when auth: password
  # base_url: https://editor.example.com  # browser-facing URL override (remote/proxy)
# Tracker UI issue previews. Vite proxies /api and /socket to the Phoenix URL in
# TRACKER_API_PROXY_TARGET, so start Phoenix before opening Preview.
dev_server:
  enabled: true
  runtime_contract_v1: true
  port_range: [4400, 4499]
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
