# Global-less Per-Project Orchestration — Implementation Plan

**Goal:** Make every project fully self-describing from its DB-owned setup so the orchestrator never reads or falls back to a global `WORKFLOW.md` for project identity, states, or prompt.

**Architecture:** Single BEAM, single `Orchestrator` GenServer iterating `Context.list_projects/0`. Each project resolves its config/prompt/states/agent/tracker **only** from its DB `ProjectSetup` + `projects` row, with Config's hardcoded constants as the code-default floor. A project that cannot resolve a runnable config (no tracker identity or no prompt) is **skipped with a warning** — it never inherits another project's identity. Process/host settings (HTTP port, SQLite path, total agent cap, sync-enabled) come from `config.exs`/env.

**Tech Stack:** Elixir, Ecto/SQLite (`exqlite`), Phoenix, NimbleOptions (workflow schema validation), ExUnit. Build/test via `mise exec -- mix ...` from `elixir/`.

**Source spec:** `docs/superpowers/specs/2026-06-03-global-less-per-project-orchestration-design.md`

> **Note on line numbers:** This repo is under concurrent modification (other sessions touch `orchestrator.ex`, `project_config.ex`, etc.). Line numbers below are indicative — always locate by function name. Run `mise exec -- mix compile` after each task; if a `defp` you target was renamed/moved, search by name first.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `elixir/lib/symphony_elixir/tracker.ex` | Selects the tracker adapter | Decouple `adapter/0` from global `tracker_kind`; gate on `tracker_sync_enabled?` |
| `elixir/lib/symphony_elixir/project_config.ex` | Resolve effective per-project config + prompt | Merge base = code defaults (drop global front matter); add `resolve_runnable/1` skip signal; prompt fallback → `nil` |
| `elixir/lib/symphony_elixir/prompt_builder.ex` | Build agent prompt from issue | Remove `global_template/0` fallback; unresolved → raise tagged error (orchestrator skips) |
| `elixir/lib/symphony_elixir/config.ex` | Process + code-default config | `code_default_front_matter/0`; `default_agent_kind/0` no longer reads global; `tracker_sync_enabled?` default true |
| `elixir/lib/symphony_elixir/orchestrator.ex` | Dispatch loop + state machine | Per-project state sets (active/terminal/dispatch) resolved from `ProjectConfig`; skip invalid projects |
| `elixir/config/config.exs` (+ `runtime.exs` if present) | Process/host config | `sync_enabled: true` default; `default_agent_kind` |
| `elixir/dev/serve.exs` | Boot script | Drop `SYMPHONY_WORKFLOW` requirement; boot with process settings only |
| `elixir/lib/symphony_elixir/application.ex` (or boot module) | Optional auto-discovery | Create missing project setups from `WORKFLOW.<slug>.md`; never overwrite |
| Test files (mirrors above) | TDD coverage | New/updated tests per task |

Tasks are ordered so each leaves the suite green and is independently committable. Tasks 1–5 are the cutover core; Task 6 is the boot/serve change (land with 1 for backward-compat safety); Task 7 is optional auto-discovery; Task 8 is rollout/backfill.

---

## Task 1: Decouple `Tracker.adapter/0` from the global tracker kind

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker.ex` (function `adapter/0`, ~`:62-77`)
- Test: `elixir/test/symphony_elixir/tracker_test.exs` (create if missing)

**Context:** Today `adapter/0` returns `LocalFirstTracker` only when the global `Config.tracker_kind/0` is a remote kind. We want multi-project local-first whenever sync is enabled, regardless of any global kind.

- [ ] **Step 1: Read the current `adapter/0`**

Run: locate it.

```bash
cd elixir && mise exec -- grep -n "def adapter" lib/symphony_elixir/tracker.ex
```

Read the function body so the edit below matches the current `cond`/`case` exactly.

- [ ] **Step 2: Write the failing test**

Create/append `elixir/test/symphony_elixir/tracker_test.exs`:

```elixir
defmodule SymphonyElixir.TrackerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Tracker
  alias SymphonyElixir.Tracker.Sync.LocalFirstTracker

  setup do
    prev = Application.get_env(:symphony_elixir, :tracker, [])
    on_exit(fn -> Application.put_env(:symphony_elixir, :tracker, prev) end)
    :ok
  end

  test "adapter/0 selects LocalFirstTracker when sync is enabled, independent of global kind" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Tracker.adapter() == LocalFirstTracker
  end
