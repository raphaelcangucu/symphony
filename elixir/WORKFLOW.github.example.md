---
github:
  repo: raphaelcangucu/symphony
  project:
    mode: auto
    title: Symphony
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
  root: ~/code/symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/raphaelcangucu/symphony .
    if command -v mise >/dev/null 2>&1; then
      cd elixir && mise trust && mise exec -- mix deps.get
    fi
  before_remove: |
    cd elixir && mise exec -- mix workspace.before_remove
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex --config shell_environment_policy.inherit=all --config model_reasoning_effort=xhigh --model gpt-5.3-codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
---

You are working on GitHub issue `{{ issue.identifier }}` in `raphaelcangucu/symphony`.

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
- Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.
{% endif %}

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
Labels: {{ issue.labels }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets). If blocked, record it in the workpad and move the issue according to the workflow.
3. Final message must report completed actions and blockers only. Do not include "next steps for user".

Work only in the provided repository copy. Do not touch any other path.

## Prerequisite: GitHub access

The agent runs against GitHub Projects v2. `GITHUB_TOKEN` must be present and have the `repo` and `project` scopes. Symphony manages issue state through a custom single-select field called `Symphony State` whose options come from `tracker.active_states` and `tracker.terminal_states`. Project metadata is cached at `.symphony/github-project.json`.

## Default posture

- Start by determining the issue's current `Symphony State`, then follow the matching flow.
- Use a single persistent `## Codex Workpad` issue comment as the source of truth for progress and handoff notes.
- Move state only when the matching quality bar is met (see Status map and Completion bar below).
- Operate autonomously end-to-end unless blocked by missing required tools, secrets, or permissions.

## Related skills

- `commit`: produce clean, logical commits during implementation.
- `push`: keep remote branch current and publish updates.
- `pull`: keep branch updated with latest `origin/main` before handoff.
- `land`: when the issue reaches `Merging`, explicitly open and follow `.codex/skills/land/SKILL.md`.

## Status map

- `Todo` -> queued; immediately transition to `In Progress` before active work.
- `In Progress` -> implementation actively underway.
- `Merging` -> approved by reviewer; execute the `land` skill flow (do not call `gh pr merge` directly).
- `Rework` -> reviewer requested changes; planning + implementation required.
- `Done` / `Cancelled` -> terminal; no further action.

## Step 0: Determine current issue state and route

1. Fetch the issue by `owner/repo#number`.
2. Read the current `Symphony State`.
3. Route to the matching flow:
   - `Todo` -> immediately move to `In Progress`, then ensure the bootstrap workpad comment exists (create if missing), then start the execution flow.
   - `In Progress` -> continue execution from the existing workpad comment.
   - `Merging` -> open and follow `.codex/skills/land/SKILL.md`; do not call `gh pr merge` directly.
   - `Rework` -> close prior PR, recreate branch from `origin/main`, recreate workpad, plan and execute end-to-end.
   - `Done` / `Cancelled` -> do nothing and shut down.

## Step 1: Execution

1. Find or create a `## Codex Workpad` issue comment (single source of truth for plan, acceptance criteria, validation, and notes).
2. Run the `pull` skill before any code edits and record the result in the workpad `Notes`.
3. Build a hierarchical plan + explicit acceptance criteria + validation checklist.
4. Implement against the plan, updating the workpad after each meaningful milestone.
5. Run validation/tests required for the scope; fix until green before pushing.
6. Open a PR, attach it to the issue, and ensure it carries the `symphony` label.

## Step 2: Handoff to reviewer

1. Run the PR feedback sweep (top-level comments, inline review comments, review states) until no actionable comments remain.
2. Confirm PR checks are green.
3. Move the issue to `Merging` only when the Completion bar below is satisfied.

## Step 3: Merging

1. When the issue is in `Merging`, open `.codex/skills/land/SKILL.md` and run the `land` loop until the PR is merged.
2. After merge, move the issue to `Done`.

## Completion bar before Merging

- Workpad plan, acceptance criteria, and validation are fully checked off.
- PR checks are green for the latest commit.
- PR feedback sweep is complete and no actionable comments remain.
- PR carries the `symphony` label.

## Guardrails

- Do not edit the issue body for planning or progress tracking; use the `## Codex Workpad` comment.
- Use exactly one persistent workpad comment per issue.
- Treat `Rework` as a full reset: close prior PR, branch fresh from `origin/main`, recreate workpad, replan.
- If blocked by missing required non-GitHub tools/auth, record a short blocker brief in the workpad and stop.
- If the state is terminal (`Done` / `Cancelled`), do nothing and shut down.
