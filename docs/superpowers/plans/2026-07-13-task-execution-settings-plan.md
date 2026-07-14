# Per-task Execution Settings Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo’s real tools (Elixir `mix`, tracker `vitest`).
>
> **WSL:** Never run full/batch/directory-wide test suites. Run one narrowly targeted test file or filter at a time, sequentially. Ask before expanding scope. Include this restriction in every subagent prompt.

**Goal:** Let operators pin agent / model / reasoning effort on Create + Summary (and defaults in User + Project Settings) using the composer picker UX, with `issue_agent_settings` as source of truth for the orchestrator and `symphony:*` labels as mirror/fallback.

**Architecture:** Persist task pins in existing `issue_agent_settings` (support explicit `null` clear). Resolve independently: settings → label (agent only) → project → user → CLI. Extract `ExecutionSettingsPicker` from `ComposerToolbar` and wire Create, Summary, Settings, and Execution composer to the same store (shared SoT).

**Tech Stack:** Elixir/Ecto/Phoenix, React 19 + vitest, existing `ComposerToolbar`/`ModelMenu`/`assistantSettings` catalog.

**Spec:** `docs/superpowers/specs/2026-07-13-task-execution-settings-design.md`

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/execution_settings.ex` — pure resolve helpers (agent/model/effort chains)
- `elixir/lib/symphony_elixir/settings/agent_efforts.ex` — user default effort per agent (Settings group)
- `elixir/test/symphony_elixir/execution_settings_test.exs`
- `elixir/test/symphony_elixir/settings/agent_efforts_test.exs`

**Modify (backend):**
- `elixir/lib/symphony_elixir/local_tracker/context/agent_settings.ex` — omit vs explicit null
- `elixir/lib/symphony_elixir/agent_runner.ex` — settings-first agent + project/user model/effort fallbacks
- `elixir/lib/symphony_elixir/config/agent.ex` — parse `agent.model` / `agent.effort` from workflow FM
- `elixir/lib/symphony_elixir/project_config.ex` — add `:agent_model`, `:agent_effort`
- `elixir/lib/symphony_elixir/settings.ex` — register `agent_efforts` group
- `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` — create/update accept model/effort; write settings + mirror labels
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` — expose pinned agent/model/effort
- `elixir/lib/symphony_elixir/issue_dispatch.ex` — keep writing settings; ensure mirror path consistent
- Tests: `context_agent_settings_test.exs`, `agent_runner_agent_kind_test.exs`, `agent_runner_execution_opts_test.exs`, `issue_controller_test.exs`, `project_config_test.exs`, `settings_controller_test.exs`

**Create (tracker):**
- `tracker/src/components/assistant/ExecutionSettingsPicker.tsx`
- `tracker/src/components/assistant/__tests__/ExecutionSettingsPicker.test.tsx`
- `tracker/src/components/issues/inline/InlineExecutionSettingsEditor.tsx`
- `tracker/src/services/issueExecutionSettings.ts` (thin wrapper if PATCH stays on issues; otherwise dedicated)

**Modify (tracker):**
- `tracker/src/components/assistant/ComposerToolbar.tsx` — export menus or thin-wrap picker
- `tracker/src/components/assistant/AssistantComposer.tsx` — `settingsSeed`, optional disable sessionStorage persist for task SoT
- `tracker/src/components/issues/IssueCreateDialog.tsx`
- `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- `tracker/src/components/issues/IssueDrawer.tsx`
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- `tracker/src/pages/SettingsPage.tsx`
- `tracker/src/components/projects/ProjectAgentSelect.tsx` (+ `workflowFrontMatter.ts` for model/effort)
- `tracker/src/types/issue.ts`, `tracker/src/services/issues.ts`, `tracker/src/services/mappers/issue.ts`
- `tracker/src/services/settings.ts`
- `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

---

### Task 1: Allow explicit null clear in `put_agent_settings`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/context/agent_settings.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/context_agent_settings_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `context_agent_settings_test.exs`:

```elixir
test "put_agent_settings clears a field when attrs has explicit nil" do
  :ok =
    Context.put_agent_settings("demo", "DEMO-1", %{
      agent_kind: "codex",
      model: "gpt-5.5",
      effort: "high"
    })

  :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: nil})

  assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
  assert settings.agent_kind == "codex"
  assert settings.model == nil
  assert settings.effort == "high"
end

test "put_agent_settings preserves omitted keys" do
  :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: "high"})
  :ok = Context.put_agent_settings("demo", "DEMO-1", %{effort: "xhigh"})

  assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
  assert settings.model == "gpt-5.5"
  assert settings.effort == "xhigh"
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd elixir && mix test test/symphony_elixir/local_tracker/context_agent_settings_test.exs --only line:<new_test_line>
```

Expected: FAIL — current `clean_agent_settings/1` drops nils so `model` is not cleared.

- [ ] **Step 3: Implement omit vs explicit null**

Replace cleaning so:
- Key **absent** from attrs → do not include in upsert `set` (preserve).
- Key **present** with `nil` or blank string → write DB `NULL`.
- Key **present** with value → write value.

Use `Map.has_key?/2` (check both atom and string keys). Build `set` only from present keys (+ `updated_at`). Update `@moduledoc` to document this contract.

```elixir
defp clean_agent_settings(attrs) do
  Enum.reduce(@agent_settings_keys, %{}, fn key, acc ->
    cond do
      Map.has_key?(attrs, key) ->
        Map.put(acc, key, blank_to_nil(Map.get(attrs, key)))

      Map.has_key?(attrs, Atom.to_string(key)) ->
        Map.put(acc, key, blank_to_nil(Map.get(attrs, Atom.to_string(key))))

      true ->
        acc
    end
  end)
end
```

Ensure `on_conflict: [set: set]` still only sets cleaned keys (not untouched columns).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd elixir && mix test test/symphony_elixir/local_tracker/context_agent_settings_test.exs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/context/agent_settings.ex \
  elixir/test/symphony_elixir/local_tracker/context_agent_settings_test.exs
git commit -m "fix(agent-settings): allow explicit null to clear inherited fields"
```

---

### Task 2: Pure `ExecutionSettings` resolve module

**Files:**
- Create: `elixir/lib/symphony_elixir/execution_settings.ex`
- Create: `elixir/test/symphony_elixir/execution_settings_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.ExecutionSettingsTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.ExecutionSettings

  test "resolve_agent prefers settings over label over project over user over codex" do
    assert ExecutionSettings.resolve_agent(%{
             settings_agent: "cursor",
             label_agent: "codex",
             project_agent: "claude",
             user_agent: "opencode"
           }) == "cursor"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: "codex",
             project_agent: "claude",
             user_agent: "opencode"
           }) == "codex"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: "claude",
             user_agent: "opencode"
           }) == "claude"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: nil,
             user_agent: "opencode"
           }) == "opencode"

    assert ExecutionSettings.resolve_agent(%{
             settings_agent: nil,
             label_agent: nil,
             project_agent: nil,
             user_agent: nil
           }) == "codex"
  end

  test "resolve_model prefers settings over project over user over nil" do
    assert ExecutionSettings.resolve_model(%{
             settings_model: "a",
             project_model: "b",
             user_model: "c"
           }) == "a"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: "b",
             user_model: "c"
           }) == "b"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: nil,
             user_model: "c"
           }) == "c"

    assert ExecutionSettings.resolve_model(%{
             settings_model: nil,
             project_model: nil,
             user_model: nil
           }) == nil
  end

  test "resolve_effort mirrors model precedence" do
    assert ExecutionSettings.resolve_effort(%{
             settings_effort: "high",
             project_effort: "medium",
             user_effort: "low"
           }) == "high"

    assert ExecutionSettings.resolve_effort(%{
             settings_effort: nil,
             project_effort: nil,
             user_effort: "low"
           }) == "low"
  end
