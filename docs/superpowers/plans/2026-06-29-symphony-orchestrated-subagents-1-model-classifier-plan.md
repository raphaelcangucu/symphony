# Symphony-Orchestrated Subagents — Phase 1: Model + Classifier Implementation Plan

**Goal:** Add a third execution-bundle unit shape, `:subagent_unit`, to the data model and the deterministic classifier so same-repo dependent units stop being classified as `child_run`, without changing any runtime/dispatch behavior yet.

**Architecture:** Pure, backend-only change. `ExecutionBundle.parse/1` learns to read `type: subagent_unit`; the `Classifier` gains a `:same_repo_subagent` rule that routes contract-coupled same-repo units to `:subagent_unit`; the `Validator` guards that a `subagent_unit` never targets a different repo; the authoring tool surface (`classify_execution_unit`, `create_subtask` unit-type resolution) accepts and reports the new shape. No orchestrator, runner, prompt, or frontend changes in this phase.

**Tech Stack:** Elixir, ExUnit, `YamlElixir`. Test runner: `mix test` from `elixir/`.

**Spec:** `docs/superpowers/specs/2026-06-29-symphony-orchestrated-subagents-design.md` (§6.1, §7).

---

## File Structure

- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle.ex` — add `:subagent_unit` to the `unit.type` typespec, parse `"subagent_unit"`, add `subagent_units/1`.
- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle/classifier.ex` — add the `:same_repo_subagent` rule + return type.
- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle/validator.ex` — add `:cross_repo_subagent` warning.
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex` — accept `"subagent_unit"` in `resolve_unit_type/3`; update the two tool descriptions that enumerate the shapes.
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle_test.exs`
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle/classifier_test.exs`
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle/validator_test.exs` (create if absent)
- Test: `elixir/test/symphony_elixir/assistant/execution_bundle_tools_test.exs`
- Doc: `.claude/skills/subtask-orchestration/SKILL.md` — describe the third shape.

All `mix` commands run from the `elixir/` directory.

---

## Task 1: Parse `:subagent_unit` in the bundle model

**Files:**
- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle.ex`
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle_test.exs`

- [ ] **Step 1: Write the failing test**

Add to `elixir/test/symphony_elixir/workpad/execution_bundle_test.exs`, after the existing `@workpad` module attribute (around line 36) add a second fixture, and add two tests before the final `end`:

```elixir
  @subagent_workpad """
  ## Codex Workpad

  ### Execution bundle

  ```yaml
  version: 1
  mode: bundle
  parent: macro-markets#510
  shared_contracts:
    - id: positions-api
      kind: graphql_query
      owner_unit: positions-backend
      consumers: [positions-ui]
      status: draft
  units:
    - id: positions-backend
      type: subagent_unit
      issue: MAC-12
      repo: macro-markets/app
      produces: [positions-api]
    - id: positions-ui
      type: subagent_unit
      issue: MAC-13
      repo: macro-markets/app
      consumes: [positions-api]
      depends_on: [positions-backend]
  ```
  """

  test "parse/1 reads subagent_unit type" do
    assert {:ok, bundle} = ExecutionBundle.parse(@subagent_workpad)
    backend = Enum.find(bundle.units, &(&1.id == "positions-backend"))
    ui = Enum.find(bundle.units, &(&1.id == "positions-ui"))
    assert backend.type == :subagent_unit
    assert ui.type == :subagent_unit
    assert ui.depends_on == ["positions-backend"]
  end

  test "subagent_units/1 returns only subagent units" do
    {:ok, bundle} = ExecutionBundle.parse(@subagent_workpad)
    ids = bundle |> ExecutionBundle.subagent_units() |> Enum.map(& &1.id)
    assert ids == ["positions-backend", "positions-ui"]
    assert ExecutionBundle.child_units(bundle) == []
    assert ExecutionBundle.workpad_units(bundle) == []
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/workpad/execution_bundle_test.exs`
Expected: FAIL — `parse/1` currently maps unknown types to `:workpad_task` (so `backend.type == :subagent_unit` fails), and `subagent_units/1` is undefined (`UndefinedFunctionError`).

- [ ] **Step 3: Write minimal implementation**

In `elixir/lib/symphony_elixir/workpad/execution_bundle.ex`:

Update the `unit` typespec `type` line (line 12):

```elixir
          type: :workpad_task | :child_run | :subagent_unit,
