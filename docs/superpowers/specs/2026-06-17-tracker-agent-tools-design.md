# Tracker Agent Tools (Coding Agents + Chat Assistant) — Design

Date: 2026-06-17  
Status: Accepted (plan: `docs/superpowers/plans/2026-06-17-tracker-agent-tools-phase-1.md`)  
Topic: Expand Symphony's **assistant tools** and **coding-agent dynamic tools** so
autonomous agents (A) and the tracker chat assistant (B) can diagnose handoff
gates, inspect evidence, maintain workpads, run **dev-env setup/serve**, control
**issue preview**, link PRs, and debug orchestrator behavior — without new CLI
surface (`mix symphony.tracker` is out of scope).

## Background / Motivation

Symphony already exposes a rich tracker REST API and a large assistant tool
surface (`ToolExecutor`, `DynamicTool`, discovery/GitHub tools). Two agent
audiences still hit friction:

1. **Coding agents (A)** — During a turn, agents use MCP dynamic tools
   (`set_issue_status`, `add_comment`, …). Handoff to review/wait states is
   blocked by `AgentHandoffGate` until validate + publish gates pass, but the
   agent only learns this **after** a failed `set_issue_status`. Evidence
   validation is documented in the `evidence` skill but has **no structured
   tool** — agents must infer gate state from shell + filesystem.

2. **Tracker chat assistant (B)** — Project/issue/freeform chat can CRUD
   issues, dispatch agents, and edit workflow, but cannot **list/update
   comments** (workpad maintenance), **inspect evidence runs**, **check handoff
   readiness**, **run dev-env setup/serve**, or **explain why the orchestrator
   did not dispatch** an issue.

3. **Preview / setup / serve gap** — The tracker UI and REST API already support
   dev-env discovery (`project_setup/scan`, `dev_env/propose`, `dev_env/run`) and
   issue preview (`dev_servers/start`, …). The assistant exposes
   `manage_preview` only (no coding-agent parity). There are **no tools** for
   project setup scan, dev-env step proposal/save/run, or structured preview
   diagnostics (`available: false`, reason `:no_serve_step`, etc.).

Operational Mix tasks (`symphony.ctl serve`, `symphony.project`, `symphony.link_pr`)
exist for humans/CI but are not agent-native. **`mix symphony.ctl serve` (Symphony
daemon boot) stays out of scope** — agents must not start the OS-level daemon;
“serve” here means **dev-env serve steps** + **issue preview servers**.

### Decisions made with the user

- **Audience**: optimize for **A + B** (coding agents + chat assistant), not
  human CLI wrappers.
- **Approach**: thin **tools** over existing backend modules (`AgentHandoffGate`,
  `Evidence.Gate`, `Evidence.Store`, `LocalTracker.Context`, `Presenter`), not
  a parallel REST client or new `mix symphony.tracker` command tree.
- **Phase 1 (parallel)**: ship Tier-1 tools in one implementation slice —
  handoff/evidence diagnostics, comment read/update, **and** preview / setup /
  serve tooling for both audiences.
- **Preview / setup / serve in Phase 1**: extend `manage_preview` to coding
  agents; add dev-env + project-setup tools (see §Phase 1 — Preview, setup,
  serve).

## Goals

- Agents can **probe handoff readiness** before calling `set_issue_status`.
- Agents can **read evidence gate state** (manifest + persisted runs) without
  guessing from logs.
- The chat assistant can **list/update issue comments** (workpad in place), matching
  coding-agent capabilities.
- Agents can **discover, persist, and run dev-env setup/serve steps** without
  shell guesswork or UI-only flows.
- Agents can **inspect and control issue preview servers** (status, start, stop,
  restart) with actionable diagnostics when preview is unavailable.
- Shared implementation: one module per concern, wired into both `ToolExecutor`
  and `DynamicTool` where appropriate.
- Prompts and skills (`evidence`, `workpad`, `workflow`) reference the new tools.

## Non-goals

- `mix symphony.tracker …` CLI (human/CI convenience — separate effort).
- Booting the Symphony daemon via tools (`mix symphony.ctl serve`) — operators
  only; agents assume the tracker API is already reachable.
