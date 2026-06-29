# Execution Control 2a — Model / Thinking / Execution-Mode Picker + Dispatch Wiring

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer a fresh subagent per task with review between tasks. Replace example commands with this repo's real tools (Elixir `mix`, tracker `npm`/`vitest`).

**Goal:** Make the model + reasoning-effort the operator picks in the execution composer actually drive the orchestrator run (today they are silently dropped), and add Jean's **Plan / Build / Yolo** execution mode (with icons + `Shift+Tab` to cycle) wired end-to-end into per-agent execution policy. Upgrade the model picker to a fast searchable list with thinking/effort icons.

**The core gap (verified):** `ExecutionControlComposer.runDispatch` posts only `{ action, agent, goal, instructions }` (`ExecutionControlComposer.tsx:171-176`). `issueDispatch.ts:38-42` and `dispatch_opts/1` (`issue_controller.ex:365-372`) carry no model/effort/mode. The orchestrator (`AgentRunner.run/3`) resolves model/effort from the **project config** (`maybe_put_codex_config`, `agent_runner.ex:951-957`), never from the operator's selection. So selecting GPT‑5.5 / xhigh in the composer changes only the **assistant chat turn** (`payload.ex:55-59`), not the autonomous run. This plan closes that loop.

**Architecture:** A new pure `ExecutionMode` module maps `:plan|:build|:yolo` → per-adapter knobs (Codex sandbox/approval, Claude `permission_mode`, Cursor `--force`, OpenCode `--agent`). A new `issue_agent_settings` table persists the operator's per-issue `agent_kind/model/effort/mode` (works across all trackers, independent of whether a local issue row exists), written at dispatch and read by `AgentRunner` when building run opts. Frontend forwards model/effort on dispatch and gains an `ExecutionModeMenu` + a richer `ModelMenu`.

