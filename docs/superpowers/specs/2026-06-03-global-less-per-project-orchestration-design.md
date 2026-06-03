# Global-less Per-Project Orchestration — Design

- **Date:** 2026-06-03
- **Status:** Draft (design approved in brainstorming; pending user review of written spec)
- **Area:** `elixir/` — `Config`, `Tracker`/`Tracker.adapter`, `Orchestrator`, `ProjectConfig`, `PromptBuilder`, `dev/serve.exs`
- **Supersedes:** decision #1 of `2026-06-02-multi-orchestrator-projects-design.md` (which kept a global workflow for process settings **and** as a per-project default layer). This design removes the global workflow as a config source entirely.

## Problem & Motivation

Today `make serve` binds the whole process to a **single** global `WORKFLOW.md`, and that global file is still:

1. The gate that decides whether the multi-project local-first reader runs — `Tracker.adapter/0` picks `LocalFirstTracker` only when `Config.tracker_kind/0` (read from the global file) is `github`/`linear`/`jira` (`elixir/lib/symphony_elixir/tracker.ex:62-71`).
2. The source of the orchestrator's state machine — `orchestrator.ex` reads `Config.active_states/0` / `terminal_states/0` globally (`active_state_set/0` at `elixir/lib/symphony_elixir/orchestrator.ex:554-555`).
3. The **fallback** for any project that lacks a DB-owned setup — `ProjectConfig.resolve/1` deep-merges the global front matter under the project's `workflow_config`, and `PromptBuilder` falls back to the global prompt (`elixir/lib/symphony_elixir/prompt_builder.ex:48-55`).