end
```

- [ ] **Step 3: Run it to confirm the failure mode**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker_test.exs`
Expected: FAIL (adapter resolves via global kind, not `sync_enabled?`), or compile error if module path differs — fix the alias to the real `LocalFirstTracker` module before proceeding.

- [ ] **Step 4: Implement the decoupling**

In `adapter/0`, make the local-first branch gate on `Config.tracker_sync_enabled?/0` first, before the per-kind selection. Concretely, ensure the first clause is:

```elixir
def adapter do
  cond do
    Config.tracker_sync_enabled?() ->
      SymphonyElixir.Tracker.Sync.LocalFirstTracker

    true ->
      adapter_for_kind(Config.tracker_kind())
  end
end
```

If the existing code already special-cases remote kinds inside one `cond`/`case`, replace the `tracker_kind() in ["github", "linear", "jira"]` guard with the `tracker_sync_enabled?()` check. Keep `adapter_for_kind/1` (or the existing per-kind mapping) for the non-sync fallback path.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker_test.exs`
Expected: PASS

- [ ] **Step 6: Run the full tracker-adjacent suite for regressions**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/tracker_test.exs test/symphony_elixir/tracker`
Expected: PASS (0 failures)

- [ ] **Step 7: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/tracker.ex test/symphony_elixir/tracker_test.exs
git add lib/symphony_elixir/tracker.ex test/symphony_elixir/tracker_test.exs
git commit -m "refactor(tracker): select LocalFirstTracker on sync_enabled, not global kind"
```

---

## Task 2: `ProjectConfig` merges code defaults (no global) + `resolve_runnable/1` skip signal

**Files:**
- Modify: `elixir/lib/symphony_elixir/project_config.ex` (`resolve/1` ~`:37-59`, `resolve_prompt/2` ~`:106-110`)
- Test: `elixir/test/symphony_elixir/project_config_test.exs`

**Context:** `resolve/1` currently does `deep_merge(Config.workflow_front_matter(), project_front_matter)` and falls back to `Config.workflow_prompt()`. We drop the global merge base and the global prompt fallback. `Config.validate_front_matter/1` already applies the schema's code-level defaults for any omitted key, so the merge base becomes effectively "code defaults".

- [ ] **Step 1: Write the failing test for code-default merge base**

Append to `elixir/test/symphony_elixir/project_config_test.exs` (match the file's existing setup/fixtures for building a `%Project{}` with a `%ProjectSetup{}`):

```elixir
test "resolve/1 uses code defaults (not a global workflow) when workflow_config omits states" do
  project = insert_project_with_setup(%{workflow_config: %{}, prompt_template: "do work"})

  cfg = SymphonyElixir.ProjectConfig.resolve(project)

  assert cfg.active_states == ["Todo", "In Progress"]
  assert cfg.terminal_states == ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
end

test "resolve/1 returns nil prompt when the project has no prompt_template" do
  project = insert_project_with_setup(%{workflow_config: %{}, prompt_template: nil})

  assert SymphonyElixir.ProjectConfig.resolve(project).prompt_template == nil
end
```

If the test file lacks an `insert_project_with_setup/1` helper, add one using the same `Repo`/`Context` calls the existing tests use (search the file for how it currently builds projects). Do not invent a new persistence path.

- [ ] **Step 2: Run to confirm failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/project_config_test.exs`
Expected: FAIL — prompt falls back to the global template (not `nil`); states may differ if a global workflow is loaded in the test env.

- [ ] **Step 3: Change the merge base to code defaults**