end
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd elixir && mix test test/symphony_elixir/execution_settings_test.exs
```

Expected: FAIL — module missing

- [ ] **Step 3: Implement module**

```elixir
defmodule SymphonyElixir.ExecutionSettings do
  @moduledoc """
  Pure precedence for per-task execution pins vs project/user defaults.
  """

  @spec resolve_agent(map()) :: String.t()
  def resolve_agent(layers) when is_map(layers) do
    first_present([
      layers[:settings_agent] || layers["settings_agent"],
      layers[:label_agent] || layers["label_agent"],
      layers[:project_agent] || layers["project_agent"],
      layers[:user_agent] || layers["user_agent"],
      "codex"
    ])
  end

  @spec resolve_model(map()) :: String.t() | nil
  def resolve_model(layers) when is_map(layers) do
    first_present([
      layers[:settings_model] || layers["settings_model"],
      layers[:project_model] || layers["project_model"],
      layers[:user_model] || layers["user_model"]
    ])
  end

  @spec resolve_effort(map()) :: String.t() | nil
  def resolve_effort(layers) when is_map(layers) do
    first_present([
      layers[:settings_effort] || layers["settings_effort"],
      layers[:project_effort] || layers["project_effort"],
      layers[:user_effort] || layers["user_effort"]
    ])
  end

  defp first_present(values) do
    Enum.find(values, fn
      nil -> false
      "" -> false
      _ -> true
    end)
  end
end
```

Normalize agent kinds with `AgentPreference.normalize/1` inside `resolve_agent` before returning.

- [ ] **Step 4: Run (expect pass)**

```bash
cd elixir && mix test test/symphony_elixir/execution_settings_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/execution_settings.ex \
  elixir/test/symphony_elixir/execution_settings_test.exs
git commit -m "feat(execution): add pure resolve helpers for agent/model/effort"
```

---

### Task 3: Project workflow `agent.model` / `agent.effort`

**Files:**
- Modify: `elixir/lib/symphony_elixir/config/agent.ex`
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Test: `elixir/test/symphony_elixir/project_config_test.exs` (or `config_agent_kind_test.exs`)
- Modify tracker: `tracker/src/lib/workflowFrontMatter.ts` (+ small unit test if one exists)

- [ ] **Step 1: Write failing Elixir test**

```elixir
test "resolves agent.model and agent.effort from workflow front matter" do
  {:ok, project} = Context.ensure_project(%{name: "M", slug: "model-proj"})

  {:ok, _} =
    Context.upsert_project_setup("model-proj", %{
      "workflow_markdown" => """
      ---
      agent:
        kind: claude
        model: claude-opus-4-5
        effort: high
      ---
      Prompt.
      """
    })

  config = project |> Repo.preload(:setup) |> ProjectConfig.resolve()
  assert config.agent_kind == "claude"
  assert config.agent_model == "claude-opus-4-5"
  assert config.agent_effort == "high"
end
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd elixir && mix test test/symphony_elixir/project_config_test.exs --only line:<line>
```

- [ ] **Step 3: Implement**

1. Add `agent_model_from_config/1` and `agent_effort_from_config/1` in `config/agent.ex` reading `agent.model` / `agent.effort` (string trim; blank → nil).
2. Add `:agent_model` and `:agent_effort` to `ProjectConfig` struct + `resolve/1` assignment.
3. Tracker: extend `workflowFrontMatter.ts` with `readAgentModel` / `writeAgentModel` / `readAgentEffort` / `writeAgentEffort` mirroring `readAgentKind`/`writeAgentKind` patterns under the `agent:` section.

- [ ] **Step 4: Run (expect pass)** — same targeted file.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(project): support agent.model and agent.effort in workflow front matter"
```

---

### Task 4: User default efforts settings group