```

Add a `subagent_units/1` helper after `workpad_units/1` (after line 57):

```elixir
  @spec subagent_units(t()) :: [unit()]
  def subagent_units(%__MODULE__{units: units}),
    do: Enum.filter(units, &(&1.type == :subagent_unit))
```

Add a `unit_type/1` clause before the existing `unit_type("child_run")` clause (line 93):

```elixir
  defp unit_type("subagent_unit"), do: :subagent_unit
  defp unit_type("child_run"), do: :child_run
  defp unit_type(_), do: :workpad_task
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/workpad/execution_bundle_test.exs`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workpad/execution_bundle.ex elixir/test/symphony_elixir/workpad/execution_bundle_test.exs
git commit -m "feat(bundle): parse subagent_unit type in execution bundle"
```

---

## Task 2: Classifier `:same_repo_subagent` rule

**Files:**
- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle/classifier.ex`
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle/classifier_test.exs`

- [ ] **Step 1: Write the failing test**

In `elixir/test/symphony_elixir/workpad/execution_bundle/classifier_test.exs`, replace the existing test `"produces/consumes contract => child_run (rule :shared_contract)"` (lines 18-21) with these tests:

```elixir
  test "same repo + consumes contract => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, consumes: ["api"]}, parent_repo: @parent_repo)
  end

  test "same repo + produces contract => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, produces: ["api"]}, parent_repo: @parent_repo)
  end

  test "same repo + depends_on => subagent_unit (rule :same_repo_subagent)" do
    assert {:ok, :subagent_unit, :same_repo_subagent} =
             Classifier.classify(%{repo: @parent_repo, depends_on: ["x"]}, parent_repo: @parent_repo)
  end

  test "same repo + contract but deliverable pr => child_run (independent wins)" do
    assert {:ok, :child_run, :independent_deliverable} =
             Classifier.classify(
               %{repo: @parent_repo, consumes: ["api"], deliverable: "pr"},
               parent_repo: @parent_repo
             )
  end

  test "contract-coupled but parent_repo unknown => child_run (rule :shared_contract)" do
    assert {:ok, :child_run, :shared_contract} =
             Classifier.classify(%{repo: "macro-markets/app", consumes: ["api"]}, parent_repo: nil)
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/workpad/execution_bundle/classifier_test.exs`
Expected: FAIL — same-repo contract-coupled units currently return `{:ok, :child_run, :shared_contract}`, so the three `:subagent_unit` assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `elixir/lib/symphony_elixir/workpad/execution_bundle/classifier.ex`:

Update the `rule` and `result` typespecs (lines 18-19):

```elixir
  @type rule ::
          :different_repo
          | :independent_deliverable
          | :same_repo_subagent
          | :shared_contract
          | :same_repo_inline
  @type result :: {:ok, :workpad_task | :child_run | :subagent_unit, rule()} | {:ambiguous, atom()}
```

Update the `cond` in `classify/2` (lines 26-32) to add the same-repo subagent branch. After the `different_repo` branch we know `parent_repo` is either `nil` or equal to `repo`, so a non-nil `parent_repo` here means same repo:

```elixir
    cond do
      is_nil(repo) -> {:ambiguous, :unknown_repo}
      not is_nil(parent_repo) and repo != parent_repo -> {:ok, :child_run, :different_repo}
      independent?(unit) -> {:ok, :child_run, :independent_deliverable}
      contract_coupled?(unit) and not is_nil(parent_repo) -> {:ok, :subagent_unit, :same_repo_subagent}
      contract_coupled?(unit) -> {:ok, :child_run, :shared_contract}
      true -> {:ok, :workpad_task, :same_repo_inline}
    end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/workpad/execution_bundle/classifier_test.exs`
Expected: PASS (the four unchanged tests `:different_repo`, `:independent_deliverable`, `:same_repo_inline`, `:unknown_repo` still pass; the five new ones pass).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workpad/execution_bundle/classifier.ex elixir/test/symphony_elixir/workpad/execution_bundle/classifier_test.exs
git commit -m "feat(bundle): classify same-repo contract-coupled units as subagent_unit"
```

---

## Task 3: Validator guards `subagent_unit` to same repo

**Files:**
- Modify: `elixir/lib/symphony_elixir/workpad/execution_bundle/validator.ex`
- Test: `elixir/test/symphony_elixir/workpad/execution_bundle/validator_test.exs` (create)

A `subagent_unit` must live in the parent's repo (it shares the parent's tree/PR). If a manual override (`set_execution_unit`) creates a `subagent_unit` in a different repo, `preview_execution_plan` must warn.

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/workpad/execution_bundle/validator_test.exs`:

