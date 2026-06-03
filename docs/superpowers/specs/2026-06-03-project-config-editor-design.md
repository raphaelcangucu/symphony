# Project Configuration Editor — Design

Date: 2026-06-03
Status: Proposed (awaiting spec review)
Topic: Expose the full per-project `workflow_config` for editing in the project edit/create screens.

## Problem

After the global-less per-project orchestration work, every project owns its
configuration in the DB (`project_setups.workflow_config` plus
`prompt_template`, `after_create_hook`, `validation_commands`). The orchestrator
resolves states, agent limits, hooks, workspace, etc. **per project** from this
config, with no global fallback.

The UI has not caught up:

- The edit screen (`/tracker/projects/:slug/edit`) only edits name, description,
  tracker source, and prompt template. The `workflowConfig` is an opaque
  `Record<string, unknown>` that is never surfaced.
- The create wizard (`/tracker/projects/new`) only auto-suggests config (scratch
  path) or copies it from a template; the user cannot review or edit the
  resolved config before/after creation.

Result: the only way to fully configure a project today is to hand-edit a
`WORKFLOW.<slug>.md` file and re-run backfill. The goal is to make a project
**100% self-configurable from the UI**, removing the need for those files.

## Goals

- Edit every **per-project** `workflow_config` section from the UI.
- One reusable config editor shared by the edit screen and the create flow.
- Keep create lean; the editor is the single source of configuration.
- Reuse the existing, already-validated persistence endpoint.

## Non-goals (process-level, out of scope)

These sections are process/instance level (env/`config.exs`, unique per running
instance) and are intentionally **not** exposed in the per-project UI:

- `server` (`port`, `host`)
- `observability` (`hub_url`, `runtime_id`, `dashboard_enabled`, refresh/heartbeat intervals, `label`)
- `polling` (`interval_ms`)

## Scope: sections to expose

From `@workflow_options_schema` in `elixir/lib/symphony_elixir/config.ex`:

| Section | Fields exposed |
| --- | --- |
| `tracker` | `active_states`, `dispatch_states`, `wait_states`, `terminal_states`, `field_states` |
| `agent` | `max_turns`, `max_concurrent_agents`, `max_retry_backoff_ms`, `max_concurrent_agents_by_state` (map state→int), `completion_transitions` (map state→state), `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms` |
| `hooks` | `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms` |
| `workspace` | `root` |
| `editor` | `enabled`, `binary`, `host`, `port`, `auth` (`none`/`password`), `password`, `base_url` |
| `dev_server` | `enabled`, `port_range`, `max_concurrent`, `idle_timeout_ms`, `auto_start_on` (`pull_request`/`human_review`), `base_url` |
| `public_tunnel` | `enabled`, `base_domain`, `namespace` |
| `github` | `read_interval_ms`, `mutation_interval_ms`, `max_retries`, `max_backoff_ms` |

Plus the non-`workflow_config` setup fields: `prompt_template`,
`validation_commands`, `after_create_hook`. And core project fields: `name`,
`description`, tracker source (`kind` + remote config).

## Architecture

### Route and navigation

- New dedicated page route: `/tracker/projects/:slug/settings` — full page with
  tabs (chosen layout: dedicated tabbed page).
- Existing "edit" entry points (project list, board header) navigate to this
  page. The legacy `EditProjectDialog` (prompt-only dialog) is retired; its
  prompt editing moves into the **General** tab.
- The create wizard stays lean and, on success, **redirects** to
  `/tracker/projects/:slug/settings` with the config pre-filled (from template
  or from scan suggestion). No second config editor is embedded in the wizard.

### Tabs (one per section)

1. **General** — `name`, `description`, `prompt_template`, `validation_commands`
2. **Tracker source** — `kind` + remote config; reuses `TrackerSourcePicker`,
   `GitHubProjectPicker`, `LinearProjectPicker`
3. **States** — `active`/`dispatch`/`wait`/`terminal`/`field` multiselects, fed
   by the project's workflow statuses (`GET /projects/:id` → `statuses`)
4. **Agent** — numeric inputs + `max_concurrent_agents_by_state` (state→int) and
   `completion_transitions` (state→state) key-value editors
5. **Hooks** — four hook script textareas + `timeout_ms`
6. **Workspace** — `root`
7. **Editor & Dev** — `editor`, `dev_server`, `public_tunnel` grouped
8. **GitHub** — rate-limit numeric inputs

### Components (frontend, `tracker/src`)

- `components/projects/ProjectConfigEditor.tsx` — receives `project`, `statuses`,
  `setup`; holds typed form state; renders the tabbed sections; performs save.
  Reused by the settings page and as the redirect target of create.