In `resolve/1` replace:

```elixir
merged = deep_merge(Config.workflow_front_matter(), project_front_matter)
opts = Config.validate_front_matter(merged)
```

with:

```elixir
opts = Config.validate_front_matter(project_front_matter)
```

Remove the now-unused `deep_merge/2` private functions **only if** no other clause in this module calls them (search first: `grep -n deep_merge lib/symphony_elixir/project_config.ex`). If `resolve_after_create_hook/2` or others still use the merged map, keep `deep_merge/2`.

- [ ] **Step 4: Change the prompt fallback to `nil`**

Replace `resolve_prompt/1` clauses:

```elixir
defp resolve_prompt(%ProjectSetup{prompt_template: prompt}) when is_binary(prompt) do
  case String.trim(prompt) do
    "" -> nil
    trimmed -> trimmed
  end
end

defp resolve_prompt(_setup), do: nil
```

(Returning the original `prompt` is fine too, but trim-to-`nil` keeps the skip signal in Task 3 unambiguous.)

- [ ] **Step 5: Add `resolve_runnable/1`**

Add a public function that classifies whether the resolved config can actually run:

```elixir
@spec resolve_runnable(Project.t()) :: {:ok, t()} | {:skip, String.t()}
def resolve_runnable(%Project{} = project) do
  cfg = resolve(project)

  cond do
    is_nil(cfg.tracker_kind) or cfg.tracker_kind == "" ->
      {:skip, "no tracker identity"}

    is_nil(cfg.prompt_template) or String.trim(cfg.prompt_template) == "" ->
      {:skip, "no prompt configured"}

    true ->
      {:ok, cfg}
  end
end
```

- [ ] **Step 6: Test the skip signal**

Append:

```elixir
test "resolve_runnable/1 skips a project with no prompt" do
  project = insert_project_with_setup(%{workflow_config: %{}, prompt_template: nil})
  assert {:skip, "no prompt configured"} = SymphonyElixir.ProjectConfig.resolve_runnable(project)
end

test "resolve_runnable/1 returns {:ok, cfg} for a complete project" do
  project = insert_project_with_setup(%{workflow_config: %{}, prompt_template: "do work"})
  assert {:ok, %SymphonyElixir.ProjectConfig{}} = SymphonyElixir.ProjectConfig.resolve_runnable(project)
end
```

- [ ] **Step 7: Run the suite to confirm pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/project_config_test.exs`
Expected: PASS

- [ ] **Step 8: Spec-check new public function**

Run: `cd elixir && mise exec -- mix specs.check`
Expected: PASS (the new `@spec resolve_runnable/1` satisfies the check).

- [ ] **Step 9: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/project_config.ex test/symphony_elixir/project_config_test.exs
git add lib/symphony_elixir/project_config.ex test/symphony_elixir/project_config_test.exs
git commit -m "refactor(project_config): drop global merge base; add resolve_runnable skip signal"
```

---

## Task 3: Remove the global prompt fallback in `PromptBuilder`

**Files:**
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex` (`resolve_template/1` ~`:39-55`)
- Test: `elixir/test/symphony_elixir/prompt_builder_test.exs` (create if missing)

**Context:** `resolve_template/1` falls back to `global_template/0` (loads `Workflow.current()`). After this task, a project with no resolvable prompt raises a tagged error that the orchestrator turns into a skip — never a global prompt.

- [ ] **Step 1: Write the failing test**

Append to (or create) `elixir/test/symphony_elixir/prompt_builder_test.exs`:

```elixir
defmodule SymphonyElixir.PromptBuilderTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.{Issue, PromptBuilder}

  test "build_prompt/2 raises a tagged error when the issue's project has no prompt" do
    issue = %Issue{id: 1, project_slug: "project-with-no-prompt", title: "x", state: "Todo"}

    assert_raise RuntimeError, ~r/prompt_unresolved/, fn ->
      PromptBuilder.build_prompt(issue)
    end
  end