```elixir
defmodule SymphonyElixir.Workpad.ExecutionBundle.ValidatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle
  alias SymphonyElixir.Workpad.ExecutionBundle.Validator

  @parent_repo "macro-markets/app"

  defp unit(attrs) do
    Map.merge(
      %{
        id: "u",
        type: :subagent_unit,
        issue: nil,
        repo: @parent_repo,
        produces: [],
        consumes: [],
        depends_on: [],
        deliverable: nil
      },
      attrs
    )
  end

  defp bundle(units), do: %ExecutionBundle{version: 1, mode: "bundle", units: units, shared_contracts: []}

  test "same-repo subagent_unit passes" do
    assert :ok = Validator.validate(bundle([unit(%{id: "a"})]), parent_repo: @parent_repo)
  end

  test "subagent_unit in a different repo warns :cross_repo_subagent" do
    units = [unit(%{id: "a", repo: "macro-markets/other"})]
    assert {:error, warnings} = Validator.validate(bundle(units), parent_repo: @parent_repo)
    assert Enum.any?(warnings, &(&1.code == :cross_repo_subagent))
  end

  test "child_run in a different repo does not trigger :cross_repo_subagent" do
    units = [unit(%{id: "a", type: :child_run, repo: "macro-markets/other", deliverable: "pr"})]
    assert :ok = Validator.validate(bundle(units), parent_repo: @parent_repo)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/workpad/execution_bundle/validator_test.exs`
Expected: FAIL — `:cross_repo_subagent` warning does not exist yet, so the second test fails (returns `:ok` instead of `{:error, _}`).

- [ ] **Step 3: Write minimal implementation**

In `elixir/lib/symphony_elixir/workpad/execution_bundle/validator.ex`, add the new warning to the pipeline in `validate/2` (line 13-15):

```elixir
    warnings =
      cycle_warnings(bundle.units) ++
        producer_warnings(bundle.units) ++
        cross_repo_warnings(bundle.units, parent_repo) ++
        cross_repo_subagent_warnings(bundle.units, parent_repo)
```

Add the new private functions after `cross_repo_warnings/2` (after line 61):

```elixir
  defp cross_repo_subagent_warnings(units, parent_repo) when is_binary(parent_repo) do
    units
    |> Enum.filter(&(&1.type == :subagent_unit and is_binary(&1.repo) and &1.repo != parent_repo))
    |> Enum.map(fn u ->
      %{
        code: :cross_repo_subagent,
        message: "subagent_unit #{u.id} targets a different repo than the parent; use child_run for cross-repo work"
      }
    end)
  end

  defp cross_repo_subagent_warnings(_units, _parent_repo), do: []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/workpad/execution_bundle/validator_test.exs`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workpad/execution_bundle/validator.ex elixir/test/symphony_elixir/workpad/execution_bundle/validator_test.exs
git commit -m "feat(bundle): warn when a subagent_unit targets a different repo"
```

---

## Task 4: Authoring tool surface accepts and reports `subagent_unit`

The test module `SymphonyElixir.Assistant.ExecutionBundleToolsTest` calls
`ToolExecutor.execute("macro-markets", <tool>, <args>)` (arity 3, **no** opts)
and has a `setup` that migrates/cleans the SQLite repo and creates the
`macro-markets` project. Add tests inside that module. Two paths matter:

1. `classify_execution_unit` already passes `produces`/`consumes`/`depends_on`
   to the classifier and stringifies any returned type
   (`tool_executor.ex:944-958`), so after Task 2 it reports `subagent_unit`
   automatically — this is a **regression guard**.
2. `create_subtask` with an explicit `unit_type: "subagent_unit"` is the
   **actually-broken** path: `resolve_unit_type/3`'s guard only matches
   `["workpad_task", "child_run"]` (`tool_executor.ex:1220`), so an explicit
   `subagent_unit` silently falls through to auto-classification.

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex` (`resolve_unit_type/3` guard at line 1220; descriptions at lines 301, 317, 327).
- Test: `elixir/test/symphony_elixir/assistant/execution_bundle_tools_test.exs`

- [ ] **Step 1: Write the failing tests**

Add a regression-guard test next to the existing `classify_execution_unit`
tests (after line 36):