Consequence (observed with `DIS-1`): `distributionmachine` (project 40) has **no** `ProjectSetup`, so it inherits the global `WORKFLOW.macromarkets.example.md` (repo `clouapp/front`, branch `homolog`, that board's prompt) — the wrong identity and instructions for `clouapp/distributionmachine`.

**Goal:** Each project is **fully self-describing and isolated from boot**. There is **no global workflow** as a config or prompt source. Process/host-level settings come from environment/application config. A project that cannot resolve its own config is **skipped with a warning** — it never inherits another project's identity.

## Approved Decisions (from brainstorming)

1. **Process model — A (single process, single orchestrator loop):** keep one BEAM and one `Orchestrator` GenServer iterating `Context.list_projects/0`; resolve every project's config/prompt/states/agent/tracker **only** from its DB setup. Single SQLite writer. Per-project fault isolation via skip-with-warning. (Per-project `DynamicSupervisor`/per-process — Approaches B/C — explicitly deferred.)
2. **No global workflow as config source.** `Config` stops owning any project-level field. `dev/serve.exs` no longer requires `SYMPHONY_WORKFLOW`.
3. **Process/host settings live in env / `config.exs`:** HTTP port, SQLite path, total agent concurrency cap, observability hub, public tunnel, default polling interval. Never in a workflow markdown file.
4. **Per-project source of truth = DB:** `local_tracker_project_setups.workflow_config` (map) + `prompt_template` (string) + `projects.tracker_kind`/`tracker_config`. No fallback to a global file.
5. **State-machine defaults are code constants, not a workflow file.** When a project's `workflow_config` omits states, it inherits Config's hardcoded `@default_active_states`/`@default_terminal_states` (code-level defaults), not a global workflow's values.
6. **Boot keeps the existing one-time backfill (`mix symphony.workflows.backfill`) and optional auto-discovery** of `WORKFLOW.<slug>.md` → missing project setups; never overwrites DB-owned config.

## Architecture Overview

```
make serve / dev/serve.exs
   (process settings ONLY: port, SQLite path, total agent cap, observability, tunnel, polling default — from env/config.exs)
        │
        ▼
Application boot ── migrate ── (optional) auto-discover: create missing projects from WORKFLOW.<slug>.md (never overwrite)
        │
        ▼
Orchestrator (single GenServer)
        │  Context.list_projects/0
        ▼
  for each non-archived project p:
        cfg = ProjectConfig.resolve(p)          # DB-owned only; no global merge
        if cfg invalid (no tracker identity / no prompt) -> skip + warn + observability flag
        else:
          candidates by cfg.active_states + p's assignee   (LocalFirstTracker)
          dispatch agent with cfg.prompt / cfg.agent / cfg.workspace_root / cfg.after_create_hook
        ▼
LocalFirstAdapter writes local + enqueues remote sync (per p.tracker_kind/tracker_config)
```

Principles: single source of truth = DB; single SQLite writer; isolation by skip; no cross-project identity bleed; reuse the existing loop/`ProjectSetup`/observability rather than rebuild.

## Process vs Project Config Split

**Process/host (env or `config.exs`, single per process):**

- HTTP port (`server_port`, already overridable via `:server_port_override`).
- SQLite path (`local_database_path` / `SYMPHONY_LOCAL_TRACKER_DATABASE`).
- Total agent concurrency cap (`agent.max_concurrent_agents` → moves to app config).
- Observability (`hub_url`, intervals, `runtime_id` base) and public tunnel.
- Default polling interval.
- `tracker_sync_enabled?` defaults to **true** for this model (multi-project local-first is always on); read from `:symphony_elixir, :tracker` app config (`config.ex:307-311`).

**Per project (DB `ProjectSetup` + `projects` row):**

- `tracker_kind` + `tracker_config` (remote identity — already canonical on the `projects` row).
- States: `active_states`, `wait_states`, `terminal_states`, `field_states` (from `workflow_config`, else code defaults).
- `agent`: kind/command, `max_turns`, `completion_transitions`.
- `workspace_root`, `after_create_hook`.
- `prompt_template`.

`ProjectConfig.resolve/1` changes from `deep_merge(Config.workflow_front_matter(), setup_front_matter)` to `deep_merge(code_defaults(), setup_front_matter)` — the merge base is a **code constant** of process-agnostic defaults, never a loaded global workflow. The struct shape (`%ProjectConfig{}`) is unchanged.

## Touch Points (global read → per-project / process)

1. **`Tracker.adapter/0` (`tracker.ex:62-71`):** select `LocalFirstTracker` whenever `Config.tracker_sync_enabled?/0` is true, independent of `Config.tracker_kind/0`. The per-project remote kind already drives `IssueAdapter.for/1` and per-project sync. Removes the "global must be github" coupling.
2. **`Orchestrator` `active_state_set/0` / `terminal_state_set/0` (`orchestrator.ex:233,248,252,554-555`):** resolve per project from `ProjectConfig`. `reconcile_running_issue_states/4` and candidate gating receive the issue's project states rather than the global set. (`LocalFirstTracker` already filters candidates by per-project active states — `local_first_tracker_test.exs:131`; this aligns the orchestrator-side gating.)
3. **`PromptBuilder.resolve_template/1` (`prompt_builder.ex:39-55`):** keep per-project resolution; **remove `global_template/0` fallback**. A project without a `prompt_template` is treated as unresolved config → skipped with warning (no global prompt).
4. **`ProjectConfig.resolve/1` (`project_config.ex:36-57`):** merge base becomes code defaults, not `Config.workflow_front_matter/0`.
5. **`Config`:** keep process-level getters; the zero-arg `active_states/0`/`terminal_states/0`/`wait_states/0`/`field_states/0` return **code defaults** (for project seeding / UI when no project context). Remove orchestrator/prompt reliance on `workflow_prompt/0` and `workflow_front_matter/0`.
6. **`dev/serve.exs`:** drop the `SYMPHONY_WORKFLOW` requirement and the single-workflow path set; boot the app with process settings only. Keep the single-instance guard and migrate step.

## Boot, Backfill & Discovery

- **No global workflow load at boot.** Process settings come from env/`config.exs`.
- **One-time backfill (existing `mix symphony.workflows.backfill`):** import `WORKFLOW.<slug>.md` → matching project's `workflow_config` + `prompt_template`; idempotent; skips DB-owned. Used to seed `macro-markets` and `distributionmachine` setups.
- **Optional auto-discovery (boot):** for each `WORKFLOW.<slug>.md` with no matching project, create the project + setup; never overwrite existing DB config. Logged `multi_orchestrator: discovered project=<slug>`.
- **Projects are created/edited via the tracker UI** (markdown prompt editor + workflow_config fields — per the existing multi-orchestrator design doc).

## Error Handling & Isolation

- `ProjectConfig.resolve/1` raising or returning an invalid config (no tracker identity, or no prompt) → the project is **skipped**, logged (`multi_orchestrator: project=<slug> skipped reason=<...>`), and flagged on its observability card. Other projects proceed.
- Unresolvable assignee filter → project skipped (existing `LocalFirstTracker` safety), never defaulting to "any".
- No project ever inherits another project's `tracker_kind`/`tracker_config` or prompt (the whole point: no shared global fallback).
- Dispatch failure for one project is caught and does not abort the loop.

## Data Model

No schema changes. Reuses `local_tracker_project_setups` (`workflow_config`, `prompt_template`, `after_create_hook`, `validation_commands`, `scan_summary`) and the canonical `projects.tracker_kind`/`tracker_config`. The only required data step is the backfill (data, not schema).

## Testing Strategy

- **Unit (no network):**
  - `ProjectConfig.resolve/1`: merges **code defaults** (not a global file) under `workflow_config`; missing-key fallback to code defaults; per-kind tracker config; invalid config (no tracker identity / no prompt) returns an error/skip signal.
  - `Tracker.adapter/0`: returns `LocalFirstTracker` when `tracker_sync_enabled?` regardless of (now process-irrelevant) global kind.
  - `PromptBuilder`: per-project prompt; **no global fallback** — missing prompt surfaces as unresolved (skip), not a global prompt.
  - `Config`: zero-arg state getters return code defaults with no global workflow loaded.
- **Orchestrator integration:** seed ≥2 projects with distinct states/prompts; one poll cycle dispatches per-project with the right prompt/states; a project with an unresolvable assignee or invalid config is skipped; a raising project does not abort others.
- **Boot:** app starts with **no** `SYMPHONY_WORKFLOW`; auto-discovery creates missing project from a `WORKFLOW.<slug>.md`; never overwrites DB-owned config.
- **Non-regression:** existing suites stay green; `make all` clean (format, credo, coverage, dialyzer); `mix specs.check` for new/changed public `def`s.

## Migration / Rollout

1. Ensure `:symphony_elixir, :tracker` app config has `sync_enabled: true` for local-first multi-project mode (default in this model).
2. Run `mise exec -- mix symphony.workflows.backfill --dir .` once to seed `macro-markets` and `distributionmachine` setups (macro-markets already DB-owned → skipped; distributionmachine imported from `WORKFLOW.distributionmachine.md`).
3. `front` (no `WORKFLOW.front.md`) gets a setup via the UI or is skipped with a warning until configured.
4. Restart serve (no `WORKFLOW=` argument needed once the boot change lands; during transition, any github workflow keeps backward-compat).

## Out of Scope

- Approaches B (per-project `DynamicSupervisor`) and C (process/BEAM per project) — future fault-isolation upgrades.
- Per-project concurrency caps (single global pool stays).
- Rich code editor (CodeMirror/Monaco) for the prompt.
- Automatic two-way file↔DB export.

## Open Questions / Risks

- **Code-default state machine drift:** the code defaults must cover the board shape projects expect (Backlog/Todo/In Progress/Human Review/Rework/Merging/Done/Cancelled/Duplicate) or projects must declare states explicitly. Resolution: keep Config's existing default constants as the floor; projects override via `workflow_config`.
- **Backward compatibility during transition:** until the `dev/serve.exs`/`Tracker.adapter` changes land, a github global still works. The cutover should land `Tracker.adapter` decoupling + `tracker_sync_enabled? = true` together so multi-project does not depend on the global.
- **Other readers of `Config.tracker_kind`/`workflow_*`:** audit remaining call sites (e.g., `Tracker` seeds, sync engine) so none silently assume the global identity after the cutover.
- **`front` project:** has no workflow file and no setup; it will be skipped until configured — confirm that is acceptable vs. archiving it.