end
```

Adjust the fixture so `project-with-no-prompt` exists with a setup that has `prompt_template: nil` (reuse the project-insertion helper pattern from `project_config_test.exs`). The key assertion is that there is **no** global fallback.

- [ ] **Step 2: Run to confirm failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: FAIL — currently falls back to the global template (no raise).

- [ ] **Step 3: Replace the fallback with a tagged error**

Rewrite `resolve_template/1` and delete `global_template/0` + `prompt_template!/1`:

```elixir
defp resolve_template(%SymphonyElixir.Issue{project_slug: slug}) when is_binary(slug) do
  case Context.get_project(slug) do
    {:ok, project} ->
      project
      |> Repo.preload(:setup)
      |> ProjectConfig.resolve_runnable()
      |> case do
        {:ok, %ProjectConfig{prompt_template: prompt}} when is_binary(prompt) -> prompt
        {:skip, reason} -> raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{reason}"
      end

    {:error, reason} ->
      raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{inspect(reason)}"
  end
end

defp resolve_template(%SymphonyElixir.Issue{} = issue) do
  raise RuntimeError, "prompt_unresolved: issue=#{inspect(issue.id)} reason=no project_slug"
end
```

Remove the now-unused `Workflow` alias from the `alias SymphonyElixir.{...}` line **only if** no other function in the module references `Workflow` (search: `grep -n "Workflow" lib/symphony_elixir/prompt_builder.ex`).

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/prompt_builder_test.exs`
Expected: PASS

- [ ] **Step 5: Compile-check for unused alias/function warnings**

Run: `cd elixir && mise exec -- mix compile --warnings-as-errors`
Expected: PASS (no "unused alias Workflow" / "function global_template/0 is unused"). Fix any surfaced warning.

- [ ] **Step 6: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/prompt_builder.ex test/symphony_elixir/prompt_builder_test.exs
git add lib/symphony_elixir/prompt_builder.ex test/symphony_elixir/prompt_builder_test.exs
git commit -m "refactor(prompt_builder): remove global prompt fallback; unresolved -> tagged error"
```

---

## Task 4: `Config` — code-default agent kind + sync-enabled default

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex` (`default_agent_kind/0` ~`:517-526`; `tracker_sync_enabled?/0` ~`:307-317`)
- Modify: `elixir/config/config.exs`
- Test: `elixir/test/symphony_elixir/config_test.exs`

**Context:** `default_agent_kind/0` currently derives the agent from global workflow sections via `configured_agent_kinds/0`. With no global workflow, it must fall back to a process-level default (code constant, overridable in `config.exs`). `tracker_sync_enabled?/0` must default to `true` for this model.

- [ ] **Step 1: Write the failing test**

Append to `elixir/test/symphony_elixir/config_test.exs`:

```elixir
test "default_agent_kind/0 falls back to the process default with no global workflow" do
  prev = Application.get_env(:symphony_elixir, :default_agent_kind)
  Application.put_env(:symphony_elixir, :default_agent_kind, "codex")
  on_exit(fn -> Application.put_env(:symphony_elixir, :default_agent_kind, prev) end)

  assert SymphonyElixir.Config.default_agent_kind() == "codex"
end

test "active_states/0 returns code defaults" do
  assert SymphonyElixir.Config.active_states() == ["Todo", "In Progress"]
end
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/config_test.exs`
Expected: FAIL on `default_agent_kind` (reads global sections, ignores app env).

- [ ] **Step 3: Add a code-default agent-kind constant + app-config read**

Add near the other `@default_*` attributes:

```elixir
@default_agent_kind "codex"
```

Rewrite `default_agent_kind/0` to prefer configured global sections (backward-compat during transition) but fall back to app config then the constant:

```elixir
@spec default_agent_kind() :: String.t()
def default_agent_kind do
  kinds = configured_agent_kinds()

  cond do
    "codex" in kinds -> "codex"
    kinds != [] -> List.first(kinds)
    true -> Application.get_env(:symphony_elixir, :default_agent_kind, @default_agent_kind)
  end
end
```