```elixir
  test "classify_execution_unit reports subagent_unit for same-repo contract-coupled work" do
    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "classify_execution_unit", %{
               "repo" => "macro-markets/app",
               "parent_repo" => "macro-markets/app",
               "consumes" => ["api"]
             })

    assert result.data.classification == "subagent_unit"
    assert result.data.rule == "same_repo_subagent"
  end
```

Add a test inside the `describe "create_subtask"` block (after line 72) that
exercises the explicit-type guard:

```elixir
    test "honors an explicit subagent_unit unit_type", %{parent: parent} do
      assert {:ok, result} =
               ToolExecutor.execute("macro-markets", "create_subtask", %{
                 "parent_identifier" => parent.identifier,
                 "title" => "Positions backend",
                 "repo" => "macro-markets/app",
                 "unit_type" => "subagent_unit"
               })

      assert result.data.unit_type == "subagent_unit"
    end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/symphony_elixir/assistant/execution_bundle_tools_test.exs`
Expected: the `create_subtask` test FAILS — the explicit `"subagent_unit"`
falls through `resolve_unit_type/3` to auto-classification, which (with the
locally-created parent having no repo ⇒ `parent_repo == nil`, no contract
coupling) yields `"workpad_task"`, so `result.data.unit_type == "subagent_unit"`
fails. The `classify_execution_unit` guard test PASSES already (Task 2 landed
the classifier change). Keep both.

- [ ] **Step 3: Write minimal implementation**

In `elixir/lib/symphony_elixir/assistant/tool_executor.ex`:

Update `resolve_unit_type/3`'s explicit-type guard (lines 1220-1221) to accept the new shape:

```elixir
  defp resolve_unit_type(%{"unit_type" => t}, _repo, _parent_repo)
       when t in ["workpad_task", "child_run", "subagent_unit"],
       do: {:ok, String.to_existing_atom(t)}
```

Update the `classify_execution_unit` tool description (line 301):

```elixir
        "Deterministically classify a planned subtask as workpad_task (inline), subagent_unit (same-repo dependent, runs in the parent tree/PR), or child_run (own run/worktree/PR). Preview only; no writes.",
```

Update the `create_subtask` tool description (line 317):

```elixir
        "Create a child issue under a parent and attach it to the parent's execution bundle. Omit unit_type to auto-classify (workpad_task inline, subagent_unit same-repo dependent in the parent PR, or child_run with its own PR/worktree). Use for breaking a task into subtasks.",
```

Update the `unit_type` parameter schema string for `create_subtask` (line 327):

```elixir
            "unit_type" => string_schema("Optional: 'workpad_task', 'subagent_unit', or 'child_run'. Omit to auto-classify."),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/assistant/execution_bundle_tools_test.exs`
Expected: PASS (both new tests plus all existing ones; the existing same-repo
`create_subtask` test stays `workpad_task` because it has no contract coupling).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tool_executor.ex elixir/test/symphony_elixir/assistant/execution_bundle_tools_test.exs
git commit -m "feat(authoring): accept and report subagent_unit in execution-unit tools"
```

---

## Task 5: Document the third shape + run the full bundle suite

**Files:**
- Modify: `.claude/skills/subtask-orchestration/SKILL.md`

- [ ] **Step 1a: Add a third row to the execution-shapes table**

In `.claude/skills/subtask-orchestration/SKILL.md`, the shapes are a Markdown
table (lines 14-17). Replace the `child_run` row (line 17) with a `subagent_unit`
row followed by the `child_run` row:

```markdown
| `subagent_unit` | A Symphony-managed subagent inside the **parent's** working tree; ships in the **parent's PR** (no own clone/branch/PR). The parent spawns it once its consumed contracts are `ready`, supervises its TDD + evidence slice, and only then accepts the produced contract. | Same-repo work that depends on, or shares a contract with, sibling units. |
| `child_run` | Its own run: own issue, isolated git worktree, branch, validation, and PR. | Independent or cross-repo deliverables. |
```

- [ ] **Step 1b: Update the title-line description and the classification rules**

Replace the frontmatter `description` phrase "the two execution shapes
(workpad_task vs child_run)" (line 3) with:

```markdown
the three execution shapes (workpad_task, subagent_unit, child_run),
```

Then replace the ordered classification list (lines 21-27) with the rule order
the classifier actually applies (first match wins):

```markdown
1. **`:different_repo`** — the unit targets a different repo than the parent → `child_run`.
2. **`:independent_deliverable`** — the unit is independently shippable (`deliverable: "pr"`) → `child_run`.
3. **`:same_repo_subagent`** — same repo as the parent **and** it `produces`/`consumes` a shared contract or `depends_on` another unit → `subagent_unit` (+ `shared_contract`). Use this, not `child_run`, for same-repo dependent work.
4. **`:shared_contract`** — contract-coupled but the parent's repo is unknown → `child_run` (conservative fallback).
5. **`:same_repo_inline`** — same repo, no isolation needed → `workpad_task`.
6. **`:unknown_repo`** — repo is unknown → **ambiguous**: keep the subtask a draft and ask the user.
```

- [ ] **Step 2: Run the full execution-bundle suite to confirm no regressions**

Run: `mix test test/symphony_elixir/workpad/ test/symphony_elixir/assistant/execution_bundle_tools_test.exs`
Expected: PASS — all bundle model, classifier, validator, and authoring-tool tests green.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/subtask-orchestration/SKILL.md
git commit -m "docs(subtask): document subagent_unit execution shape"
```

