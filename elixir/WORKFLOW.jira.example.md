---
jira:
  # JIRA Cloud site base URL (no trailing slash). Supports a literal value or a
  # $ENV_VAR reference. Falls back to the JIRA_BASE_URL env var when unset.
  base_url: $JIRA_BASE_URL          # e.g. https://your-site.atlassian.net
  # Account email used for HTTP Basic auth together with the API token.
  email: $JIRA_EMAIL
  # API token from https://id.atlassian.com/manage-profile/security/api-tokens
  # Literal value or $ENV_VAR reference; falls back to the JIRA_API_TOKEN env var.
  api_token: $JIRA_API_TOKEN
  # Project key issues are polled from and created under (e.g. ABC for ABC-123).
  project_key: ABC
  # Optional routing filter: "me" (resolved via /myself) or a JIRA accountId.
  # Falls back to the JIRA_ASSIGNEE env var when unset.
  # assignee: me
#
# Per-project tracker_config keys consumed by the UI adapter:
#   project_key  (required) — JIRA project key the board reads/writes
#   issue_type   (optional) — issue type used on create (defaults to "Task")
#   fields       (optional) — map of field => value equality clauses ANDed into
#                             the board JQL, e.g. {Product: Inspire} ->
#                             project = "KEY" AND "Product" = "Inspire".
#                             Custom field names work when unique in the site;
#                             otherwise use the `jql` key with cf[<id>].
#   jql          (optional) — raw JQL fragment ANDed after `fields`, for
#                             cf[<id>] references, OR-groups, date ranges, etc.
#   order_by     (optional) — JQL ORDER BY clause (default "created DESC").
#   max_results  (optional) — cap on issues pulled per sync (default 500).
#
# Board visibility (the JQL above) is independent of execution: the orchestrator
# only auto-dispatches issues assigned to the connected Jira account
# (require_assignee_match) and carrying a symphony:* label (require_symphony_label),
# so a broad board filter still keeps colleagues' issues view-only.
tracker:
  field_states:
    - Backlog
    - To Do
    - In Progress
    - In Review
    - Done
  active_states:
    - To Do
    - In Progress
    - In Review
  terminal_states:
    - Done
polling:
  interval_ms: 5000
workspace:
  root: ~/code/symphony-workspaces
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
---

You are working on a JIRA issue `{{ issue.identifier }}`.

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Work only in the provided repository copy. Do not touch any other path.