- Jira/Linear CRUD beyond existing board tools + optional `sync_issue` (Phase 3).
- Template instantiate, backup management via tools.
- Replacing `linear_graphql` / `github_graphql` escape hatches.
- Duplicating full observability hub UI in tool responses.
- Streaming dev-env / preview logs over tools (use existing SSE endpoints or
  terminal channel from the UI; tools return status + last-run summary only).
p
## Architecture

```text
┌─────────────────────┐     ┌─────────────────────┐
│ ToolExecutor        │     │ DynamicTool         │
│ (assistant / Codex  │     │ (coding agent MCP)  │
│  project chat)      │     │ issue-bound subset  │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          └───────────┬───────────────┘
                      ▼
    ┌─────────────────────────────────────────┐
    │ HandoffTools │ EvidenceTools │ PreviewTools │ DevEnvTools │ SetupTools │
    └──────────────────────────────────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────┬──────────────┐
          ▼           ▼           ▼              ▼
   AgentHandoffGate  Evidence.*   DevServer.*   DevEnv / RepositoryScanner
```

### Tool exposure matrix

| Tool | Assistant (`ToolExecutor`) | Coding agent (`DynamicTool`) | Notes |
|------|---------------------------|------------------------------|-------|
| `check_handoff_gate` | `identifier` required | issue-bound (no `identifier`) | Same backend |
| `get_evidence_status` | `identifier` required | issue-bound | Includes gate + stored runs |
| `list_comments` | `identifier` required | already exists | Promote to assistant only |
| `update_comment` | `identifier` + `comment_id` | already exists | Promote to assistant only |
| `manage_preview` | already exists | **Phase 1 add** | Extract shared `PreviewTools` |
| `scan_project_setup` | Phase 1 | not exposed | Repo scanner |
| `suggest_project_setup` | Phase 1 | not exposed | WorkflowSuggester |
| `manage_dev_env` | Phase 1 (full actions) | subset (see below) | Dev-env steps + runs |
| `link_pull_request` | Phase 2 | Phase 2 | Wraps `LocalStore.link_manual_pull_request` |
| `get_issue_orchestrator_state` | Phase 2 | not exposed | Wraps `Presenter.issue_payload/3` |
| `explain_dispatch_eligibility` | Phase 2 | not exposed | Pure Elixir over project + issue |
| `manage_blockers` | Phase 3 | optional later | Wraps blocker API logic |
| `sync_issue` | Phase 3 | not exposed | Wraps issue sync endpoint logic |

### Preview / setup / serve flow (agent mental model)

```text
setup  →  scan_project_setup + suggest_project_setup
       →  manage_dev_env(propose_steps | save_steps | run | run_step)
serve  →  dev-env steps with category "serve" (DevEnv.list_serve_steps/1)
       →  manage_preview(start) starts tmux preview instances per repo
preview→  manage_preview(status) → URLs, ports, availability.reason
```

Preview availability depends on dev-env **serve** steps being configured
(`:no_serve_step` when missing). Tools must surface that reason so agents fix
setup before retrying preview start.

## Phase 1 — Handoff, evidence, comments, preview, setup, serve

### 1. `check_handoff_gate`

**Purpose**: Return validate + publish gate results for an issue **before** the
agent attempts a handoff status move.

**Backend**: `AgentHandoffGate.check/3` with workspace
`Workspace.path_for_issue/1` (or issue map containing identifier + project).

**Input schema (assistant)**:

```json
{
  "identifier": "MAC-42"
}
```

**Input schema (coding agent)**: empty object (issue from session context).

**Response `data`**:

```json
{
  "ready": false,
  "target_statuses": {
    "wait_states": ["Human Review"],
    "completion_destinations": ["Done"]
  },
  "validate_gate": {
    "satisfied": false,
    "violations": [
      {"kind": "manifest_missing", "repo": null, "detail": "..."}
    ]
  },
  "publish_gate": {
    "satisfied": true,
    "violations": []
  }
}
```

- `ready` is `true` only when both gates return `:ok`.
- Violation maps mirror `Evidence.Gate` / `RunContract` shapes (atoms as strings
  in JSON).
- On environment-only validate blocks, include `environment_blocked_only: true`
  (from `Evidence.Gate.environment_blocked_only?/1`) so agents stop retrying
  impossible commands.

**Errors**: `:issue_not_found`, `:project_not_found`, invalid identifier.

### 2. `get_evidence_status`