**Tech Stack:** Elixir + Ecto migration, Phoenix controller, React 19 + TanStack Query + shadcn/ui + lucide icons, vitest, ExUnit.

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/execution_mode.ex` — pure mode→policy mapping + validation.
- `elixir/lib/symphony_elixir/local_tracker/issue_agent_settings.ex` — Ecto schema for per-issue overrides.
- `elixir/priv/repo/migrations/<ts>_create_issue_agent_settings.exs`
- tests: `execution_mode_test.exs`, `issue_agent_settings_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir/local_tracker/context.ex` — `get_agent_settings/2` + `put_agent_settings/3`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex:365-372` — `dispatch_opts/1` accepts `model/effort/mode`.
- `elixir/lib/symphony_elixir/issue_dispatch.ex` — persist overrides (extend `opts` type + `dispatch/4`).
- `elixir/lib/symphony_elixir/agent_runner.ex:49-57` + `214-235` — load overrides → run opts → session opts.
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` — apply mode to sandbox/approval.
- `elixir/lib/symphony_elixir/claude/coding_agent.ex` — apply mode to `permission_mode`.
- `elixir/lib/symphony_elixir/cursor/coding_agent.ex` — apply mode to `--force`.

**Create (tracker):**
- `tracker/src/components/issues/issue-detail/ExecutionModeMenu.tsx`
- `tracker/src/lib/executionMode.ts` — `EXECUTION_MODES` (id, icon, label key, per-agent availability) + cycle helper.
- tests: `ExecutionModeMenu.test.tsx`, `executionMode.test.ts`.

**Modify (tracker):**
- `tracker/src/services/issueDispatch.ts:10-16,38-42` — add `model/effort/mode` to input + payload.
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — capture composer settings via new callback, render `ExecutionModeMenu`, forward on dispatch, `Shift+Tab` to cycle mode.
- `tracker/src/components/assistant/AssistantComposer.tsx:107-116,438-444` — add `onSettingsChange` reporting `{agent, settings}`; expose mode slot.
- `tracker/src/components/assistant/ModelMenu.tsx` — thinking/effort icon support (small), keep search.
- `tracker/src/types/issue.ts` — `ExecutionMode = "plan" | "build" | "yolo"`.
- locale files `en` + `pt-BR`.

---

## Task 1: ExecutionMode mapping module (pure, backend)

**Files:** Create `elixir/lib/symphony_elixir/execution_mode.ex` + `elixir/test/symphony_elixir/execution_mode_test.exs`.

Non-interactive orchestrator runs auto-approve, so **mode primarily varies the sandbox/permission ceiling**, not human approval. Mapping:

| mode | codex sandbox / approval | claude permission_mode | cursor | opencode |
| --- | --- | --- | --- | --- |
| plan | `read-only` / `never` | `plan` | (no plan flag → falls back to build + note) | `--agent plan` |
| build | `workspace-write` / `never` | `acceptEdits` | (default, no `--force`) | `--agent build` |
| yolo | `danger-full-access` / `never` | `bypassPermissions` | `--force` | `--agent build` + full perms |

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixir.ExecutionModeTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.ExecutionMode

  test "valid?/1" do
    assert ExecutionMode.valid?("plan")
    assert ExecutionMode.valid?("build")
    assert ExecutionMode.valid?("yolo")
    refute ExecutionMode.valid?("turbo")
  end

  test "default is build" do
    assert ExecutionMode.default() == "build"
  end

  test "codex policy escalates with mode" do
    assert ExecutionMode.codex_policy("plan").sandbox == "read-only"
    assert ExecutionMode.codex_policy("build").sandbox == "workspace-write"
    assert ExecutionMode.codex_policy("yolo").sandbox == "danger-full-access"
  end

  test "claude permission_mode mapping" do
    assert ExecutionMode.claude_permission_mode("plan") == "plan"
    assert ExecutionMode.claude_permission_mode("yolo") == "bypassPermissions"
  end

  test "cursor force only on yolo" do
    refute ExecutionMode.cursor_force?("build")
    assert ExecutionMode.cursor_force?("yolo")
  end

  test "modes available per agent" do
    assert "plan" in ExecutionMode.available_for("codex")
    refute "plan" in ExecutionMode.available_for("cursor")
  end
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/execution_mode_test.exs -o`

- [ ] **Step 3: Implement** — pure module with `@modes ~w(plan build yolo)`, `default/0` → `"build"`, `valid?/1`, `codex_policy/1` (`%{sandbox: ..., approval_policy: "never"}`), `claude_permission_mode/1`, `cursor_force?/1`, `opencode_agent/1`, and `available_for/1` (cursor excludes `"plan"` since `cursor-agent` has no read-only mode; note inline). Unknown mode falls back to `default()`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): add ExecutionMode policy mapping`.

---

## Task 2: issue_agent_settings table + schema (backend)

**Files:** migration + `elixir/lib/symphony_elixir/local_tracker/issue_agent_settings.ex` + test.

Keyed by `project_slug` + `identifier` (strings) so it covers GitHub/Jira/local issues uniformly. Columns: `agent_kind`, `model`, `effort`, `mode`, timestamps. Unique on `[project_slug, identifier]`.

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateIssueAgentSettings do
  use Ecto.Migration

  def change do
    create table(:local_tracker_issue_agent_settings) do
      add :project_slug, :string, null: false
      add :identifier, :string, null: false
      add :agent_kind, :string
      add :model, :string
      add :effort, :string
      add :mode, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:local_tracker_issue_agent_settings, [:project_slug, :identifier])
  end
end
```

- [ ] **Step 2: Write failing schema test** — `changeset/2` requires `project_slug`+`identifier`, validates `mode` inclusion via `ExecutionMode.valid?/1`, casts the rest.

