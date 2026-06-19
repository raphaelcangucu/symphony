---
name: workflow
description: |
  Configure Symphony project workflow and orchestrator behavior: YAML front matter
  in workflow_markdown (tracker.active_states, dispatch_states, etc.), not board
  status categories alone. Use when editing workflow, explaining dispatch rules,
  or debugging why an issue was not auto-started.
---

# Symphony workflow & orchestrator

Use this skill when configuring or explaining **how Symphony picks issues for
auto-dispatch** and how workflow status names map to behavior.

## Source of truth

| What | Where |
|------|--------|
| Orchestrator + agent prompt | `workflow_markdown` on the project (DB), YAML front matter + markdown body |
| Board column list (UI) | Same file: `tracker.field_states` or status records on the project |
| Global dispatch gates | Settings → orchestrator (`require_symphony_label`, `require_assignee_match`) |

**Do not** infer orchestrator behavior from:

- Status `category` (`unstarted` / `started` / `completed`) on the board — that is UI/sync metadata
- Prose in the workflow **body** alone — the orchestrator reads **YAML keys**, not narrative text
- `WORKFLOW.md` in a cloned repo — use `get_workflow` (assistant) or project settings API
- Codebase grep for "status" in the target application

Always call `get_workflow` first when answering orchestrator or workflow questions.

## YAML keys (`tracker:` section)

```yaml
tracker:
  field_states:        # All board columns (UI + GitHub/Jira field options)
    - Backlog
    - Todo
    - In Progress
    - Done
  active_states:         # Issues polled/synced as orchestrator candidates
    - Todo
    - In Progress
  dispatch_states:       # Statuses where a NEW agent run may start (orchestrator queue)
    - Todo
  wait_states:           # Active but agent stops after current turn (human review, etc.)
    - Human Review
  terminal_states:       # Finished — never dispatch
    - Done
```

### How they differ

| Key | Orchestrator / sync |
|-----|-------------------|
| `dispatch_states` | Issue must be in this status for **new** auto-dispatch |
| `active_states` | Issue is **visible** to poll/sync (broader set) |
| `wait_states` | Run continues but stops after turn (not a dispatch queue) |
| `terminal_states` | Excluded from dispatch |
| `field_states` | Board columns only; does not alone control dispatch |

If `dispatch_states` is omitted, it **defaults to `active_states`**.

Code defaults when YAML is missing: `active_states` = `Todo`, `In Progress` (Gamba-style). Jira boards with other names (e.g. `Selected for Development`, `Em andamento`) **must** set explicit `tracker.*` lists.

## Status transitions (orchestrator vs agent)

**Auto-dispatch does not move the card.** When the orchestrator starts a run, the issue stays in `dispatch_states` until the **coding agent** calls `set_issue_status`.

Typical pattern (Gamba):

1. Human moves issue to queue status (`Todo` / `Selected for Development`)
2. Orchestrator dispatches while still in that status
3. Agent immediately moves to work status (`In Progress` / `Em andamento`) via `set_issue_status`
4. On completion, `agent.completion_transitions` or agent moves to review status

Document the queue vs work status names in the workflow body so the agent knows which `set_issue_status` values to use.

## Global gates (Settings, not workflow YAML)

Both must pass for auto-dispatch (when enabled):

| Setting | Default | Effect |
|---------|---------|--------|
| `require_symphony_label` | `true` | Issue needs `symphony`, `symphony:codex`, or `symphony:claude` (or project admission label) |
| `require_assignee_match` | `true` | Issue assignee must match connected tracker identity |

## Editing workflow (assistants)

Use `update_project_workflow` with the **full** markdown string:

1. Preserve existing YAML front matter
2. Update `tracker.active_states`, `dispatch_states`, `terminal_states`, `wait_states`, `field_states` as needed
3. Update body prose for **agent** instructions (status names, review step, evidence)
4. Never replace YAML with prose-only edits