**Purpose**: Surface persisted evidence runs **and** live gate evaluation for the
issue workspace.

**Backend**:

- `Evidence.Store.list/2` — persisted runs (same as `EvidenceController.index`).
- `Evidence.Gate.evaluate/2` — current validate gate decision.
- Project evidence config from `ProjectConfig.resolve/1` → `evidence` key.

**Input**: same identifier rules as `check_handoff_gate`.

**Response `data`**:

```json
{
  "required": true,
  "gate": {
    "satisfied": false,
    "violations": [...]
  },
  "runs": [
    {
      "run_id": "...",
      "kind": "unit",
      "repo": "frontend",
      "status": "passed",
      "command": "yarn test --run tests/foo.test.ts",
      "recorded_at": "2026-06-17T..."
    }
  ],
  "manifest_path": ".symphony/evidence/manifest.json",
  "workspace_path": "/path/to/workspace/MAC-42"
}
```

- Do **not** inline large artifact binaries; include artifact URLs/paths only
  when already present in store records (same as API presenter).
- When `evidence.required != true`, `gate.satisfied` is always true with empty
  violations.

### 3. `list_comments` (assistant)

**Purpose**: List comments on an issue so the assistant can find workpad `id`s.

**Backend**: `Context.list_comments/2` → `TrackerPresenter.comment/1`.

**Input**: `{ "identifier": "MAC-42" }`.

**Response**: `{ "comments": [ ... ] }` ordered oldest-first (match API).

**Note**: Coding agents already have issue-bound `list_comments` in
`DynamicTool`; Phase 1 adds the same capability to `ToolExecutor` with explicit
`identifier`.

### 4. `update_comment` (assistant)

**Purpose**: Edit an existing comment in place (workpad updates).

**Backend**: `IssueAdapter.update_comment/4` (local-first + background sync).

**Input**:

```json
{
  "identifier": "MAC-42",
  "comment_id": 123,
  "body": "## Codex Workpad\n..."
}
```

**Validation**: reject empty body (match `DynamicTool` behavior).

### 5. `manage_preview` (extend — shared module)

**Purpose**: Inspect or control issue dev-server preview (start / stop / restart /
status). Already implemented in `ToolExecutor`; Phase 1 **extracts** logic to
`PreviewTools` and **adds coding-agent** issue-bound exposure.

**Backend**: `DevServer.issue_targets/2`, `DevServer.Manager.start_for_issue/2`,
`stop_for_issue/2`, `restart_for_issue/2` (unchanged semantics).

**Input schema (assistant)** — unchanged:

```json
{
  "identifier": "MAC-42",
  "action": "status | start | stop | restart"
}
```

**Input schema (coding agent)**: `{ "action": "..." }` (issue from session).

**Response `data` (status / post-action)** — enrich existing view:

```json
{
  "available": true,
  "reason": null,
  "servers": [
    {
      "id": "...",
      "repo": "frontend",
      "status": "running",
      "url": "http://127.0.0.1:4102",
      "port": 4102
    }
  ],
  "serve_steps_configured": true
}
```

- When `available: false`, include human-readable `reason` (`disabled`,
  `workspace_missing`, `no_serve_step`) and a `next_steps` hint (e.g. run
  `manage_dev_env(propose_steps)` when `:no_serve_step`).
- Optional future: `server_id` + per-server actions — **out of Phase 1** unless
  needed for multi-repo selective restart.

**Audience**: assistant (existing) + coding agent (new).

### 6. `scan_project_setup`

**Purpose**: Scan linked repositories for stack hints (same as project wizard).

**Backend**: `RepositoryScanner.scan/1` over project's persisted repositories
(`Context.list_repositories/1` → workspace paths).

**Input**:

```json
{
  "repositories": null
}
```

When `repositories` is omitted, use the current project's linked repos.

**Response `data`**: `{ "scans": [ ... ] }` — same shape as
`POST /api/tracker/v1/project_setup/scan`.

**Audience**: assistant only (project authoring / setup chat).

### 7. `suggest_project_setup`

**Purpose**: Deterministic workflow + hook + validation-command suggestions from
scan results.

**Backend**: `WorkflowSuggester.suggest/1`.

**Input**:

```json
{
  "scans": [ ... ],
  "repositories": [ ... ]
}
```