- [ ] **Step 4: Default `sync_enabled` to true in config.exs**

In `elixir/config/config.exs`, ensure the `:symphony_elixir, :tracker` config sets `sync_enabled: true` (add the key if absent; do not clobber other keys):

```elixir
config :symphony_elixir, :tracker, sync_enabled: true
```

Leave `tracker_sync_enabled?/0`'s logic as-is (it reads this key); the change is only the default value. Confirm test env (`config/test.exs`) does not override it to `false` in a way that breaks Task 1's adapter test — if it does, scope that override per-test rather than globally.

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/config_test.exs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/config.ex config/config.exs test/symphony_elixir/config_test.exs
git add lib/symphony_elixir/config.ex config/config.exs test/symphony_elixir/config_test.exs
git commit -m "refactor(config): code-default agent kind; sync_enabled defaults true"
```

---

## Task 5: Orchestrator resolves state sets per project

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex` (`active_state_set/0`, `terminal_state_set/0`, `dispatch_state_set/0` ~`:550-567`; `reconcile_running_issues/1` ~`:224-246`; `reconcile_running_issue_states/4` ~`:278-287`; dispatch candidate gating)
- Test: `elixir/test/symphony_elixir/orchestrator_test.exs` (and existing `*_for_test` helpers)

**Context:** The orchestrator's state sets are global. We make them per-project. `LocalFirstTracker` already filters candidates by each project's active states, so the orchestrator-side change is primarily in **reconciliation** of running issues (terminal detection) and any dispatch-time gating, which must use the *issue's project* states. Implement a memoized resolver keyed by `project_slug`, falling back to code defaults when a project is unresolved.

- [ ] **Step 1: Write the failing test (per-project terminal detection)**

Append to `elixir/test/symphony_elixir/orchestrator_test.exs` using the existing `reconcile_issue_states_for_test/2` entry point, but extend it to take per-project states. First add a focused helper test:

```elixir
test "an issue is terminal per its own project's terminal_states, not a global set" do
  # Project A treats "Done" as terminal; the issue belongs to project A.
  state = build_state_with_running_issue(project_slug: "proj-a", issue_id: 7)

  issues = [%SymphonyElixir.Issue{id: 7, project_slug: "proj-a", state: "Done", assignee_id: nil}]

  new_state = SymphonyElixir.Orchestrator.reconcile_issue_states_for_test(issues, state)

  refute Map.has_key?(new_state.running, 7)
end
```

Use the test-support helpers already present in the file to build a `%State{}` with a running issue (search the file for how `running` is populated in existing tests; reuse that fixture, adding `project_slug`).

- [ ] **Step 2: Run to confirm failure / current behavior**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_test.exs`
Expected: Existing tests PASS; new test may PASS already if "Done" is a global terminal default. To make the test *meaningful*, give `proj-a` a non-default terminal set (e.g. only `["Archived"]`) via its setup and assert an issue in `"Archived"` terminates while `"Done"` does **not** — this proves per-project resolution rather than global defaults. Adjust the test accordingly before implementing.

- [ ] **Step 3: Add a per-project state-set resolver**

Add private helpers near the existing `active_state_set/0`:

```elixir
defp project_state_sets(slug) when is_binary(slug) do
  case Context.get_project(slug) do
    {:ok, project} ->
      cfg = project |> Repo.preload(:setup) |> ProjectConfig.resolve()
      %{
        active: normalize_state_set(cfg.active_states),
        terminal: normalize_state_set(cfg.terminal_states),
        dispatch: normalize_state_set(cfg.dispatch_states),
        wait: normalize_state_set(cfg.wait_states)
      }

    {:error, _} ->
      default_state_sets()
  end
end

defp project_state_sets(_), do: default_state_sets()

defp default_state_sets do
  %{
    active: normalize_state_set(Config.active_states()),
    terminal: normalize_state_set(Config.terminal_states()),
    dispatch: normalize_state_set(Config.dispatch_states()),
    wait: normalize_state_set(Config.wait_states())
  }