- [ ] **Step 3: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/local_tracker/issue_agent_settings_test.exs -o`

- [ ] **Step 4: Implement** schema + changeset (mirror `issue_record.ex` style; `validate_inclusion(:mode, ~w(plan build yolo))`, `unique_constraint([:project_slug, :identifier])`).

- [ ] **Step 5: Migrate + run (expect pass)** — `cd elixir && mix ecto.migrate && mix test test/symphony_elixir/local_tracker/issue_agent_settings_test.exs -o`

- [ ] **Step 6: Commit** — `feat(exec): persist per-issue agent settings`.

---

## Task 3: Context accessors for agent settings (backend)

**Files:** Modify `elixir/lib/symphony_elixir/local_tracker/context.ex` + test.

- [ ] **Step 1: Write failing test**

```elixir
test "put_agent_settings then get_agent_settings round-trips" do
  :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: "high", mode: "build", agent_kind: "codex"})
  assert {:ok, s} = Context.get_agent_settings("demo", "DEMO-1")
  assert s.model == "gpt-5.5" and s.effort == "high" and s.mode == "build"
end

test "get_agent_settings returns :not_found when absent" do
  assert Context.get_agent_settings("demo", "MISSING") == {:error, :not_found}
end
```

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `put_agent_settings/3` upserts via the unique index (`Repo.insert/2` with `on_conflict: {:replace, [...]}, conflict_target: [:project_slug, :identifier]`); `get_agent_settings/2` returns `{:ok, struct}` or `{:error, :not_found}`. Nil-valued keys are not persisted as empty strings (drop nils before cast).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): Context agent-settings accessors`.

---

## Task 4: Dispatch endpoint + IssueDispatch persist overrides (backend)

**Files:** Modify `issue_controller.ex:365-372`, `issue_dispatch.ex` (opts type + `dispatch/4`), + tests.

- [ ] **Step 1: Write failing controller test** — POST `/dispatch` with `%{"action" => "resume", "agent" => "codex", "model" => "gpt-5.4", "effort" => "high", "mode" => "plan"}` then assert `Context.get_agent_settings(slug, id)` returns those values.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- `dispatch_opts/1` (`issue_controller.ex:365-372`): add `model:`, `effort:`, `mode:` from params.
- `IssueDispatch` `@type opts` (`issue_dispatch.ex:22-27`): add `optional(:model|:effort|:mode)`.
- In `dispatch/4` (after `maybe_update_agent`), add `maybe_persist_agent_settings/4` that calls `Context.put_agent_settings(project.slug, identifier, %{agent_kind: agent_kind, model: ..., effort: ..., mode: validated_mode})`, validating mode via `ExecutionMode.valid?/1` (invalid → `ExecutionMode.default()`), and skipping keys that are nil/blank. Best-effort (a failure logs + continues, like `maybe_persist_goal_thread`).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): accept + persist model/effort/mode on dispatch`.

---

## Task 5: AgentRunner threads overrides into the run (backend)

**Files:** Modify `agent_runner.ex` (`run/3` opts build `49-57`; `run_codex_turns` session opts `229-235`) + test.

- [ ] **Step 1: Write failing test** — with `Context.put_agent_settings` seeded for an issue, assert that `AgentRunner` injects `:model`, `:effort`, and the mode-derived policy into the opts/session_opts passed to a stubbed `CodingAgent`. Use the existing test seams (inject a fake `CodingAgent` or assert via `session_opts` builder extracted as a public `@doc false` function).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- In `run/3` (`agent_runner.ex:49-57`), after resolving `agent_kind`, load overrides: `Keyword.merge(opts, agent_settings_opts(issue))` where `agent_settings_opts/1` reads `Context.get_agent_settings(issue.project_slug, issue.identifier)` and returns `[model: ..., effort: ..., execution_mode: ...]` (only present keys; operator opts win over project defaults but explicit caller `opts` still win over both — use `Keyword.put_new`).
- Add `maybe_put_execution_mode/3` to the `session_opts` pipeline (`agent_runner.ex:229-235`) that sets `:execution_mode` (string) for all agent kinds, defaulting via `ExecutionMode.default()`.
- Keep `:model`/`:effort` flowing through `agent_turn_opts` (they already pass through `opts` to `run_turn`); verify codex `start_turn` reads `:effort` (`codex/coding_agent.ex:891`) and add `:model` handling where the catalog default is currently used.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): thread operator model/effort/mode into orchestrator run`.