Both arrays optional when the tool can load repositories from project context;
when `scans` is omitted, the tool runs `scan_project_setup` internally first.

**Response `data`**: `{ "workflow_markdown", "workflow_statuses", "validation_commands", "after_create_hook", "scan_summary" }`.

**Audience**: assistant only. Does **not** persist — pair with
`update_project_workflow` or a dedicated save if the user approves.

### 8. `manage_dev_env`

**Purpose**: List, propose, save, and **run** dev-environment setup/serve steps
for a project (Slice D dev-env API as tools).

**Backend**:

| Action | Backend |
|--------|---------|
| `list_steps` | `DevEnv.list_steps/1` |
| `propose_steps` | `DevEnv.propose_steps/1` |
| `save_steps` | `DevEnv.save_steps/2` |
| `run` | `DevEnv.start_run/1` + `Runner.run_step/3` for each step (match API) |
| `run_step` | single step by `step_id` |
| `list_runs` | `DevEnv.list_runs/1` |

**Input schema (assistant)**:

```json
{
  "action": "list_steps | propose_steps | save_steps | run | run_step | list_runs",
  "step_id": "optional for run_step",
  "steps": "required for save_steps — array of step maps"
}
```

**Input schema (coding agent)** — restricted actions only:

```json
{
  "action": "list_steps | run | run_step | list_runs",
  "step_id": "optional",
  "category_filter": "optional — e.g. serve"
}
```

Coding agents must **not** `save_steps` or `propose_steps` (project config is
assistant/operator territory). They may run existing serve steps before e2e /
preview and inspect run history.

**Response `data`**: presenter-shaped steps or runs (`DevEnvPresenter` fields:
`id`, `description`, `command`, `category`, `status`, `exit_code`, …).

**Errors**: `:project_not_found`, `:step_not_found`, run lock conflicts (one
run-all at a time — surface as structured error).

**Relation to preview**: after `run` / `run_step` on `category: "serve"` steps,
agents call `manage_preview(start)` then `manage_preview(status)` for URLs used
in e2e evidence (screenshots / video).

### Implementation modules (Phase 1)

| Module | Responsibility |
|--------|----------------|
| `SymphonyElixir.Assistant.HandoffTools` | `check_handoff_gate/3` execute + spec |
| `SymphonyElixir.Assistant.EvidenceTools` | `get_evidence_status/3` execute + spec |
| `SymphonyElixir.Assistant.PreviewTools` | `manage_preview/3` execute + spec (extract from ToolExecutor) |
| `SymphonyElixir.Assistant.DevEnvTools` | `manage_dev_env/3` execute + spec |
| `SymphonyElixir.Assistant.SetupTools` | `scan_project_setup`, `suggest_project_setup` |
| Extend `ToolExecutor` | Register all Phase 1 tools; delegate comments |
| Extend `DynamicTool` | `check_handoff_gate`, `get_evidence_status`, `manage_preview`, `manage_dev_env` (subset) |
| Extend `ProjectBoardTools` | Add setup/dev-env tools to freeform board specs where `project_slug` required |
| Tests | Unit tests per module; ToolExecutor + DynamicTool integration |

**Refactor constraint**: extract shared logic from `DynamicTool` comment/gate
code paths and `ToolExecutor` preview handler into the new modules; do not
change gate or dev-server semantics.

### Prompt / skill updates (Phase 1)

| File | Change |
|------|--------|
| `assistant/codex_session.ex` | Handoff/evidence tools; preview before e2e; `manage_dev_env` serve steps when preview unavailable |
| `skills/evidence/SKILL.md` | `get_evidence_status`; start preview via `manage_preview` before UI e2e capture |
| `skills/workpad/SKILL.md` | Assistant path: `list_comments` → `update_comment` |
| `skills/workflow/SKILL.md` (optional) | Setup chat: scan → suggest → save workflow / dev-env steps |

## Phase 2 — PR link + orchestrator debug

### 5. `link_pull_request`

**Purpose**: Associate a GitHub PR URL with an issue (today: `mix symphony.link_pr`).

**Input**:

```json
{
  "identifier": "MAC-42",
  "url": "https://github.com/org/repo/pull/123"
}
```

**Backend**: `PullRequestUrl.parse/1` + `LocalStore.link_manual_pull_request/3`.

**Audience**: assistant + coding agent (issue-bound).

