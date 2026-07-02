# Magic Prompts — Editable Prompt Templates with Per-Prompt Model / Backend / Effort

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools (Elixir `mix`, tracker `npm`/`vitest`).

**Goal:** Mirror Jean's **Magic Prompts** — every repeatable AI workflow is backed by an **editable prompt template** with its own backend/model/effort controls (fast model for routine copy, strong reasoning for reviews). Symphony gets a first-class, listable **prompt template store** (built-in + user-authored), rendered with the same Solid engine the orchestrator already uses, and consumed by the Magic Commands palette (separate plan).

**Why (verified state):** `PromptBuilder.build_prompt/2` already renders the project's `config.prompt_template` through `Solid.render!` with an `issue` map (`prompt_builder.ex:18-50`), then appends hardcoded sections. There is exactly **one** template today (the project's `prompt_template`); nothing is user-editable or per-workflow. The generic `Settings` store (`settings.ex`) is `(group,name)→payload` with **fixed declared keys** — good for toggles, wrong for a growing collection of user records. So this plan adds a dedicated `prompt_templates` table + a `PromptTemplates` context that reuses the Solid renderer.

**Architecture:** A `prompt_templates` Ecto table (built-in seeded + user rows, global or project-scoped) → `PromptTemplates` context (CRUD + `render/2` via Solid, mirroring `PromptBuilder`'s Solid usage) → REST CRUD controller → a tracker **Prompt Templates** settings panel with a body editor + per-template agent/model/effort/mode pickers (reusing `AssistantComposer`'s `AgentMenu`/`ModelMenu`/`EffortMenu`). The Magic Commands plan consumes `render/2` + the per-template model/effort/mode via `dispatchIssueAgent` (Plan 2a already threads those).

**Tech Stack:** Elixir + Ecto migration + Solid, Phoenix controller, React 19 + shadcn/ui, vitest, ExUnit. Frontend data flows through the repo's established `useState`/`useEffect` + service hook pattern (e.g. `useAgentExecutions`, `useIssueComments`, with `useTrackerPolling` for refresh) — **this repo has no TanStack Query; do not introduce it.**

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/prompt_templates/template.ex` — Ecto schema + changeset.
- `elixir/lib/symphony_elixir/prompt_templates.ex` — context: list/get/create/update/delete/render + built-in seeding.
- `elixir/priv/repo/migrations/<ts>_create_prompt_templates.exs`
- `elixir/lib/symphony_elixir/prompt_templates/builtin.ex` — built-in template definitions (data).
- `elixir/lib/symphony_elixir_web/controllers/tracker/prompt_template_controller.ex`
- tests: `template_test.exs`, `prompt_templates_test.exs`, `prompt_template_controller_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir_web/router.ex` — CRUD routes (global + project-scoped).
- `elixir/lib/symphony_elixir/release_tasks.ex` (or seeds) — ensure built-ins are upserted on boot/migrate.

**Create (tracker):**
- `tracker/src/types/prompt-template.ts`
- `tracker/src/services/promptTemplates.ts`
- `tracker/src/hooks/usePromptTemplates.ts` (`useState`/`useEffect` + service; returns `{ templates, isLoading, error, refetch }`, mirroring `useAgentExecutions`)
- `tracker/src/components/settings/PromptTemplatesPanel.tsx`
- `tracker/src/components/settings/PromptTemplateEditor.tsx`
- tests for service + hook + panel + editor.

**Modify (tracker):**
- `tracker/src/pages/SettingsPage.tsx` (or `ProjectSettingsPage.tsx`) — mount the panel.
- locale files `en` + `pt-BR`.

---

## Task 1: prompt_templates schema + migration

**Files:** migration + `prompt_templates/template.ex` + test.

Columns: `slug` (unique), `name`, `description`, `category`, `body` (Solid template text), `agent_kind` (nullable = any), `model` (nullable), `effort` (nullable), `mode` (nullable: plan/build/yolo), `scope` (`"global"` or a project slug), `built_in` (bool), `enabled` (bool, default true), `position` (int), timestamps.

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreatePromptTemplates do
  use Ecto.Migration

  def change do
    create table(:prompt_templates) do
      add :slug, :string, null: false
      add :name, :string, null: false
      add :description, :string
      add :category, :string
      add :body, :text, null: false
      add :agent_kind, :string
      add :model, :string
      add :effort, :string
      add :mode, :string
      add :scope, :string, null: false, default: "global"
      add :built_in, :boolean, null: false, default: false
      add :enabled, :boolean, null: false, default: true
      add :position, :integer, null: false, default: 0
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:prompt_templates, [:scope, :slug])
  end
end
```