---

## Task 6: Per-adapter execution-mode application (backend)

**Files:** Modify `codex/coding_agent.ex`, `claude/coding_agent.ex`, `cursor/coding_agent.ex` + each adapter test.

- [ ] **Step 1: Write failing tests (one per adapter)**
- Codex: `start_session` with `execution_mode: "plan"` → resulting session `thread_sandbox == "read-only"` (overrides config sandbox); `"yolo"` → `"danger-full-access"`.
- Claude: session opts with `execution_mode: "plan"` → `permission_mode == "plan"` (replaces the hardcoded value).
- Cursor: `build_args` with `execution_mode: "yolo"` includes `--force`; `"build"` does not.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- Codex: where `session_policies`/`thread_sandbox` are resolved (`codex/coding_agent.ex:64,75-78,594-600`), if `opts[:execution_mode]` present, override `sandbox` with `ExecutionMode.codex_policy(mode).sandbox`. Approval stays config-driven (non-interactive) unless mode is `yolo` (then `never`).
- Claude: replace the hardcoded `permission_mode` with `ExecutionMode.claude_permission_mode(opts[:execution_mode] || ExecutionMode.default())`.
- Cursor: in `build_args`, append `--force` when `ExecutionMode.cursor_force?(mode)`; for `"plan"`, log a one-time note that cursor has no read-only mode and treat as `build`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): apply Plan/Build/Yolo policy per agent adapter`.

---

## Task 7: Frontend — forward model/effort on dispatch (close the drop)

**Files:** Modify `issueDispatch.ts`, `types/issue.ts`, `AssistantComposer.tsx`, `ExecutionControlComposer.tsx` + tests.

- [ ] **Step 1: Write failing test** — extend `ExecutionControlComposer.test.tsx`: pick a non-default model in the composer, click resume, assert `dispatchIssueAgent` mock received `model` + `effort` (+ `mode`).

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx`

- [ ] **Step 3: Implement**
- `types/issue.ts`: `export type ExecutionMode = "plan" | "build" | "yolo";`
- `issueDispatch.ts`: add `model?`, `effort?`, `mode?` to `IssueDispatchInput` (`:10-16`) and `payload` (`:38-42`, guarded `if (input.model) ...`).
- `AssistantComposer.tsx`: add prop `onSettingsChange?: (agent: AgentKind, settings: AssistantComposerSettings) => void`; fire it in the same effect as `onAgentChange` (`:177-180`) and inside `updateModel`/`updateEffort`. (Keeps the composer the single source of truth for model/effort.)
- `ExecutionControlComposer.tsx`: track `const [settings, setSettings] = useState<AssistantComposerSettings | null>(null)`, pass `onSettingsChange={(a, s) => { setAgent(a); setSettings(s); }}`, and in `runDispatch` (`:171-176`) pass `model: settings?.model ?? null`, `effort: settings?.effort ?? null`, `mode`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): forward model + effort from composer to dispatch`.

---

## Task 8: Frontend — Plan/Build/Yolo ExecutionModeMenu (icons + Shift+Tab)

**Files:** Create `executionMode.ts` + `ExecutionModeMenu.tsx` + tests; wire into `ExecutionControlComposer.tsx`.

- [ ] **Step 1: Write failing tests**
- `executionMode.test.ts`: `cycleMode("plan", available)` → next available mode; wraps around; `EXECUTION_MODES` has an icon + labelKey per mode.
- `ExecutionModeMenu.test.tsx`: renders current mode label + icon; clicking an option calls `onChange`; modes unavailable for the agent are hidden/disabled.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- `executionMode.ts`: `EXECUTION_MODES: { id: ExecutionMode; labelKey: string; descKey: string; Icon }[]` (Plan = `Map`/`Compass`, Build = `Hammer`/`Wrench`, Yolo = `Zap`/`Rocket` from lucide). `availableModesFor(agent)` (cursor excludes `plan`), `cycleMode(current, available)`.
- `ExecutionModeMenu.tsx`: a `DropdownMenu` (mirror `EffortMenu` in `AssistantComposer.tsx:779-817`) trigger shows `<Icon/> {label}`; radio group over available modes with per-item icon + description.
- Wire into `ExecutionControlComposer.tsx`: add `const [mode, setMode] = useState<ExecutionMode>("build")`; render `<ExecutionModeMenu agent={agent} mode={mode} onChange={setMode} />` inside the composer `toolbarAfterAttach` slot (`:440-471`); add a `Shift+Tab` keydown handler on the composer container that calls `setMode((m) => cycleMode(m, availableModesFor(agent)))` (guard: only when focus is in this composer; do not steal the slash-palette `Tab` in `AssistantComposer.tsx:461-465`).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): Plan/Build/Yolo execution mode selector`.