**Files:**
- Create: `elixir/lib/symphony_elixir/settings/agent_efforts.ex`
- Modify: `elixir/lib/symphony_elixir/settings.ex` (register group)
- Create/modify tests: `elixir/test/symphony_elixir/settings_test.exs` or new `agent_efforts_test.exs`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/settings_controller_test.exs` if needed

- [ ] **Step 1: Write failing test**

Mirror `Settings.AgentModels` pattern: group `"agent_efforts"`, agents `codex/claude/cursor/opencode`, curated efforts per agent (reuse adapter effort lists or a small shared allowlist like `~w(low medium high xhigh max)`), `selected/1`, `cast/2` accepting nil.

```elixir
test "agent_efforts selected defaults to nil" do
  assert Settings.AgentEfforts.selected("codex") == nil
end

test "agent_efforts cast accepts known effort" do
  assert {:ok, "high"} = Settings.AgentEfforts.cast("codex", "high")
  assert :error = Settings.AgentEfforts.cast("codex", "nope")
end
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd elixir && mix test test/symphony_elixir/settings/agent_efforts_test.exs
```

- [ ] **Step 3: Implement + register in Settings groups list**

- [ ] **Step 4: Run (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(settings): add per-agent default reasoning effort group"
```

---

### Task 5: Wire AgentRunner resolve chains

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (`issue_agent_kind/1`, `agent_settings_opts/1`)
- Test: `elixir/test/symphony_elixir/agent_runner_agent_kind_test.exs`
- Test: `elixir/test/symphony_elixir/agent_runner_execution_opts_test.exs`

- [ ] **Step 1: Write failing tests**

In `agent_runner_agent_kind_test.exs`:

```elixir
test "settings.agent_kind beats label agent_kind" do
  :ok = Context.put_agent_settings("pref", "PREF-9", %{agent_kind: "cursor"})
  issue = %Issue{id: "9", identifier: "PREF-9", project_slug: "pref", agent_kind: "codex"}
  assert AgentRunner.issue_agent_kind(issue) == "cursor"
end

test "label agent is used when settings agent_kind is empty" do
  issue = %Issue{id: "10", identifier: "PREF-10", project_slug: "pref", agent_kind: "codex"}
  assert AgentRunner.issue_agent_kind(issue) == "codex"
end
```

In `agent_runner_execution_opts_test.exs`:

```elixir
test "agent_settings_opts falls back to project then user model/effort" do
  # Arrange project with agent.model/effort + user AgentModels/AgentEfforts
  # Persist no issue settings (or only mode)
  # Assert opts include project/user resolved model/effort
end

test "issue settings model beats project and user" do
  # put issue model, project+user different → issue wins
end
```

- [ ] **Step 2: Run (expect fail)** — one file at a time.

```bash
cd elixir && mix test test/symphony_elixir/agent_runner_agent_kind_test.exs
```

- [ ] **Step 3: Implement**

`issue_agent_kind/1`:

```elixir
def issue_agent_kind(%Issue{} = issue) do
  settings_agent = settings_agent_kind(issue)
  label_agent = AgentPreference.normalize(issue.agent_kind)

  ExecutionSettings.resolve_agent(%{
    settings_agent: settings_agent,
    label_agent: label_agent,
    project_agent: project_agent_kind(issue),
    user_agent: Settings.Agents.default_agent_kind()
  })
end
```

`settings_agent_kind/1` loads `Context.get_agent_settings/2` → `agent_kind` or nil.

`agent_settings_opts/1`: resolve effective agent first (for user model/effort keyed by agent), then:

```elixir
model =
  ExecutionSettings.resolve_model(%{
    settings_model: settings && settings.model,
    project_model: project && project.agent_model,
    user_model: Settings.AgentModels.selected(resolved_agent)
  })

effort =
  ExecutionSettings.resolve_effort(%{
    settings_effort: settings && settings.effort,
    project_effort: project && project.agent_effort,
    user_effort: Settings.AgentEfforts.selected(resolved_agent)
  })
```

Keep `execution_mode` from settings only (unchanged). Use `put_if_present` so nil omits CLI flags.

Update existing tests that assumed label-only precedence if any assertion flips.

- [ ] **Step 4: Run targeted tests (expect pass)** — agent_kind file, then execution_opts file.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-runner): resolve agent/model/effort from settings with fallbacks"
```

---

### Task 6: Issue create/update API + presenter + label mirror

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Optionally extract helper: `elixir/lib/symphony_elixir/local_tracker/agent_settings_writer.ex` (settings put + label sync)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`
- Test: `elixir/test/symphony_elixir_web/presenters/tracker_presenter_test.exs`