end

defp normalize_state_set(states) do
  states
  |> Enum.map(&normalize_issue_state/1)
  |> Enum.filter(&(&1 != ""))
  |> MapSet.new()
end
```

Add `alias SymphonyElixir.{ProjectConfig}` and `alias SymphonyElixir.LocalTracker.Context` to the module's alias block if not already present (search first).

- [ ] **Step 4: Route reconciliation through per-issue project states**

Change `reconcile_issue_state/4` callers so each issue is checked against **its** project's state sets. In `reconcile_running_issue_states/4`, replace the shared `active_states`/`terminal_states` arguments with a per-issue lookup:

```elixir
defp reconcile_running_issue_states([], state, _sets_fun), do: state

defp reconcile_running_issue_states([issue | rest], state, sets_fun) do
  %{active: active, terminal: terminal} = sets_fun.(issue.project_slug)
  reconcile_running_issue_states(rest, reconcile_issue_state(issue, state, active, terminal), sets_fun)
end
```

Update the call site in `reconcile_running_issues/1`:

```elixir
reconcile_running_issue_states(issues, state, &project_state_sets/1)
```

Update both `reconcile_issue_states_for_test/2` clauses to pass `&project_state_sets/1` so tests exercise the same path. Memoize within a single poll cycle if profiling shows repeated `Context.get_project/1` calls (use a `Map` accumulator keyed by slug); otherwise keep it simple.

- [ ] **Step 5: Update dispatch-time gating**

For `should_dispatch_issue?/4` (used by `should_dispatch_issue_for_test/2`), pass the issue's project `dispatch`/`terminal` sets instead of the global ones. Locate the dispatch loop that calls `dispatch_state_set()`/`terminal_state_set()` and replace those zero-arg calls with `project_state_sets(issue.project_slug)` lookups. Keep `default_state_sets/0` as the fallback for issues whose project cannot be resolved (those issues should not be dispatched — guard accordingly).

- [ ] **Step 6: Run the orchestrator suite**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/orchestrator_test.exs test/symphony_elixir/orchestrator_incomplete_test.exs`
Expected: PASS (0 failures). Fix any `*_for_test` arity changes in callers.

- [ ] **Step 7: Compile clean**

