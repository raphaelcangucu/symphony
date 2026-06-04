# Per-Project Workflow as Single Source of Truth + Remove Global `WORKFLOW.md` — Design

Date: 2026-06-03
Status: Proposed (awaiting spec review)
Topic: Replace the form-heavy per-project settings with a hybrid model (small
form for connection/identity + a markdown editor that owns per-project behavior,
stored as text in the DB), make per-project config authoritative end-to-end, and
**delete the process-global `WORKFLOW.md`**, re-homing genuinely process-level
settings into Elixir config/env.

## Background / Motivation

Today there are **three competing sources of truth**:

1. `WORKFLOW.md` (process-global file) — authoritative at runtime via
   `SymphonyElixir.Config` for Codex/Claude CLI + sandbox, `poll_interval`,
   `completion_transitions`, global concurrency, HTTP server bind, observability,
   editor supervisor, and legacy single-tracker bootstrap.
2. `WORKFLOW.<slug>.md` (per-project markdown) — **no longer drives runtime**;
   only a one-time seed via `mix symphony.workflows.backfill` /
   `workflow_discovery.ex`. Goes stale the moment settings are saved.
3. SQLite (`local_tracker_project_setups.workflow_config` map +
   `prompt_template`, `local_tracker_projects.tracker_*`) — what the
   `ProjectConfigEditor` (9 tabs, ~45–55 fields) actually writes.