- [ ] **Step 1: Write failing controller tests**

```elixir
test "create issue accepts model and effort and persists agent settings" do
  # POST create with agent/model/effort
  # Assert get_agent_settings has values
  # Assert response JSON includes agent_kind/model/effort pins
end

test "patch issue clears model with explicit null" do
  # Seed settings, PATCH %{"model" => nil}
  # Assert settings.model is nil; agent/effort unchanged
end

test "patch agent writes settings and mirrors symphony label" do
  # PATCH agent cursor → settings.agent_kind cursor + label present
end
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs --only line:<line>
```

- [ ] **Step 3: Implement**

1. Extend `normalize_create_attrs` / `normalize_update_attrs` to accept `model`, `effort` (and keep `agent`).
2. After successful create/update, call writer:
   - `Context.put_agent_settings(slug, identifier, %{agent_kind, model, effort})` using omit/null semantics from request.
   - Mirror agent via existing `sync_agent_routing_label_result` / update path (settings write first; label best-effort).
3. Presenter: merge pinned fields from `get_agent_settings` onto issue JSON:
   - `agent_kind` for UI pin: prefer settings.agent_kind, else label (for display consistency with inherit).
   - Add `model`, `effort` (nullable).
4. Validation: reject unknown agent; for model/effort either accept opaque strings or validate via model catalogs when available — fail with 422 clear message.

JSON shape (snake_case as today):

```json
{
  "agent_kind": "codex",
  "model": "gpt-5.5",
  "effort": "high"
}
```

null means inherit.