### 6. `get_issue_orchestrator_state`

**Purpose**: Answer "what is the orchestrator doing with this issue?"

**Backend**: `Presenter.issue_payload/3` (same as `GET /api/v1/:issue_identifier`).

**Input**: `{ "identifier": "MAC-42" }` (project from ToolExecutor context).

**Response**: pass through presenter payload (`running`, `retry`, `attempts`,
`last_error`, …). Omit or empty `logs.codex_session_logs` if not populated.

**Audience**: assistant only.

### 7. `explain_dispatch_eligibility`

**Purpose**: Explain why an issue is or is not in the orchestrator dispatch queue.

**Logic** (pure, no GenServer required):

1. Load issue + `ProjectConfig.resolve/1`.
2. Check issue status ∈ `config.dispatch_states` (normalized).
3. Check global gates: `Orchestration.require_symphony_label?/0`,
   `require_assignee_match?/0` vs issue labels/assignee.
4. Check terminal/wait states exclusion.
5. Check for active agent execution (`AgentExecution` or orchestrator snapshot
   if cheap).
6. Return structured `{ "eligible": false, "reasons": ["status_not_in_dispatch_states", ...] }`.

**Audience**: assistant only.

## Phase 3 — Blockers + sync

### 8. `manage_blockers`

**Actions** (enum): `list`, `create`, `delete`.

**Backend**: reuse `BlockerController` / `Context` blocker functions.

### 9. `sync_issue`

**Purpose**: Pull remote tracker state after external edits.

**Backend**: reuse `IssueController.sync` logic.

**Audience**: assistant only.

## Error handling

- All tools return `{:ok, %{tool, message, data}}` / `{:error, reason}` through
  existing `ToolExecutor` and `DynamicTool` response wrappers.
- Gate tools never raise on missing manifest — violations are data.
- Assistant tools require valid `project_slug` from session; coding-agent tools
  require issue context from opts (`issue:` keyword).

## Testing

| Layer | Coverage |
|-------|----------|
| `HandoffTools` | satisfied / validate violations / publish violations / env-only |
| `EvidenceTools` | required false, manifest missing, runs listed, gate violations |
| `PreviewTools` | status available/unavailable; start/stop/restart; reason `:no_serve_step` |
| `DevEnvTools` | list/propose/save/run/run_step; coding-agent action subset enforced |
| `SetupTools` | scan + suggest; suggest with implicit scan |
| `ToolExecutor` | assistant path with identifier; unsupported without project |
| `DynamicTool` | issue-bound paths; preview + dev-env run subset |
| Phase 2 | `link_pull_request` happy path + bad URL; dispatch eligibility matrix |

Run `make all` in `elixir/` before merge.

## Rollout

1. **Phase 1** — single PR: handoff/evidence/comments + preview/setup/serve
   modules + ToolExecutor + DynamicTool + skills/prompts.
2. **Phase 2** — orchestrator debug + PR link (assistant-heavy).
3. **Phase 3** — blockers + sync if authoring demand confirms.

No feature flags required; tools appear in tool specs immediately once deployed.

## Open questions (resolved)

| Question | Resolution |
|----------|------------|
| Audience priority | A + B (not CLI) |
| Phase 1 ordering | Handoff/evidence/comments + preview/setup/serve in parallel |
| Preview/setup/serve in Phase 1 | Yes — extend `manage_preview`; add dev-env + setup tools |
| `mix symphony.ctl serve` via tools | No — daemon boot stays operator-only |
| CLI `mix symphony.tracker` | Deferred |

## References

- `elixir/lib/symphony_elixir/agent_handoff_gate.ex`
- `elixir/lib/symphony_elixir/evidence/gate.ex`
- `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- `elixir/lib/symphony_elixir/codex/dynamic_tool.ex`
- `elixir/lib/symphony_elixir/dev_server.ex`, `dev_server/manager.ex`
- `elixir/lib/symphony_elixir/local_tracker/dev_env.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/dev_env_controller.ex`
- `elixir/lib/symphony_elixir_web/controllers/tracker/project_setup_controller.ex`
- `docs/superpowers/specs/2026-05-28-dev-environment-discovery-design.md`
- `docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md`
- `skills/evidence/SKILL.md`, `skills/workpad/SKILL.md`, `skills/workflow/SKILL.md`