Problems: silent **drift**, a **"save drops keys"** footgun
(`buildWorkflowConfig` does a full replace and loses `codex:`/`claude:`/`polling:`
imported from backfill), **partial coverage / theater** (`codex:`/`claude:` decide
which agent runs but aren't in the UI; they live in the global file), and **stale
docs**.

### Decisions made with the user

- **Hybrid settings UI**: keep only *basics* as a form (name, description, tracker
  connection/board picker, repositories). Everything else (states, agent, hooks,
  codex/claude, dev_server, **prompt**) moves into one markdown editor with
  validation + preview.
- **Storage**: per-project markdown lives as a **text blob in SQLite**
  (`workflow_markdown`); `WORKFLOW.<slug>.md` files become **optional export**.
- **Split**: markdown = **behavior only**; connection (`github:`/`linear:`/
  `local:`) stays form/DB. No key has two owners.
- **Authoritative end-to-end** (Phase 1 + 2): route today's global agent reads
  through per-project config.
- **Delete the global `WORKFLOW.md` entirely** (Phase 3).
- **Process settings home**: `config/runtime.exs` + `SYMPHONY_*` env vars only
  (no DB instance table, no global settings UI).
- **Drop legacy single-project mode**: every project is a DB row; no app-wide
  single-tracker bootstrap from a global file.
- **Remove project discovery and all `WORKFLOW.*.md` files from the repo**:
  projects are created only via the tracker UI/API. There are **zero workflow
  files on disk**; per-project behavior is the `workflow_markdown` text blob in the
  DB, edited in the UI.

## Goals

- One owner per concern (see Ownership matrix). No overlapping keys, no drift.
- The per-project markdown editor is **truthful**: every key it exposes changes
  that project's runtime behavior.
- Validation + preview in the editor (inline YAML errors; parsed-config + Solid
  prompt preview).
- The app **boots and runs with no `WORKFLOW.md` present**; nothing reads a
  process-global workflow file.
- Backward-compatible migration of existing projects into `workflow_markdown`.

## Non-goals

- Per-project **poll interval** / **global agent concurrency cap**: tied to the
  single orchestrator loop → these become **process config** (not per-project, not
  markdown).
- Per-project **`code-server` editor supervisor**: one managed editor per OS
  process → **process config** for now (per-project editor is a separate change).
- HTTP bind / observability hub → **process config**, not per-project.
- Auto-writing markdown back to disk on save (export is explicit/on-demand).

## Ownership matrix (three buckets)

| Concern | Owner | Read at runtime via |
|---|---|---|
| Name, description | **Form → `projects`** | DB |
| Tracker connection (`github`/`linear`/`local`, board id, repo, status field) | **Form → `projects.tracker_kind`/`tracker_config`** | `ProjectConfig.tracker_*` |
| Repositories | **Form → `repositories`** | DB |
| Tracker **states** | **Per-project markdown** `tracker:` | `ProjectConfig` (already) |
| Prompt body | **Per-project markdown** body | `PromptBuilder` (already) |
| Workspace root + all hooks (`after_create`/`before_run`/`after_run`/`before_remove`) | **Per-project markdown** `workspace:`/`hooks:` | `ProjectConfig` (after_create already; rest = Phase 2) |
| `agent.max_turns`, timeouts, `completion_transitions`, `max_concurrent_agents_by_state` | **Per-project markdown** `agent:` | **Phase 2 reroute** |
| `codex:` (command, sandbox, approval), `claude:` (command) | **Per-project markdown** | **Phase 2 reroute** (`codex/config.ex:147`, `claude/config.ex:28`) |
| `dev_server:` / `public_tunnel:` | **Per-project markdown** | DevServer.Manager (already merges per-project) + Phase 2 for the rest |
| **Poll interval** | **Process config** | `orchestrator.ex:59/1328`, `dev_server/reconciler.ex:397` |
| **Global concurrency cap** (`max_concurrent_agents`) | **Process config** | `orchestrator.ex:60/1055/1329`, `status_dashboard.ex:342` |
| **HTTP server** (`server.host/port`) | **Process config** (`SYMPHONY_TRACKER_PORT` exists) | `http_server.ex:21-23` |
| **Observability** (dashboard + reporter/hub) | **Process config** | `status_dashboard.ex`, `observability/reporter.ex` |
| **Editor supervisor** (`editor:`) | **Process config** | `editor*.ex` |
| **Default agent kind** when project omits agent | **Process config** (`:default_agent_kind` already in `config.exs`) | `agent_runner`, mappers |
| **Tracker sync enabled** | **Process config** (already app env `:tracker`) | `tracker.ex:64` |
| `assistant.draft_status` | **Per-project markdown** `assistant:` (or process default) | `assistant/tool_executor.ex:590` |

## Architecture & data flow (after removal)

```
Process settings  → config/runtime.exs + env (SYMPHONY_*)  → SymphonyElixir.Config
                     (poll, concurrency cap, server, observability, editor,
                      default_agent_kind, tracker_sync)

Settings page
 ├─ Form (basics)  → PUT /projects/:slug, /projects/:slug/repositories
 └─ Markdown editor → PUT /projects/:slug/setup (workflow_markdown: text)
                        → Config.parse_workflow_markdown/1 (validate)
                        → project_setups.workflow_markdown

Dispatch / runtime
 ProjectConfig.resolve(project)
   ├─ tracker_kind/config ← projects (form/DB)
   └─ parse(workflow_markdown) → front matter + body
        → states, workspace, hooks, agent_kind, prompt        (Phase 1)
        → codex, claude, agent limits, completion_transitions,
          dev_server                                           (Phase 2)
 Call sites that have an issue/project resolve per-project; process-loop
 concerns read process config. NOTHING reads a global WORKFLOW.md file.
```

## Phase 1 — storage, editor, parsing (per-project markdown authoritative for already-resolved keys)

1. **Migration**: add `workflow_markdown :text` to `local_tracker_project_setups`.
2. **Parser**: `SymphonyElixir.Workflow.parse_string/1` (refactor existing
   `parse/1` body); `Config.parse_workflow_markdown/1` → `{:ok, front_matter,
   body}` | `{:error, issues}` reusing `validate_front_matter/1`.
3. **ProjectConfig.resolve/1**: parse `setup.workflow_markdown` for front matter +
   prompt body; fall back to legacy `workflow_config`/`prompt_template` while null.
4. **Controller**: `ProjectController.update_setup` accepts + validates
   `workflow_markdown`; keep legacy fields for one release.
5. **Frontend**: replace 9-tab form with **Basics form** (name, description,
   `TrackerSourceFields`, `RepositoriesSection`) + **Workflow markdown editor**
   (front matter + body; parse-on-save; inline errors; preview = parsed config +
   Solid-rendered prompt with a sample issue). Wire the unused `LoadDefaultMenu`/
   templates to seed the editor. Drop `buildWorkflowConfig`.
6. **Backfill**: serialize existing `workflow_config` + `prompt_template` into a
   `workflow_markdown` blob for projects lacking one (and/or import repo
   `WORKFLOW.<slug>.md`).

## Phase 2 — route per-project agent reads

Extend `ProjectConfig` with `codex`, `claude`, `max_turns`, `turn/read/stall
timeouts`, `completion_transitions`, `max_concurrent_agents_by_state`,
`dev_server`, full `hooks`. Reroute call sites that already have an issue/project,
preferring per-project values, falling back to process config:

- `agent_runner.ex:119` → per-project `max_turns`.
- `orchestrator.ex:759` → per-project `completion_transitions`.
- `orchestrator.ex:497` → per-project `max_concurrent_agents_by_state`.
- `orchestrator.ex:368` → per-project `stall_timeout`.
- `codex/coding_agent.ex` / `claude/coding_agent.ex` timeouts → per-project.
- `codex/config.ex:147` / `claude/config.ex:28` → resolve agent command+sandbox
  **once at dispatch** from the project, passed down (recommended) rather than
  global lookups deep in the stack.
- `workspace.ex:132-145,244,267` → per-project `before_run`/`after_run`/
  `before_remove` hooks.

Concurrency-sensitive: resolve per-project only at safe call sites (dispatch,
completion-transition), never inside the global poll loop. Cover with
`orchestrator_dispatch_gate_test.exs` and friends.

## Phase 3 — delete global `WORKFLOW.md`

### Re-home process-global settings (config/env, no markdown)

Move these `Config` accessors off the global front matter onto
`config/runtime.exs` + `SYMPHONY_*` env vars (port override already exists):

- `polling.interval_ms` → `:poll_interval_ms`
- `agent.max_concurrent_agents`, `agent.max_retry_backoff_ms` → app env
- `server.host/port` → app env (`SYMPHONY_TRACKER_HOST/PORT`)
- `observability.*` → app env
- `editor.*` → app env
- `default_agent_kind` → already `:default_agent_kind` in `config.exs`
- `tracker_sync_enabled?` → already app env `:tracker`

`SymphonyElixir.Config` keeps the **NimbleOptions schema** for per-project
front-matter validation, but its **process-global accessors** read app env instead
of `Workflow.current/0`.

### Boot / lifecycle changes

- **Remove `WorkflowStore`** from `SharedSupervisor` (it watches the global file).
  Per-project config is read from DB at `ProjectConfig.resolve/1`; no hot-reload of
  a global file needed.
- `Workflow.workflow_file_path/0`, `set/clear_workflow_file_path/1`,
  `Workflow.current/0`, `Workflow.load/0` and the `cwd/WORKFLOW.md` default are
  removed or reduced to per-slug `load/1` used only by discovery/backfill/export.
- `orchestrator.ex:187,240` `Config.validate!/0` (validates global file) → validate
  **process app env** + skip global file entirely.
- `dev/serve.exs`, `cli.ex`, `symphony.ctl.ex`, `Makefile:178`: stop requiring a
  global workflow file; escript/CLI no longer take a WORKFLOW path (or treat it as
  optional no-op).
- `assistant/read_tools.ex` `get_workflow` tool: repoint to per-project markdown or
  remove.

### Discovery / single-project mode (both removed)

- **Remove `WorkflowDiscovery`** and its boot call: projects are created only via
  the tracker UI/API (`ProjectController` create + `update_setup`). No directory is
  scanned at boot.
- **One-time backfill before deletion**: run `mix symphony.workflows.backfill` (or
  a dedicated migration task) once to serialize each existing project's
  `workflow_config` + `prompt_template` (or its repo `WORKFLOW.<slug>.md`) into
  `workflow_markdown`. Then **delete all `WORKFLOW*.md` and `WORKFLOW.*.example.md`
  files** from `elixir/` and drop the `mix symphony.workflows.backfill` task (or
  keep it as an import-from-pasted-text utility only).
- **Drop legacy single-project mode** entirely: no auto-create from a global file
  or env. Existing single-project deployments must have their project as a DB row
  (covered by the one-time backfill).
- Existing DB projects (e.g. `distributionmachine`, `macro-markets`) already exist
  as rows and keep working; only their on-disk markdown files go away.

### Test migration (largest mechanical cost)

- `test/support/test_support.exs:31-46` writes a temp `WORKFLOW.md` +
  `set_workflow_file_path/1` for **~51** modules; **43** more files reference
  `workflow_file_path` directly.
- Replace TestSupport setup with: set process settings via app env
  (`Application.put_env`) + create a project row with `workflow_markdown` for tests
  that need behavior. Provide a `TestSupport.put_process_config/1` and
  `TestSupport.project_with_markdown/1` helper to minimize churn.
- Delete/rewrite `extensions_test.exs` (WorkflowStore), `core_test.exs` ("current
  WORKFLOW.md valid"), `dev_serve_test.exs` global-file branches.

## Validation & preview

- Save rejected (422 + structured issues) on unparseable YAML or
  `validate_front_matter/1` failure; editor renders issues inline.
- Connection keys (`github:`/`linear:`/`local:`) in per-project front matter are
  **rejected** (connection is form-owned) — enforces no-double-owner.
- Process-only keys (`server:`/`observability:`/`polling:`/`editor:`) in
  per-project markdown are **rejected** with a message pointing to process config.
- Preview: resolved states, agent backend, agent limits, Solid-rendered prompt vs
  a synthetic issue.

## Migration & compatibility

Single change (Phases 1+2+3 together), executed in this order so the app never
boots in a broken state:

1. Add `workflow_markdown` column.
2. **Data migration**: for every existing project, serialize its current
   `workflow_config` + `prompt_template` (or its repo `WORKFLOW.<slug>.md`) into
   `workflow_markdown`.
3. Switch `ProjectConfig.resolve/1` and all per-project readers to
   `workflow_markdown`.
4. Re-home process settings to `runtime.exs`/env; remove `WorkflowStore`,
   `WorkflowDiscovery`, global `Workflow.current/load`, single-project bootstrap.
5. **Drop** `workflow_config` + `prompt_template` columns (no deprecation window).
6. Delete all `elixir/WORKFLOW*.md` files and update CLI/serve/Makefile/docs.

A startup check logs a clear error if any code path still references a removed
global accessor.

## Risks

- **Orchestrator regressions** (Phase 2) — concurrency-sensitive; mitigate with
  targeted tests + safe-site resolution only.
- **Boot breakage** (Phase 3) — many entry points assume a global file; mitigate
  with the env mapping + making `WorkflowStore`/CLI optional first, then deleting.
- **Test churn** — large but mechanical; the TestSupport helpers contain the blast
  radius.
- **Losing single-project convenience** — decide whether to keep a one-project
  bootstrap path.

## Testing

- `Workflow.parse_string/1`, `Config.parse_workflow_markdown/1`: valid/invalid/
  missing/connection-key + process-key rejection.
- `ProjectConfig.resolve/1`: reads from `workflow_markdown`; legacy fallback.
- Phase 2: `agent_runner` max_turns, orchestrator completion_transitions +
  per-state concurrency, codex/claude per-project resolve with process default.
- Phase 3: app boots with **no** `WORKFLOW.md`; process accessors read env;
  discovery still imports `WORKFLOW.<slug>.md`; CLI/serve start without a file.
- Frontend (Vitest/RTL): basics form + markdown editor; correct endpoints;
  invalid markdown errors; preview renders.

## Resolved decisions

- **Process settings** → `config/runtime.exs` + `SYMPHONY_*` env vars only.
- **Single-project / legacy tracker mode** → dropped.
- **Discovery + `WORKFLOW.*.md` files** → removed; project creation is UI/API-only
  after a one-time backfill into `workflow_markdown`.
- **`WorkflowStore`** → removed (per-project config is DB-resolved).
- **Sequencing** → ship Phases 1+2+3 **together** as one change.
- **Editor** → process config in `.env` / `runtime.exs` (global), not per-project.
- **Legacy columns** (`workflow_config`/`prompt_template`) → **removed in this
  work** (no deprecation window): backfill into `workflow_markdown`, then drop the
  columns in the same change.
- **Agent selection** → three-level precedence (see below).

## Agent selection (Codex vs Claude) — three levels

The agent **config** (`codex:`/`claude:` blocks: command, sandbox, approval) is
**per-project markdown**, with process-env defaults as fallback. *Which* agent runs
a given task is resolved by precedence, **most specific wins**:

1. **Per-task** (highest): the issue's explicit selection — today via labels
   `symphony:codex` / `symphony:claude` → `issue.agent_kind`
   (`AgentRouting.resolve_agent_kind/3`, `CodingAgent.run_turn` uses
   `issue.agent_kind`). Also settable at create time and at dispatch.
2. **Assistant choice**: the New-issue / dispatch assistant can pick the agent,
   which sets the per-task selection (label/field) before dispatch. Extend the
   existing `dispatch_codex` path to a generic `dispatch_agent`/agent param so
   Claude is selectable there too.
3. **Per-project default** (lowest before process default): when the task only has
   the bare `symphony` label (or none), fall back to the **project's default agent
   kind** declared in its markdown (presence of `codex:`/`claude:` + an explicit
   `default` if both). This replaces the global `Config.default_agent_kind()` as
   the `default_kind` argument to `AgentRouting.resolve_agent_kind/3`.
4. Process env `:default_agent_kind` remains the final fallback when a project
   declares neither.

Implementation touch points: `agent_routing.ex` (already does label→kind), pass
the **project** default into `resolve_agent_kind/3` instead of `Config`;
`coding_agent.ex` `adapter_for/1` per-task `agent_kind` already honored;
`Codex.Config`/`Claude.Config` read per-project blocks resolved at dispatch.

## Open decisions for review

1. **`mix symphony.workflows.backfill`**: delete after the one-time run, or keep it
   repurposed as a "paste markdown → import" utility in the UI?