---

## Self-Review

**1. Spec coverage (§6.1, §7):**
- New shape `:subagent_unit` in the model → Task 1. ✓
- Classifier delta (same-repo contract-coupled ⇒ `:subagent_unit`; cross-repo stays `child_run`; `deliverable: pr` stays `child_run`; unknown parent_repo stays conservative `child_run`) → Task 2. ✓
- `subagent_unit` is same-repo only (guard) → Task 3. ✓
- Authoring surface exposes the shape → Task 4. ✓
- Classifier guidance documented for the authoring agent → Task 5. ✓
- Out of scope for Phase 1 (runner, tool `spawn_subagent`, prompt, observability, evidence gate) → Phases 2–5, not this plan. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows the exact code and exact `mix test` command with expected outcome. ✓

**3. Type consistency:** `:subagent_unit` (atom) and `"subagent_unit"` (string) used consistently; `subagent_units/1` named consistently across Task 1 and the spec; classifier rule atom `:same_repo_subagent` matches between impl (Task 2) and the tool test assertion (Task 4); validator warning code `:cross_repo_subagent` matches between impl and test (Task 3). ✓

---

## Task 6: Dispatch-compat bridge — added during execution

**Why (regression found during execution):** Task 2 makes the classifier emit
`:subagent_unit` for same-repo contract-coupled units, but the orchestrator
dispatch/gate/coordinator path keyed entirely off `ExecutionBundle.child_units/1`
(strictly `:child_run`). A freshly-authored bundle of same-repo dependent units
would therefore be all `:subagent_unit`, `BundleCoordinator.coordinator?/1` would
return `false`, and those units would be **silently dropped** (never dispatched,
gated, or counted complete) until the Phase 2 runner exists. That is a runtime
regression, so Phase 1 must bridge it.

**Change:** add `ExecutionBundle.dispatchable_units/1` (`:child_run` +
`:subagent_unit`) and route the orchestrator-layer call sites through it, leaving
the strict `child_units/1` accessor untouched for authoring/model semantics:

- `BundleCoordinator.coordinator?/1`, `children_complete?/2`, `children_all_done?/2`
- `BundleDispatch.dispatchable_children/3`
- `BundleGate.find_child_unit/2`
- `Orchestrator.resolve_done_units/1`
- `IssueDispatchPrep.bundle_child_identifiers/2`

Effect: a `:subagent_unit` dispatches exactly like a `:child_run` (own
worktree/branch/PR) — i.e. today's behavior — with **zero regression**. Phase 2
replaces this bridge with the real in-parent subagent runner.

Tests: `dispatchable_units/1` in the model suite + a coordinator test proving a
`subagent_unit`-only bundle is a coordinator and dispatches/gates/completes.
Commit: `feat(bundle): dispatch subagent_unit as child_run until Phase 2 runner`.

---

## Next phases (separate plans, written after this one lands)

- **Phase 2 — Execution:** shared per-repo working tree + single-writer lock, `spawn_subagent(unit_id)` tool, `AgentRunner` subagent mode, subagent registry + `:waiting`/live states, `subagent_unit_section` prompt, dependency-gated spawning. **Replaces the Task 6 dispatch-compat bridge** with the real in-parent runner.
- **Phase 3 — Quality cycle:** per-subagent TDD + slice evidence (`task_id`=unit), contract-ready gate (TDD ∧ evidence ∧ code-review), parent final evidence over the single PR.
- **Phase 4 — Observability/drill-in:** `:subagent` snapshot entries, clickable nested rows, `SessionLog.resolve_by_session/2`, token rollup.