- [ ] **Step 4: Run targeted tests (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(issues): persist and present per-issue agent/model/effort settings"
```

---

### Task 7: `ExecutionSettingsPicker` (shared UI)

**Files:**
- Create: `tracker/src/components/assistant/ExecutionSettingsPicker.tsx`
- Create: `tracker/src/components/assistant/__tests__/ExecutionSettingsPicker.test.tsx`
- Modify: `tracker/src/components/assistant/ComposerToolbar.tsx` (export AgentMenu/EffortMenu or move into picker and re-import)

- [ ] **Step 1: Write failing vitest**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionSettingsPicker } from "../ExecutionSettingsPicker";
import { fixtureBundle } from "./fixtures"; // reuse ModelMenu/Assistant fixtures or inline minimal bundle

it("calls onAgentChange(null) when inherit is selected", async () => {
  const onAgentChange = vi.fn();
  render(
    <ExecutionSettingsPicker
      bundle={bundle}
      agent={null}
      model={null}
      effort={null}
      allowInherit
      inheritAgentLabel="Codex"
      onAgentChange={onAgentChange}
      onModelChange={vi.fn()}
      onEffortChange={vi.fn()}
    />,
  );
  // open agent menu, click inherit — assert onAgentChange(null)
});

it("hides inherit option when allowInherit is false", () => {
  render(<ExecutionSettingsPicker allowInherit={false} agent="codex" model="m" effort="high" ... />);
  // assert no inherit label
});
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd tracker && npx vitest run src/components/assistant/__tests__/ExecutionSettingsPicker.test.tsx
```

- [ ] **Step 3: Implement picker**

Controlled component wrapping the same menus as `ComposerToolbar`:
- When `agent` is null and `allowInherit`, show inherit chip using `inheritAgentLabel`.
- When model/effort null with allowInherit, show “default” chip labels (i18n keys).
- On agent change: if non-null, suggest catalog default model/effort via `defaultComposerSettings(catalog)` but still call parent callbacks (parent owns persist).
- Reuse `ModelMenu`, export/move `AgentMenu` + `EffortMenu` + DerivedThinking path from `ComposerToolbar`.
- Optionally make `ComposerToolbar` a thin wrapper around this picker for non-null agent/settings to avoid drift.

- [ ] **Step 4: Run (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tracker): add shared ExecutionSettingsPicker from composer menus"
```

---

### Task 8: Tracker types + issue services

**Files:**
- Modify: `tracker/src/types/issue.ts`
- Modify: `tracker/src/services/mappers/issue.ts`
- Modify: `tracker/src/services/issues.ts`
- Test: `tracker/src/services/__tests__/issues.test.ts`

- [ ] **Step 1: Write failing tests for create/update payloads**

```ts
it("createIssue sends model and effort when provided", async () => {
  // mock fetch; createIssue(..., { agent: "codex", model: "gpt-5.5", effort: "high" })
  // assert JSON body includes model/effort
});

it("updateIssue sends null model to clear", async () => {
  // updateIssue(..., { model: null }) includes model: null
});

it("normalizeIssue maps model and effort", () => {
  expect(normalizeIssue({ ..., model: "x", effort: "high" }).model).toBe("x");
});
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd tracker && npx vitest run src/services/__tests__/issues.test.ts
```

- [ ] **Step 3: Implement**

```ts
// types/issue.ts
export interface Issue {
  // existing...
  agentKind?: AgentKind | null;
  model?: string | null;
  effort?: string | null;
}

export interface CreateIssueInput {
  agent?: AgentKind | null;
  model?: string | null;
  effort?: string | null;
  // ...
}

export interface UpdateIssueInput {
  agent?: AgentKind | null;
  model?: string | null;
  effort?: string | null;
  // ...
}
```

Mapper: read `model` / `effort` from DTO (`model` / `effort` snake or camel).  
`createIssue`/`updateIssue`: include keys when `!== undefined` (so `null` clears).

- [ ] **Step 4: Run (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tracker): thread issue model and effort through types and API client"
```

---

### Task 9: Create dialog + Summary inline editor

**Files:**
- Modify: `tracker/src/components/issues/IssueCreateDialog.tsx`
- Create: `tracker/src/components/issues/inline/InlineExecutionSettingsEditor.tsx`
- Modify: `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- Modify: `tracker/src/components/issues/IssueDrawer.tsx`
- Locales: `tracker/locales/en/tracker.json`, `pt-BR/tracker.json`
- Tests: create/summary editable tests (extend existing)

- [ ] **Step 1: Write failing UI tests**

- Create: selecting model includes it in `createIssue` mock call.
- Summary: saving execution settings calls updater with `{ agent, model, effort }`.

- [ ] **Step 2: Run one test file (expect fail)**

```bash
cd tracker && npx vitest run src/components/issues/__tests__/IssueCreateDialog.goalMode.test.tsx
```

- [ ] **Step 3: Implement**

1. **Create:** replace `AgentChip` row with `ExecutionSettingsPicker` (`allowInherit`); state `{ agent, model, effort }` nullable; submit passes through `createIssue`.
2. **InlineExecutionSettingsEditor:** load catalog via `fetchAssistantCatalogBundle(projectSlug)`; on commit call `onSave({ agent, model, effort })`.
3. **SummaryTab:** replace `InlineAgentEditor` with new editor; widen callback.
4. **IssueDrawer:** `issueUpdater.save({ agent, model, effort })`.
5. i18n: `issue.summary.execution`, inherit model/effort labels; reuse `assistant.composer.*` where possible.

- [ ] **Step 4: Run targeted tests (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tracker): choose agent/model/effort on create and summary"
```

---

### Task 10: User + Project Settings defaults UI

**Files:**
- Modify: `tracker/src/pages/SettingsPage.tsx`
- Modify: `tracker/src/services/settings.ts`
- Modify: `tracker/src/components/projects/ProjectAgentSelect.tsx` (or rename to `ProjectExecutionDefaults`)
- Modify: `tracker/src/components/projects/ProjectConfigEditor.tsx`
- Modify: `tracker/src/lib/workflowFrontMatter.ts` (if not done in Task 3)
- Backend settings GET already returns groups once registered

- [ ] **Step 1: Write failing tests** for settings service mapping of `agent_efforts` and for front-matter model/effort read/write.

```bash
cd tracker && npx vitest run src/lib/__tests__/workflowFrontMatter.test.ts
```

(Create this test file if absent.)

- [ ] **Step 2: Run (expect fail)**

- [ ] **Step 3: Implement**

- **User Settings:** replace agent-only chips with `ExecutionSettingsPicker` (`allowInherit={false}`). Persist:
  - `default_agent_kind` via existing agents group
  - model via `agent_models[agent]`
  - effort via `agent_efforts[agent]`
- **Project:** extend `ProjectAgentSelect` to include model/effort pickers; write YAML `agent.kind` / `agent.model` / `agent.effort` through front-matter helpers; saving still goes through workflow markdown update.

- [ ] **Step 4: Run targeted tests (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(settings): reuse execution picker for user and project defaults"
```

---

### Task 11: Execution composer shared SoT

**Files:**
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx`
- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it("seeds composer agent/model/effort from issue settings and persists on change", async () => {
  // render with issue.model/effort/agentKind set
  // assert AssistantComposer receives settingsSeed
  // simulate onSettingsChange → expect updateIssue (or save) called with new values
});
```

- [ ] **Step 2: Run (expect fail)**

```bash
cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx
```

- [ ] **Step 3: Implement**

1. Add `settingsSeed?: { agent: AgentKind; model: string; effort: string } | null` and `persistLocalComposerState?: boolean` (default true) to `AssistantComposer`.
2. When `settingsSeed` provided, initialize from seed instead of `loadComposerState`; when `persistLocalComposerState === false`, skip sessionStorage writes.
3. `ExecutionControlComposer`: pass seed from `issue.agentKind/model/effort` (resolved display values or pins — use pins; if null, use catalog defaults for the controlled composer UI while dispatch still omits nulls… **Spec shared SoT:** composer shows and edits pins; inherit shows catalog defaults visually but saving null keeps inherit). Prefer: composer always edits the **pinned** triple; null pin → UI shows effective default but first explicit change pins.
4. On agent/settings change from composer, debounce or immediate `updateIssue` / save with `{ agent, model, effort }` so Summary stays in sync.
5. Dispatch continues to send current composer values (already persisted).

- [ ] **Step 4: Run (expect pass)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tracker): hydrate execution composer from issue settings and persist"
```

---

### Task 12: Spec self-check + smoke

- [ ] **Step 1: Spec coverage checklist**

Confirm each spec goal has a task:
- Create + Summary picker → Task 9
- Orchestrator uses pins → Tasks 2, 5
- Inherit per field → Tasks 1, 6, 7
- User + Project defaults → Tasks 3, 4, 10
- Shared SoT composer → Task 11
- Settings primary + label mirror/fallback → Tasks 5, 6
- Execution mode out of scope → untouched

- [ ] **Step 2: Run one backend + one frontend smoke file** (not full suites)

```bash
cd elixir && mix test test/symphony_elixir/execution_settings_test.exs
cd tracker && npx vitest run src/components/assistant/__tests__/ExecutionSettingsPicker.test.tsx
```

- [ ] **Step 3: Commit any leftover i18n/docs fixes** if needed

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Create + Summary agent/model/effort | 9 |
| Persist for orchestrator | 1, 5, 6 |
| Inherit per field | 1, 6, 7 |
| User + Project Settings defaults | 3, 4, 10 |
| Shared SoT with Execution composer | 11 |
| `issue_agent_settings` SoT | 1, 6 |
| Label mirror + fallback | 5, 6 |
| Reuse composer components | 7 |
| Explicit null clear | 1, 6 |
| Non-goal: execution mode on Summary/Settings | excluded |

No TBD placeholders. Types: `agent_kind`/`model`/`effort` consistent across Elixir JSON and tracker `Issue`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-task-execution-settings-plan.md`.

Documents:
- Spec: `docs/superpowers/specs/2026-07-13-task-execution-settings-design.md`
- Plan: `docs/superpowers/plans/2026-07-13-task-execution-settings-plan.md`