- `pages/ProjectSettingsPage.tsx` (or `ProjectSettingsRoute`) — loads project +
  setup via the existing `getProject`/show endpoint and mounts
  `ProjectConfigEditor`.
- Reusable subcomponents:
  - `StateMultiSelect` — choose a subset of the project's statuses.
  - `KeyValueMapEditor` — edit `completion_transitions` and
    `max_concurrent_agents_by_state` (both keyed by state).
  - `HookEditor` — script textarea with monospace styling.
- Routing: register `/tracker/projects/:slug/settings` in the existing router;
  point edit entry points at it.

### Backend

No new endpoints. Reuse:

- `GET /projects/:id` (`ProjectController.show/2`) — already returns `statuses`,
  `repositories`, and `setup` (with `workflow_config`).
- `PUT /projects/:id` (`ProjectController.update/2`) — name/description/tracker.
- `PUT /projects/:id/setup` (`ProjectController.update_setup/2`) — persists
  `workflow_config` + `prompt_template` + `after_create_hook` +
  `validation_commands`, with **strict** validation via
  `Config.validate_workflow_config/1` (rejects type-mismatched values at the API
  boundary).

### Data flow

- **Load:** settings page issues `GET /projects/:id`; maps `setup.workflowConfig`
  into typed form state.
- **Save:** a single "Save" button dispatches, based on what changed:
  - `PUT /projects/:id` for name/description/tracker
  - `PUT /projects/:id/setup` for `workflow_config` + prompt + hooks +
    validation commands
  Both run sequentially; the response (which already includes refreshed `setup`)
  refreshes form state. If only one group changed, only that call fires.

### Types

Extend `tracker/src/types/project-setup.ts`:

- Replace `workflowConfig?: Record<string, unknown>` with a typed `WorkflowConfig`
  interface whose keys mirror the backend **snake_case** schema keys exactly
  (`active_states`, `completion_transitions`, `dev_server`, etc.). This is
  lossless and avoids fragile camel↔snake mapping for nested config. The
  existing `mappers.ts` already handles top-level camelCase mapping for
  `workflowConfig`/`promptTemplate`/`validationCommands`; the nested
  `workflow_config` body stays snake_case as the API emits/accepts it.

## Validation and error handling

- **Client (advisory, fail-fast):**
  - State lists must be a subset of the project's known statuses.
  - `completion_transitions` keys and values must be valid states.
  - `max_concurrent_agents_by_state` keys must be valid states; values ≥ 1.
  - Numeric fields enforce their schema bounds (e.g. positive integers).
  - Invalid input disables Save and shows an inline message on the offending
    field/tab.
- **Server (authoritative):** `Config.validate_workflow_config/1` rejects
  malformed configs; the API returns `invalid workflow_config: <issues>`. The
  editor surfaces this message inline (mapped to the relevant tab when the issue
  string identifies a section, otherwise shown at the form level).

## Testing

- **Vitest (frontend):**
  - `ProjectConfigEditor`: renders all sections from a given `setup`; editing a
    field updates state; Save calls `updateProject` and/or `updateProjectSetup`
    with the expected payloads; backend validation error renders inline.
  - `StateMultiSelect`: only offers project statuses; enforces subset.
  - `KeyValueMapEditor`: add/remove/edit entries; rejects unknown states.
  - Service/mapper round-trip: typed `workflowConfig` (snake_case) serializes and
    deserializes without loss.
- **Backend (Elixir):**
  - `show` returns `setup` — already covered.
  - `update_setup` accepts a fully-populated structured `workflow_config`
    (all in-scope sections) and persists it; add a case if not already covered.
  - `validate_workflow_config` rejects type-mismatched values — already covered.

## Risks and mitigations

- **Tracker source change post-create:** editing tracker `kind` on an existing
  project may be unsafe. Mitigation: keep the same behavior as the current edit
  screen (do not expand tracker mutability in this work); if the current screen
  forbids it, the settings page forbids it too.
- **Schema drift:** the typed `WorkflowConfig` interface duplicates the Elixir
  schema. Mitigation: snake_case mirroring keeps it 1:1; backend validation
  remains authoritative so a stale type cannot persist an invalid config.
- **Large form:** eight tabs with many fields. Mitigation: tabs (chosen layout)
  keep each section focused; the page is dedicated (not a cramped dialog/sheet).

## Out of scope / future

- Promoting `editor`/`dev_server`/`public_tunnel`/`github` to richer widgets
  beyond plain typed inputs (already structured here, but no advanced UX).
- Editing process-level (`server`/`observability`/`polling`) config.
- Diffing UI-edited config against an imported `WORKFLOW.<slug>.md`.