---

## Task 9: Frontend — richer model picker (thinking/effort icons)

**Files:** Modify `ModelMenu.tsx` (search already exists), small effort-icon addition to `EffortMenu` in `AssistantComposer.tsx`.

The existing `ModelMenu.tsx` already does instant search across the agent's models. This task adds Jean-style **thinking/effort icons** and keeps the search.

- [ ] **Step 1: Write failing test** — extend `ModelMenu.test.tsx`: assert each effort option in `EffortMenu` renders an icon element (e.g. `data-testid="effort-icon-high"`); assert default-model star/marker renders.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**
- Add an `effortIcon(effortId)` helper (lucide: `low`→`Feather`, `medium`→`Gauge`, `high`→`Flame`, `xhigh`/`max`/`ultracode`→`Sparkles`) and render it next to each `EffortMenu` radio item + the trigger (`AssistantComposer.tsx:796-816`).
- In `ModelMenu.tsx` radio items (`:107-112`), render a small ★ marker for the catalog default model (`option.isDefault`). Keep the search input and `ScrollArea` unchanged.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(exec): thinking/effort icons + default marker in pickers`.

---

## Task 10: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Docs** — document the model/effort/mode dispatch params and the Plan/Build/Yolo → policy table in `elixir/README.md` (or the dispatch section of `../SPEC.md`).
- [ ] **Step 4: Commit** — `docs(exec): document execution-control model/effort/mode + modes`.

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| "todos os modelos … busca legal" (all models, nice search) | 7, 9 (search already exists; add icons/marker) |
| "modo de thinking com ícones" (thinking modes with icons) | 9 |
| "tipo de execução" (execution type → Plan/Build/Yolo) | 1, 6, 8 |
| Make the picked model/effort actually take effect | 4, 5, 7 (closes the verified drop) |

**Notes / decisions:**
- Persistence via a dedicated `issue_agent_settings` table (not issue columns) so overrides work across GitHub/Jira/local trackers and survive orchestrator retries.
- For autonomous orchestrator runs, mode varies the **sandbox/permission ceiling** (approval stays non-interactive except yolo→never), since there is no human to approve mid-run.
- "Favorites (★)" and a global "Fast (⚡ ⌘F)" toggle from Jean are deferred to a follow-up; this plan ships the high-value path (model/effort actually applied + execution mode + icons). The richer cross-backend cmdk picker with favorites is a natural extension of `ModelMenu.tsx` once this lands.
- `@`-mentions, `/`-commands, and the keyboard-shortcut registry are **Plan 2b** (`2026-06-26-execution-control-mentions-shortcuts-plan.md`).