- [ ] **Step 2: Write failing schema test** — `changeset/2` requires `slug/name/body`; validates `mode` inclusion (`~w(plan build yolo)` or nil) via `ExecutionMode` (from Plan 2a; if 2a not merged, inline the list); rejects blank slug; `unique_constraint([:scope, :slug])`.

- [ ] **Step 3: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/prompt_templates/template_test.exs -o`

- [ ] **Step 4: Implement** schema + changeset (mirror `local_tracker/issue_record.ex` style).

- [ ] **Step 5: Migrate + run (expect pass)** — `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/prompt_templates/template_test.exs -o`

- [ ] **Step 6: Commit** — `feat(prompts): prompt_templates schema`.

---

## Task 2: Built-in template definitions (the "magic commands")

**Files:** Create `prompt_templates/builtin.ex` + test.

Seed the built-ins that mirror Jean's Magic Commands (these become the palette defaults in the Magic Commands plan). Each has a Solid body using `{{ issue.identifier }}`, `{{ issue.title }}`, etc.

- [ ] **Step 1: Write failing test** — `Builtin.all()` returns a list with at least: `investigate-issue`, `code-review`, `commit-message`, `pr-description`, `release-notes`, `resolve-conflicts`; every entry has `slug/name/category/body` and `built_in: true`; each `body` parses under `Solid.parse!/1`.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `@templates` list of maps. Example entries:

```elixir
%{slug: "code-review", name: "AI Code Review", category: "review",
  effort: "high",
  body: """
  Review the changes for issue {{ issue.identifier }} — {{ issue.title }}.
  Run the project's review checklist, list findings grouped by severity
  (blocker / major / minor / nit) with file:line, and propose concrete fixes.
  Do not modify code in this turn unless explicitly asked.
  """},
%{slug: "commit-message", name: "Generate commit message", category: "git",
  effort: "low",
  body: "Draft a concise conventional-commit message for the staged/working changes in this workspace. Output only the message."},
# ... pr-description, release-notes, resolve-conflicts, investigate-issue
```

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(prompts): built-in magic-prompt definitions`.

---

## Task 3: PromptTemplates context (CRUD + render + seed)

**Files:** Create `prompt_templates.ex` + test.

- [ ] **Step 1: Write failing test**

```elixir
test "ensure_builtins/0 upserts built-ins idempotently" do
  PromptTemplates.ensure_builtins()
  count = length(PromptTemplates.list(scope: "global"))
  PromptTemplates.ensure_builtins()
  assert length(PromptTemplates.list(scope: "global")) == count
end

test "render/2 fills issue vars" do
  {:ok, tpl} = PromptTemplates.create(%{slug: "t", name: "T", body: "Fix {{ issue.identifier }}", scope: "global"})
  assert PromptTemplates.render(tpl, %{issue: %{identifier: "DEMO-1"}}) == "Fix DEMO-1"
end

test "list returns global + project scope merged, user overrides built-in slug" do
  # project-scoped row with same slug shadows global built-in
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/prompt_templates_test.exs -o`

- [ ] **Step 3: Implement**
- `list/1` (`scope:` filter; merges `global` + project, project shadows global by slug).
- `get/1`, `create/1`, `update/2`, `delete/1` (block deleting `built_in`; allow disabling).
- `render/2` — reuse `PromptBuilder`'s Solid approach: `Solid.parse!` + `Solid.render!` with a `to_solid_map`-normalized context (extract the shared normalization from `prompt_builder.ex:453-464` into a small shared module `SymphonyElixir.SolidContext`, or duplicate minimally).
- `ensure_builtins/0` — upsert each `Builtin.all()` row (`on_conflict` by `[:scope, :slug]`, only overwriting `built_in` fields, never user edits to non-built-in copies).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Wire seeding** — call `PromptTemplates.ensure_builtins()` from the app boot/migrate path (where other seeds run). Add a test or manual check.