Run: `cd elixir && mise exec -- mix compile --warnings-as-errors`
Expected: PASS. Remove the now-unused zero-arg `active_state_set/0`/`dispatch_state_set/0` if nothing references them (search first; some `*_for_test` helpers may still use `terminal_state_set/0` — keep what's referenced).

- [ ] **Step 8: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/orchestrator.ex test/symphony_elixir/orchestrator_test.exs
git add lib/symphony_elixir/orchestrator.ex test/symphony_elixir/orchestrator_test.exs
git commit -m "refactor(orchestrator): resolve active/terminal/dispatch states per project"
```

---

## Task 6: Boot without a global workflow (`dev/serve.exs`)

**Files:**
- Modify: `elixir/dev/serve.exs`
- Test: manual boot check (script, not ExUnit) — documented command below

**Context:** `dev/serve.exs` currently requires `SYMPHONY_WORKFLOW` and sets the single-workflow path. With global-less orchestration, boot only needs process settings (port, SQLite path, sync-enabled). Keep the single-instance guard and the migrate step.

- [ ] **Step 1: Read the current boot script**

Read `elixir/dev/serve.exs` fully and note where it (a) requires/validates `SYMPHONY_WORKFLOW`, (b) sets the workflow file path, (c) runs migrations, (d) enforces the single-instance guard.

- [ ] **Step 2: Remove the `SYMPHONY_WORKFLOW` requirement**

Delete the block that raises/exits when `SYMPHONY_WORKFLOW` is unset and the code that sets the global workflow path. Preserve: single-instance guard, `Ecto`/migrate step, port/host resolution from env, and starting the app. If a github workflow path is still passed (transition compatibility), allow it but do not require it — log `serve: no global workflow (per-project mode)` when unset.

- [ ] **Step 3: Boot smoke test**

Run (foreground, then Ctrl-C after the HTTP check):

```bash
cd elixir && SYMPHONY_WORKFLOW= mise exec -- elixir dev/serve.exs
```

In another shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/tracker
```

Expected: `200`, and the boot log shows the per-project-mode message with **no** "missing SYMPHONY_WORKFLOW" error.

> If `make serve` is already running on port 4000, stop it first (`pkill -f serve.exs` or use the existing single-instance guard) to avoid the known port conflict.

- [ ] **Step 4: Commit**

```bash
cd elixir && git add dev/serve.exs
git commit -m "feat(serve): boot in per-project mode without requiring SYMPHONY_WORKFLOW"
```

---

## Task 7: Optional auto-discovery of `WORKFLOW.<slug>.md` at boot

**Files:**
- Modify: the boot/discovery module (search: `grep -rn "discovered project" lib/` and `grep -rn "list_projects" lib/symphony_elixir/application.ex`). If no discovery hook exists, add a small module `elixir/lib/symphony_elixir/boot/project_discovery.ex` invoked from `application.ex` after migrate.
- Test: `elixir/test/symphony_elixir/boot/project_discovery_test.exs`

**Context:** For each `WORKFLOW.<slug>.md` in the repo root with no matching project, create the project + setup; never overwrite an existing DB config. This reuses the backfill importer logic.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Boot.ProjectDiscoveryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Boot.ProjectDiscovery
  alias SymphonyElixir.LocalTracker.Context

  @tag :tmp_dir
  test "creates a missing project from WORKFLOW.<slug>.md and never overwrites existing", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "WORKFLOW.newproj.md"), "---\nlocal:\n  project_slug: newproj\n---\nprompt body")

    assert :ok = ProjectDiscovery.run(dir)
    assert {:ok, _project} = Context.get_project("newproj")

    # Second run is idempotent and does not overwrite.
    assert :ok = ProjectDiscovery.run(dir)
  end
end
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/boot/project_discovery_test.exs`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Implement `ProjectDiscovery.run/1`**

Reuse the parsing/import the backfill task uses (`mix/tasks/symphony.workflows.backfill.ex`). Extract the per-file import into a shared function if practical; otherwise call the same `Context`/`ProjectSetup` upsert path. Guard: if `Context.get_project(slug)` returns `{:ok, _}`, skip (log `multi_orchestrator: project=<slug> already exists, skip discovery`); else create project + setup and log `multi_orchestrator: discovered project=<slug>`.

- [ ] **Step 4: Wire into boot (after migrate, before orchestrator starts)**

In `application.ex` (or the boot module), call `ProjectDiscovery.run(File.cwd!())` guarded by an app-config flag `:auto_discover_projects` (default `true`), wrapped in try/rescue so a discovery error logs and does not crash boot.

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/boot/project_discovery_test.exs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd elixir && mise exec -- mix format lib/symphony_elixir/boot/project_discovery.ex test/symphony_elixir/boot/project_discovery_test.exs
git add lib/symphony_elixir/boot/project_discovery.ex test/symphony_elixir/boot/project_discovery_test.exs lib/symphony_elixir/application.ex
git commit -m "feat(boot): auto-discover WORKFLOW.<slug>.md into missing project setups"
```

---

## Task 8: Rollout — backfill macro-markets & distributionmachine, full verification

**Files:** none (data + verification)

- [ ] **Step 1: Stop any running serve to avoid port 4000 conflict**

Run: `pkill -f serve.exs || true`

- [ ] **Step 2: Run the one-time backfill**

Run: `cd elixir && mise exec -- mix symphony.workflows.backfill --dir .`
Expected: `macro-markets` reported as already DB-owned (skipped); `distributionmachine` imported from `WORKFLOW.distributionmachine.md`. No errors.

- [ ] **Step 3: Verify the distributionmachine setup is correct**

