# Multi-Orchestrator Projects — Design

- **Date:** 2026-06-02
- **Status:** Draft (design approved in brainstorming; pending user review of written spec)
- **Area:** `elixir/` (config, orchestrator, observability) + `tracker/` (project modal)

## Problem & Motivation

Today one `make serve` binds the whole process to a **single** `WORKFLOW.md`:

- The workflow file selected at boot (`CLI arg → $SYMPHONY_WORKFLOW → ./WORKFLOW.md`) is stored in `:workflow_file_path` and loaded by `WorkflowStore`.
- `SymphonyElixir.Config` reads **everything** from that single file — `tracker_kind`, repo/assignee, states, workspace, hooks, agent settings, and the prompt (`Config.workflow_config/0`, `Config.workflow_prompt/0`).
- Observability reports **one** `runtime` per process with **one** `project_slug`.

Consequences:

- Switching workflow files (e.g. `./WORKFLOW.md` Linear vs `WORKFLOW.macro-markets.md` GitHub) changes the lens/config over the **same shared SQLite DB** (`SYMPHONY_LOCAL_TRACKER_DATABASE`, default `elixir/.symphony/tracker.sqlite3`). It looks like data was lost, but it is the same DB with different global config.
- You cannot bring up the orchestrator for **all** projects in the local DB at once — only the one workflow's identity.
- Observability cannot "listen to" multiple local-DB projects from a single process.

**Goal:** When the server boots, it orchestrates **every** non-archived project in the local DB, each with its **own** resolved config + prompt, and observability shows **all** of them. Per-project config + prompt become **DB-owned** (single source of truth), editable in the tracker UI with a markdown editor and a "load default" action. WORKFLOW files become **templates**, not the source of truth.

## Approved Decisions (from brainstorming)

1. **Process model — A (single process, DB-driven):** one boot → one BEAM → one Orchestrator that already iterates `Context.list_projects/0`; the gap is per-project config, not the loop. Keeps a single SQLite writer (no multi-process contention). Fault isolation per project via skip-with-warning (Approach C / `DynamicSupervisor` deferred as a future upgrade; not required now).
2. **Config source — DB is source of truth:** structured config (form-edited) + markdown prompt (text) live in the DB. WORKFLOW files become `load default` **templates** and optional export. The earlier `workflow_path` file-pointer idea is **dropped**.
3. **Data home — reuse `local_tracker_project_setups`:** `workflow_config` (map) + `prompt_template` (string) already exist per project (`Project has_one :setup`). No new project columns required for the core; extend `workflow_config` shape as needed.
4. **Observability — one entry per project:** the single process self-registers/reports one runtime entry **per project** (composite `runtime_id`, `label` = project name, `project_slug` = slug), so the existing hub (keyed by `runtime_id`) and UI (grouped/filtered by project) render a card per project with minimal change.
5. **Boot — backfill + auto-discovery (hybrid):** a one-time backfill imports existing `WORKFLOW.*.md` into per-project setups (match by slug; `macro-markets` → `WORKFLOW.macro-markets.md`). Boot auto-discovery only **creates missing** projects from template/workflow files; it **never overwrites** DB-edited config.
6. **Modal — markdown editor + load default:** the project create/edit modal gains a Write/Preview markdown editor for `prompt_template` (reusing the existing `Markdown` renderer; no heavy new dependency) and a "load default" dropdown sourced from `WorkspaceTemplate`s.

## Architecture Overview

```
make serve (global config only: port, observability hub, SQLite path, tunnel, total agent cap)
        │
        ▼
Application boot ── migrate ── backfill setups from WORKFLOW.*.md (one-time)
        │                       auto-discover: create missing projects (never overwrite)
        ▼
Orchestrator poll cycle
        │  Context.list_projects/0  (already multi-project)
        ▼
  for each project p:
        ProjectConfig.resolve(p)  ──reads──▶ local_tracker_project_setups (workflow_config + prompt_template)
                                              fallback ──▶ global defaults (Config)
        │ candidates by p's states + p's assignee   (LocalFirstTracker, already per-project assignee)
        │ dispatch agent with p's prompt
        ▼
Observability.Reporter ── one report per project ──▶ Registry (ETS, keyed by runtime_id) ──▶ Tracker UI cards
```

Principles:

- **Single source of truth = DB.** Per-project config/prompt is read from `ProjectSetup`; files are imports/exports only.
- **Single writer.** One BEAM, one SQLite connection pool — no multi-process write contention.
- **Isolation by skip.** A project whose config cannot be resolved (or whose dispatch raises) is skipped with a logged warning; the loop continues for the others. No project can inherit another project's remote identity (gating safety).
- **Reuse over rebuild.** The orchestrator loop, the `ProjectSetup` table, the observability hub/UI, and the project modal already exist; this work threads per-project config through them.

## Data Model

No new tables. The per-project workflow already has a home in `local_tracker_project_setups`:

| Field (existing) | Use in this design |
|---|---|
| `workflow_config` (map) | Structured per-project config: `tracker` (kind + remote config), `states` (field/active/wait/terminal), `workspace`, `hooks`, `agent`, `polling` overrides. Mirrors WORKFLOW front-matter shape. |
| `prompt_template` (string) | Per-project prompt (ex-markdown body). Edited via the modal's markdown editor. |
| `after_create_hook` (string) | Per-project clone/setup hook (already used by workspace creation). |
| `validation_commands` (map) | Existing; unchanged. |
| `scan_summary` (map) | Existing; unchanged. |

`Project.tracker_kind` and `Project.tracker_config` remain the canonical remote identity (already validated for `github`/`linear`). `workflow_config` holds the rest (states/hooks/workspace/agent) that today only the global file carries.

**Migration (additive, optional):** if any per-project field needs promotion out of the `workflow_config` map for indexing, add nullable columns; otherwise no schema migration is required. The only required data step is the **backfill** (below), which is data, not schema.

## Per-Project Config Resolution

New module **`SymphonyElixir.ProjectConfig`** (resolution + caching), layered as:

```
ProjectConfig.resolve(project) =>
   merge(global_defaults, project.setup.workflow_config)
   prompt   = project.setup.prompt_template || global default prompt
   tracker  = {project.tracker_kind, project.tracker_config}
```

- Returns a `%ProjectConfig{}` struct: `tracker_kind`, `tracker_config`, `active_states`, `wait_states`, `terminal_states`, `field_states`, `workspace_root`, `after_create_hook`, `agent` (kind/command/max_turns/completion_transitions), `prompt`.
- **Global vs project split:** `Config` stays the owner of **process-level** settings (`server.port`, `observability.*`, SQLite path, `public_tunnel.*`, total `agent.max_concurrent_agents`, `polling.interval_ms` default). Everything else is resolved per project, with the global workflow's values used as **defaults** when a project's `workflow_config` omits a key (backward compatible with single-project setups).
- **Threading:** the `ProjectConfig` is resolved once per project per poll cycle and passed explicitly into the per-issue dispatch (each agent already runs as an isolated task per issue), so no global mutable "current project" state is introduced.
- **Caching/reload:** `ProjectConfig` is derived from DB rows; it is recomputed each cycle (cheap) or memoized with invalidation on project/setup update broadcasts. The global `WorkflowStore` continues to provide the defaults layer.

### Touch points (read global today → read per-project)

- `Config.active_states/0`, `wait_states/0`, `terminal_states/0`, `field_states/0` → per-project variants taking a `ProjectConfig` (keep zero-arg as "global default").
- `Config.workflow_prompt/0` → `ProjectConfig.prompt` (per project) for prompt building (`PromptBuilder`).
- `LocalFirstTracker` already resolves assignee per `project.tracker_kind`; extend so `fetch_issues_by_states` filters by **each project's** active states from its `ProjectConfig` rather than the single global `Config.active_states/0`.
- Agent dispatch (`agent.command`, `completion_transitions`, `max_turns`, workspace root, `after_create` hook) resolved from the issue's `ProjectConfig`.

## Orchestrator (multi-project dispatch)

- The poll loop keeps using `Context.list_projects/0` (multi-project already). For each project it resolves `ProjectConfig`, then queries candidates by that project's active states and assignee, and dispatches with that project's prompt/agent/workspace.
- **Concurrency:** `agent.max_concurrent_agents` remains a single **global** pool for MVP (simple, predictable). Per-project caps are explicitly out of scope (YAGNI) and noted as a future enhancement.
- **Isolation:** resolution or dispatch failure for one project is caught, logged (`multi_orchestrator: project=<slug> skipped reason=<...>`), and surfaced in observability for that project's card; other projects proceed. A project with an unresolvable assignee filter is skipped (existing `LocalFirstTracker` safety), never defaulting to "any".

## Observability (multi-project)

- `Observability.Reporter` changes from one report per process to **one report per non-archived project**:
  - `runtime_id` = `<base_runtime_id>:<project_slug>` (base from `Config.observability_runtime_id/0`).
  - `label` = project name; `project_slug` = slug; `tracker_kind` = project's kind.
  - `snapshot` = `Presenter.state_payload` scoped to that project's running/retrying issues.
- The hub `Registry` (ETS keyed by `runtime_id`) and the tracker `ObservabilityPage` (already groups/filters by project and flattens running sessions) require no structural change — each project becomes its own card automatically.
- Heartbeat/coalesce semantics unchanged (`heartbeat_interval_ms`, `min_report_interval_ms`); the reporter iterates projects per tick.
- **Remote hub mode** (`observability.hub_url` set) is preserved: a worker process still POSTs, now one body per project. The hub aggregates across processes and projects uniformly.

## UI — Project Create/Edit Modal

Extend the existing project modal flow (`ProjectCreateDialog` / `EditProjectDialog`) to own the per-project workflow:

- **Config form:** reuse existing tracker fields (GitHub board picker, Linear picker) and add fields for states, workspace root, and `after_create` hook (the `TemplateForm` already edits hook/validation/prompt with `Textarea`s — reuse those patterns). These persist into `setup.workflow_config` / `setup.after_create_hook` via the existing `/projects/workspace`-style setup payload (`workflow_config`, `after_create_hook`, `prompt_template`, ...).
- **Markdown editor (prompt):** a tabbed **Write / Preview** control — `Textarea` for editing + the existing `@/components/ui/markdown` (`react-markdown` + `remark-gfm`) for preview. No heavy editor dependency for MVP; a CodeMirror/Monaco upgrade is a later option.
- **Load default:** a dropdown of `WorkspaceTemplate`s (already exist with export-to-YAML). Selecting one fills the config form + prompt editor from the template. The backfill imports `WORKFLOW.macro-markets.md` as a default template so it is selectable.
- **Edit parity:** `EditProjectDialog` gains the prompt editor + workflow_config fields (today it only edits name/description/tracker source), so an existing project's prompt/config is editable post-creation.

## Boot, Backfill & Discovery

- **Global config at boot:** the process still loads a global workflow/config for process-level settings (port, observability hub, SQLite path, tunnel, total agent cap). This keeps `make serve` backward compatible; the global file's project-level fields become defaults for projects that omit them.
- **One-time backfill (data migration / mix task):** for each existing project, if `setup.workflow_config`/`prompt_template` is empty, import from a matching `WORKFLOW.<slug>.md` (match by slug). Parse YAML front matter → `workflow_config`, body → `prompt_template`. `macro-markets` ← `WORKFLOW.macro-markets.md`. Idempotent: skips projects that already have DB-owned config.
- **Auto-discovery (boot):** scan the workflows directory; for each `WORKFLOW.<slug>.md` with **no** matching project, create the project + setup from the file. Existing projects are **never** overwritten (DB is truth). Logged as `multi_orchestrator: discovered project=<slug>`.
- **Fallback:** a project with no resolvable config and no global defaults for the required remote keys is skipped with a warning (never inherits another project's remote identity).

## Error Handling & Isolation

- Per-project resolution/dispatch wrapped so a failure is logged and skipped, not fatal.
- Assignee filter unresolved → project skipped (existing safety).
- Reporter failures for one project do not block reporting others.
- Backfill/discovery failures for one file are logged and skipped; boot continues.
- Remote hub POST failures fall back to the existing retry/coalesce behavior; in-process registry is unaffected.

## Testing Strategy

- **Unit (no network):**
  - `ProjectConfig.resolve/1`: merge of global defaults + `workflow_config`; prompt fallback; missing-key fallback; per-kind tracker config.
  - States/assignee resolution per project (multiple projects with different active states return disjoint candidate sets).
  - Backfill: imports YAML+body into setup; idempotent (run twice = same); slug matching; skips DB-owned config.
  - Auto-discovery: creates missing project; never overwrites existing; logs.
- **Orchestrator integration:** seed N projects with distinct configs in the local DB; one poll cycle dispatches per-project with the right prompt/states; a project with an unresolvable assignee is skipped; a raising project does not abort the others.
- **Observability:** `Reporter` emits one entry per project (composite `runtime_id`, per-project snapshot); `Registry` stores N entries; PubSub broadcasts per project; remote hub mode POSTs one body per project.
- **Frontend (Vitest):** modal renders prompt Write/Preview; "load default" fills config + prompt from a template; edit dialog persists `workflow_config`/`prompt_template` via the setup payload; markdown preview renders.
- **Non-regression:** single-project setups (one global workflow, one project) behave as before (global defaults fill omitted per-project keys); existing suites stay green; `make all` clean (format, credo, coverage, dialyzer); `mix specs.check` for new public `def`s.

## Out of Scope (this SPEC)

- Per-project concurrency caps (global pool only for now).
- `DynamicSupervisor`-per-project fault isolation (Approach C) — future upgrade; current isolation is skip-with-warning.
- Webhooks / push-based observability.
- A rich code editor (CodeMirror/Monaco) for the prompt (Write/Preview textarea + react-markdown for MVP).
- Automatic two-way file↔DB export on every save (DB is truth; export stays a manual action like the existing template export).

## Open Questions / Risks

- **Defaults layering:** with the global workflow providing defaults, a project that intends to *clear* a setting (e.g. disable a hook) needs an explicit empty value vs "inherit" semantics. Resolution: store explicit values in `workflow_config`; absence = inherit global default.
- **`workflow_config` shape drift:** the map must stay aligned with the WORKFLOW front-matter schema (`NimbleOptions` in `Config`). Resolution: validate `workflow_config` against the same option schema on save and on resolve.
- **Backfill matching:** projects whose slug does not match any `WORKFLOW.<slug>.md` are left with empty config and rely on global defaults until edited in the UI; surfaced via the project's observability card (skipped/warning).
- **Observability cardinality:** many projects → many runtime cards; ensure stale/drop TTLs in `Registry` prune projects that go archived or stop reporting.