- [ ] **Step 6: Commit** — `feat(prompts): PromptTemplates context + Solid render + seeding`.

---

## Task 4: REST CRUD controller + routes

**Files:** Create `prompt_template_controller.ex`, routes, + controller test.

- [ ] **Step 1: Write failing test** — `GET /prompt-templates` lists global built-ins; `GET /projects/:slug/prompt-templates` merges project + global; `POST` creates; `PUT` edits; `DELETE` of a built-in → 422; `DELETE` of a user template → 200.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** controller (`index/create/update/delete`) presenting templates (snake→camel via `TrackerPresenter` or a local presenter); routes both global (settings) and project-scoped.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(prompts): prompt-template CRUD endpoints`.

---

## Task 5: Tracker types + service

**Files:** `types/prompt-template.ts`, `services/promptTemplates.ts` + test.

- [ ] **Step 1: Write failing test** — `listPromptTemplates(slug?)`, `createPromptTemplate`, `updatePromptTemplate`, `deletePromptTemplate` map DTOs (snake→camel) and hit the right routes (mirror `services/issues.ts`).

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/services/__tests__/promptTemplates.test.ts`

- [ ] **Step 3: Implement** types (`PromptTemplate { slug, name, description, category, body, agentKind, model, effort, mode, scope, builtIn, enabled }`) + service.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(prompts): tracker prompt-template service + types`.

---

## Task 6: PromptTemplatesPanel + editor UI

**Files:** `PromptTemplatesPanel.tsx`, `PromptTemplateEditor.tsx` + tests; mount in settings; locales.

- [ ] **Step 1: Write failing panel test** — lists templates grouped by category; "New" opens the editor; built-in rows show a badge + disabled delete + an "enabled" toggle; editing a built-in creates/edits an override note.

- [ ] **Step 2: Write failing editor test** — renders name/description/category/body fields + agent/model/effort/mode pickers (reuse `AssistantComposer`'s `AgentMenu`/`ModelMenu`/`EffortMenu` and Plan 2a's `ExecutionModeMenu`); save calls `create`/`update`; a live "preview" area shows the body with sample issue vars substituted.

- [ ] **Step 3: Run (expect fail).**

- [ ] **Step 4: Implement**
- `PromptTemplateEditor` — form + pickers + a textarea for the Solid body + a small preview (client-side token substitution against a sample issue, or call a backend `POST /prompt-templates/preview`).
- `usePromptTemplates(projectSlug?)` — `useState`/`useEffect` load via the `promptTemplates` service (mirror `useAgentExecutions`: `{ templates, isLoading, error, refetch }`); no query cache.
- `PromptTemplatesPanel` — consume `usePromptTemplates`, render grouped sections, create/edit/delete with confirm (reuse the `Dialog` pattern), and call `refetch()` after each successful create/update/delete.
- Mount in `SettingsPage.tsx` (global) and optionally `ProjectSettingsPage.tsx` (project-scoped). i18n keys under `settings.prompts.*`.

- [ ] **Step 5: Run (expect pass).**

- [ ] **Step 6: Commit** — `feat(prompts): Prompt Templates settings panel + editor`.

---

## Task 7: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — document the prompt-template store, the Solid variable surface (`issue.*`), and per-template model/effort/mode in `elixir/README.md` / `../SPEC.md`.
- [ ] **Step 4: Commit** — `docs(prompts): document Magic Prompts templates`.

---

## Self-Review (spec coverage)

| Requirement (Jean Magic Prompts) | Task(s) |
| --- | --- |
| Editable prompt template per workflow | 1, 3, 6 |
| Per-prompt backend/model/effort controls | 1, 5, 6 (consumed via Plan 2a dispatch) |
| Built-in workflows (review/commit/PR/release/conflict/investigate) | 2, 3 |
| Stable UI, change how the AI thinks | 6 |

**Notes / decisions:**
- Dedicated table (not the `Settings` KV store) because templates are a growing, listable, user-authored collection — the KV store's fixed-key model doesn't fit.
- Rendering reuses the orchestrator's Solid engine so template authors get the exact variable surface (`issue.*`) the real prompts use.
- This plan is the **data + authoring** half; the **Magic Commands palette** (running a template against an issue) is `2026-06-27-magic-commands-palette-plan.md` and depends on Plan 2a for threading the per-template model/effort/mode through dispatch.