Run a read-only check (reuse the project's own config, not a global):

```bash
cd elixir && mise exec -- mix run -e '
  {:ok, p} = SymphonyElixir.LocalTracker.Context.get_project("distributionmachine")
  cfg = p |> SymphonyElixir.Repo.preload(:setup) |> SymphonyElixir.ProjectConfig.resolve()
  IO.inspect({cfg.tracker_kind, cfg.repo, cfg.active_states, String.slice(cfg.prompt_template || "<nil>", 0, 60)}, label: "distributionmachine cfg")
'
```

Expected: `tracker_kind` set, `repo` = `clouapp/distributionmachine`, prompt is the distributionmachine prompt (not macro-markets/`clouapp/front`).

- [ ] **Step 4: Full quality gate**

Run: `cd elixir && mise exec -- mix all`
Expected: format clean, credo clean, tests pass with coverage, dialyzer clean. Fix any failures before claiming done.

- [ ] **Step 5: Spec check for all changed public functions**

Run: `cd elixir && mise exec -- mix specs.check`
Expected: PASS

- [ ] **Step 6: Restart serve in per-project mode and verify DIS-1 picks up the right prompt**

Run (background): start serve per the project's normal `make serve` flow (no `SYMPHONY_WORKFLOW` needed).
Then confirm via the dashboard / logs that `distributionmachine` dispatches with its own prompt and that an issue moved to "In Progress" via the `set_issue_status` tool transitions correctly.

- [ ] **Step 7: Commit any rollout doc updates (if WORKFLOW files changed)**

```bash
cd /home/raphaelcangucu/symphony
git add elixir/WORKFLOW.distributionmachine.md
git commit -m "chore: finalize distributionmachine workflow for per-project orchestration"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-03-global-less-per-project-orchestration-design.md`):
- Touch point 1 (`Tracker.adapter/0` on `sync_enabled?`) → Task 1. ✔
- Touch point 2 (orchestrator per-project state sets) → Task 5. ✔
- Touch point 3 (`PromptBuilder` remove global fallback) → Task 3. ✔
- Touch point 4 (`ProjectConfig.resolve/1` code-default merge base) → Task 2. ✔
- Touch point 5 (`Config` code-default getters; drop `workflow_prompt/0`/`workflow_front_matter/0` reliance) → Tasks 2/3 remove the callers; Task 4 makes `default_agent_kind/0` global-independent. ✔ (`active_states/0`/`terminal_states/0` already return code defaults via the schema — verified in `config.ex`.)
- Touch point 6 (`dev/serve.exs` drop `SYMPHONY_WORKFLOW`) → Task 6. ✔
- Boot/backfill/discovery → Tasks 7 & 8. ✔
- Error handling/isolation (skip + warn) → Tasks 2 (`resolve_runnable`), 3 (tagged error), 5 (unresolved project not dispatched). The orchestrator-loop try/rescue around per-project dispatch is covered implicitly in Task 5 Step 5's guard; **explicitly verify** the dispatch loop wraps per-project work so one project raising does not abort the loop — add a `try/rescue` there if absent.
- Migration/rollout → Task 8. ✔

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Code shown for each code step. Where line numbers are referenced they are marked indicative and paired with `grep` locate steps.

**3. Type consistency:** `resolve_runnable/1 :: {:ok, t()} | {:skip, String.t()}` used identically in Tasks 2, 3, 5. `project_state_sets/1` returns `%{active:, terminal:, dispatch:, wait:}` (MapSets) used consistently in Task 5. `prompt_unresolved:` error tag matches the Task 3 test regex `~r/prompt_unresolved/`.

**Gap noted for the implementer:** Task 5 is the highest-risk change (large file, concurrent edits, reconciliation arity changes). If the orchestrator's dispatch path differs materially from the `~:550-567` helpers at implementation time, re-read the dispatch loop end-to-end before editing and keep the per-project resolver + `default_state_sets/0` fallback as the stable contract.