`get_project` returns board statuses and categories — use it for column names, then `get_workflow` for orchestrator config.

## Project setup & dev environment (assistants)

For new or incomplete projects, use the setup wizard tools (require `project_slug` in freeform chat):

1. **`scan_project_setup`** — scan linked repositories for stack hints (package manager, test/lint scripts).
2. **`suggest_project_setup`** — generate workflow markdown, hooks, and validation command suggestions from scans.
3. **`update_project_workflow`** / **`update_project_repositories`** — persist the chosen setup.
4. **`manage_dev_env`** — `propose_steps` → review → `save_steps` → `run` (setup + serve steps).
5. **`manage_preview`** — after serve steps exist, `start` / `status` for preview URLs used in e2e.

Coding agents get a subset of **`manage_dev_env`** (`list_steps`, `run`, `run_step`, `list_runs`) bound to the current issue — they cannot `propose_steps` or `save_steps`.

## Examples

### GitHub / Gamba-style

```yaml
tracker:
  dispatch_states: [Todo]
  active_states: [Todo, In Progress, Rework]
  wait_states: [Human Review]
  terminal_states: [Done]
```

Body: `Todo` = queue; agent moves to `In Progress` before coding.

### Jira / Advising-style

```yaml
tracker:
  dispatch_states: [Selected for Development]
  active_states: [Selected for Development, Em andamento, To Do]
  wait_states: [Revisão de pares]
  terminal_states: [Concluído, Won't Do, Done]
```

Body: `Selected for Development` = orchestrator queue; agent moves to `Em andamento` when starting work.

## Debugging "issue not dispatched"

Check in order:

1. `get_workflow` → `config.tracker.dispatch_states` and `active_states`
2. Issue status ∈ `dispatch_states`?
3. Issue status ∈ `active_states` (for poll)?
4. `symphony*` label present if `require_symphony_label`?
5. Assignee matches if `require_assignee_match`?
6. Not in `terminal_states`, not blocked by open blocker issues
7. Orchestrator logs: `Dispatching issue to agent` vs skip reasons

### Tools to diagnose and repair

- **`explain_dispatch_eligibility`** (assistant) — one call returns `eligible` + concrete `reasons` (`status_not_in_dispatch_states`, `terminal_state`, `wait_state`, `missing_symphony_label`) and the active gate flags. Prefer this over reading config by hand.
- **`get_issue_orchestrator_state`** (assistant) — whether the issue is running, retrying, or idle right now (live snapshot + persisted status).
- **`list_running_agents`** (assistant) — every agent the orchestrator is running/retrying right now (live, in-memory). Use it to see what is executing before steering.
- **`steer_agent`** (assistant) — inject a message into a running agent's current turn (the agent reads it mid-run); no restart needed. Returns `agent_not_running` when there is no steerable active turn.
- **`manage_blockers`** (assistant) — `list` / `create` / `delete` `blocked_by` relations; a non-terminal blocker keeps an issue out of the queue.
- **`sync_issue`** (assistant) — pull the latest remote state after the issue was edited outside Symphony.
- **`link_pull_request`** (assistant + coding agent) — attach a PR URL so the publish gate and board see it.

From a shell against the running daemon (`make serve` first): `mix symphony.tracker dispatch-explain <slug> <id>`, `mix symphony.tracker orchestrator <slug> <id>`, `mix symphony.tracker running [slug]`, `mix symphony.tracker steer <slug> <id> "<message>"`, `mix symphony.tracker blockers <slug> <id>`, `mix symphony.tracker sync <slug> <id>`, `mix symphony.tracker pr-link <slug> <id> <url>` (add `--json` for structured output). See `elixir/README.md`.

## References

- `elixir/README.md` — Tracker setup (per project)
- `elixir/WORKFLOW.jira.example.md` — Jira template with `tracker:` block
- `elixir/WORKFLOW.macromarkets.example.md` — GitHub / multi-state example
