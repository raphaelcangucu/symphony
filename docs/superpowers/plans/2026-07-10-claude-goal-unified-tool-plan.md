# Claude Goal + Unified `goal` Tool Implementation Plan

**Goal:** Add Claude Code native `/goal` support for authoring and execution, rename `manage_codex_goal` → `goal`, and route both Codex and Claude through an `AgentGoal` facade.

**Architecture:** `AgentGoal` resolves agent + context and dispatches to `Codex.GoalControl` / `AuthoringGoalControl` or new `Claude.GoalControl`. Claude goals live in workspace sidecars (`.symphony/claude-goal.json` / `claude-goal-authoring.json`) with a `pending_command` that `Claude.CodingAgent` injects as a `/goal …` or `/goal clear` prompt prefix on the next `--print` turn. Pause/resume/budget stay Codex-only (`unsupported_for_agent` on Claude). Cursor stays prompt-workflow only.

**Tech Stack:** Elixir (GoalControl, AgentRunner, CliRunner), Phoenix channel/HTTP goal APIs, React tracker UI (GoalPill, ExecutionControlComposer, IssueCreateDialog).

**Spec:** `docs/superpowers/specs/2026-07-10-claude-goal-unified-tool-design.md`

---

## File Structure

**Create**
- `elixir/lib/symphony_elixir/claude/goal_store.ex` — read/write/clear Claude goal sidecars
- `elixir/lib/symphony_elixir/claude/goal_control.ex` — get/set_objective/clear + unsupported actions + version gate
- `elixir/lib/symphony_elixir/agent_goal.ex` — facade: resolve agent, route actions by context
- `elixir/test/symphony_elixir/claude/goal_store_test.exs`
- `elixir/test/symphony_elixir/claude/goal_control_test.exs`
- `elixir/test/symphony_elixir/agent_goal_test.exs`

**Modify (Elixir)**
- `elixir/lib/symphony_elixir/assistant/goal_tools.ex` — tool name `goal`; call `AgentGoal`
- `elixir/lib/symphony_elixir/assistant/tool_executor.ex` — rename tool lists / `do_execute` / errors
- `elixir/lib/symphony_elixir/codex/dynamic_tool.ex` — rename tool constant + routing
- `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` — board allowlist
- `elixir/lib/symphony_elixir/assistant/agent_session.ex` — prompts + Claude authoring continuation
- `elixir/lib/symphony_elixir/assistant/authoring_goal_control.ex` — Claude authoring path
- `elixir/lib/symphony_elixir/claude/coding_agent.ex` — inject pending `/goal` prefix; resume-miss re-queue
- `elixir/lib/symphony_elixir/issue_dispatch.ex` — route Claude goals via `Claude.GoalControl`
- `elixir/lib/symphony_elixir/agent_execution.ex` — project Claude mirror as `kind: "goal"`, `source: "claude"`
- `elixir/lib/symphony_elixir/agent_availability.ex` — `claude_goal_supported?/0` semver gate
- `elixir/lib/symphony_elixir/prompt_builder.ex` — skip workflow section when Claude mirror is active
- `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` — agent-aware `goal_control`

**Modify (Tracker)**
- `tracker/src/types/agent-execution.ts` — `source: "native" | "prompt" | "claude"`
- `tracker/src/services/agentExecutions.ts` — normalize `"claude"` source
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx` — treat `source === "claude"` as controllable goal (edit/clear; no pause/resume unless caps say so)
- `tracker/src/components/issues/IssueCreateDialog.tsx` — Claude uses “goal” term (not “workflow”)
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — allow authoring `/goal` for Claude agent
- Locale keys if `issue.create.terms.workflow` is no longer used for Claude

**Tests to update**
- `elixir/test/symphony_elixir/assistant/goal_tools_test.exs`
- `elixir/test/symphony_elixir/dynamic_tool_test.exs`
- `elixir/test/symphony_elixir/issue_dispatch_*` (or add focused dispatch goal test)
- `elixir/test/symphony_elixir/agent_execution_*` / add projection test
- `elixir/test/symphony_elixir/assistant/agent_session_*` / authoring goal tests
- `tracker/src/components/issues/__tests__/IssueCreateDialog.goalMode.test.tsx`
- `tracker/src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx`
- `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx` (Claude `/goal` if gated today)

---

### Task 1: Claude goal sidecar store

**Files:**
- Create: `elixir/lib/symphony_elixir/claude/goal_store.ex`
- Test: `elixir/test/symphony_elixir/claude/goal_store_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Claude.GoalStoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.GoalStore

  setup do
    dir = Path.join(System.tmp_dir!(), "claude-goal-store-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{workspace: dir}
  end

  test "write/read execution goal with pending set", %{workspace: workspace} do
    assert :ok =
             GoalStore.put(workspace, :execution, %{
               "status" => "active",
               "objective" => "all auth tests pass",
               "pending_command" => "set"
             })

    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["status"] == "active"
    assert goal["objective"] == "all auth tests pass"
    assert goal["pending_command"] == "set"
    assert is_binary(goal["updated_at"])
  end

  test "authoring and execution files are independent", %{workspace: workspace} do
    :ok = GoalStore.put(workspace, :execution, %{"status" => "active", "objective" => "exec", "pending_command" => "set"})
    :ok = GoalStore.put(workspace, :authoring, %{"status" => "active", "objective" => "auth", "pending_command" => "set"})

    assert {:ok, %{"objective" => "exec"}} = GoalStore.read(workspace, :execution)
    assert {:ok, %{"objective" => "auth"}} = GoalStore.read(workspace, :authoring)
  end

  test "clear_pending keeps objective and status", %{workspace: workspace} do
    :ok = GoalStore.put(workspace, :execution, %{"status" => "active", "objective" => "x", "pending_command" => "set"})
    assert :ok = GoalStore.clear_pending(workspace, :execution)
    assert {:ok, goal} = GoalStore.read(workspace, :execution)
    assert goal["pending_command"] == nil
    assert goal["objective"] == "x"
  end

  test "delete removes sidecar", %{workspace: workspace} do
    :ok = GoalStore.put(workspace, :execution, %{"status" => "active", "objective" => "x", "pending_command" => nil})
    assert :ok = GoalStore.delete(workspace, :execution)
    assert GoalStore.read(workspace, :execution) == :error
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/claude/goal_store_test.exs`
Expected: FAIL — module `SymphonyElixir.Claude.GoalStore` missing

- [ ] **Step 3: Implement GoalStore**

```elixir
defmodule SymphonyElixir.Claude.GoalStore do
  @moduledoc false

  @execution_file ".symphony/claude-goal.json"
  @authoring_file ".symphony/claude-goal-authoring.json"
  @max_objective_bytes 4000

  @type role :: :execution | :authoring

  @spec path(Path.t(), role()) :: Path.t()
  def path(workspace, :execution), do: Path.join(workspace, @execution_file)
  def path(workspace, :authoring), do: Path.join(workspace, @authoring_file)

  @spec read(Path.t(), role()) :: {:ok, map()} | :error
  def read(workspace, role) when is_binary(workspace) and role in [:execution, :authoring] do
    with {:ok, contents} <- File.read(path(workspace, role)),
         {:ok, %{"goal" => goal}} <- Jason.decode(contents),
         true <- is_map(goal) do
      {:ok, normalize(goal)}
    else
      _ -> :error
    end
  end

  @spec put(Path.t(), role(), map()) :: :ok | {:error, term()}
  def put(workspace, role, attrs) when is_binary(workspace) and is_map(attrs) do
    with {:ok, goal} <- validate_attrs(attrs) do
      file = path(workspace, role)
      File.mkdir_p!(Path.dirname(file))
      payload = Jason.encode!(%{"goal" => Map.put(goal, "updated_at", DateTime.utc_now() |> DateTime.to_iso8601())})
      File.write(file, payload)
    end
  end

  @spec clear_pending(Path.t(), role()) :: :ok | {:error, term()}
  def clear_pending(workspace, role) do
    case read(workspace, role) do
      :error -> :ok
      {:ok, goal} -> put(workspace, role, Map.put(goal, "pending_command", nil))
    end
  end

  @spec delete(Path.t(), role()) :: :ok
  def delete(workspace, role) do
    case File.rm(path(workspace, role)) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp validate_attrs(attrs) do
    objective = attrs["objective"] || attrs[:objective]
    status = attrs["status"] || attrs[:status] || "active"
    pending = attrs["pending_command"] || attrs[:pending_command]

    cond do
      not is_binary(objective) or String.trim(objective) == "" ->
        {:error, :empty_objective}

      byte_size(String.trim(objective)) > @max_objective_bytes ->
        {:error, :objective_too_long}

      status not in ["active", "cleared", "achieved"] ->
        {:error, :invalid_status}

      pending not in [nil, "set", "clear"] ->
        {:error, :invalid_pending_command}

      true ->
        {:ok,
         %{
           "status" => status,
           "objective" => String.trim(objective),
           "pending_command" => pending,
           "cli_session_id" => attrs["cli_session_id"] || attrs[:cli_session_id]
         }}
    end
  end

  defp normalize(goal) when is_map(goal) do
    %{
      "status" => Map.get(goal, "status"),
      "objective" => Map.get(goal, "objective"),
      "pending_command" => Map.get(goal, "pending_command"),
      "updated_at" => Map.get(goal, "updated_at"),
      "cli_session_id" => Map.get(goal, "cli_session_id")
    }
  end
end
```

Note: for `clear` final state, allow `put` with `status: "cleared"` and empty objective via a dedicated `mark_cleared/2` that writes `{"status":"cleared","objective":null,"pending_command":null}` without going through `empty_objective` validation — implement `mark_cleared/2` in the same module and cover it in the test file.

- [ ] **Step 4: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/claude/goal_store_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/claude/goal_store.ex elixir/test/symphony_elixir/claude/goal_store_test.exs
git commit -m "feat(claude): add goal sidecar store for execution and authoring"
```

---

### Task 2: Version gate + Claude.GoalControl

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_availability.ex`
- Create: `elixir/lib/symphony_elixir/claude/goal_control.ex`
- Test: `elixir/test/symphony_elixir/claude/goal_control_test.exs`
- Test: extend or add `elixir/test/symphony_elixir/agent_availability_test.exs` if present

- [ ] **Step 1: Write failing GoalControl tests**

```elixir
defmodule SymphonyElixir.Claude.GoalControlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.GoalControl
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  setup do
    {:ok, _repo, _} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    SymphonyElixir.TestSupport.truncate_tracker!()
    {:ok, project} = Context.ensure_project(%{name: "G", slug: "goal-claude"})
    {:ok, issue} = Context.create_issue("goal-claude", %{"title" => "T", "status" => "Todo"})
    issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
    workspace = Workspace.path_for_issue(issue_ref)
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    # Force version gate open for unit tests
    Application.put_env(:symphony_elixir, :claude_goal_min_version, "0.0.0")
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_goal_min_version) end)

    %{project: project, issue: issue, workspace: workspace}
  end

  test "set_objective writes active mirror with pending set", %{project: project, issue: issue, workspace: workspace} do
    assert {:ok, goal} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert goal["status"] == "active"
    assert goal["pending_command"] == "set"
    assert {:ok, ^goal} = GoalStore.read(workspace, :execution)
  end

  test "clear queues pending clear then mark_cleared after consume helper", %{project: project, issue: issue} do
    {:ok, _} = GoalControl.set_objective(project, issue.identifier, :execution, "tests pass")
    assert {:ok, goal} = GoalControl.clear(project, issue.identifier, :execution)
    assert goal["pending_command"] == "clear"
  end

  test "pause is unsupported", %{project: project, issue: issue} do
    assert {:error, :unsupported_for_agent} = GoalControl.pause(project, issue.identifier, :execution)
  end

  test "rejects objective over 4000 bytes", %{project: project, issue: issue} do
    big = String.duplicate("a", 4001)
    assert {:error, :objective_too_long} = GoalControl.set_objective(project, issue.identifier, :execution, big)
  end
end
```

- [ ] **Step 2: Run to verify fail**

Run: `cd elixir && mix test test/symphony_elixir/claude/goal_control_test.exs`
Expected: FAIL — module missing

- [ ] **Step 3: Add version helpers to AgentAvailability**

```elixir
@claude_goal_min_version "2.1.139"

@spec claude_goal_supported?() :: boolean()
def claude_goal_supported? do
  min = Application.get_env(:symphony_elixir, :claude_goal_min_version, @claude_goal_min_version)
  case probe().claude do
    %{available: true, version: version} when is_binary(version) ->
      version_gte?(parse_semver(version), parse_semver(min))

    _ ->
      false
  end
end

defp parse_semver(text) when is_binary(text) do
  case Regex.run(~r/(\d+)\.(\d+)\.(\d+)/, text) do
    [_, a, b, c] -> {String.to_integer(a), String.to_integer(b), String.to_integer(c)}
    _ -> {0, 0, 0}
  end
end

defp version_gte?({a, b, c}, {x, y, z}) do
  cond do
    a > x -> true
    a < x -> false
    b > y -> true
    b < y -> false
    true -> c >= z
  end
end
```

- [ ] **Step 4: Implement Claude.GoalControl**

Public API (mirror Codex shape but role-aware):

```elixir
@spec get(Project.t(), String.t(), :execution | :authoring) :: {:ok, map() | nil} | {:error, term()}
@spec set_objective(Project.t(), String.t(), :execution | :authoring, String.t()) :: {:ok, map()} | {:error, term()}
@spec clear(Project.t(), String.t(), :execution | :authoring) :: {:ok, map() | :cleared} | {:error, term()}
@spec pause(Project.t(), String.t(), :execution | :authoring) :: {:error, :unsupported_for_agent}
@spec resume(Project.t(), String.t(), :execution | :authoring) :: {:error, :unsupported_for_agent}
@spec set_budget(Project.t(), String.t(), :execution | :authoring, pos_integer() | nil) :: {:error, :unsupported_for_agent}

@spec consume_pending(Path.t(), :execution | :authoring) ::
        {:inject, :set, String.t()} | {:inject, :clear} | :none
@spec acknowledge_inject(Path.t(), :execution | :authoring, :set | :clear) :: :ok | {:error, term()}
@spec requeue_set_if_active(Path.t(), :execution | :authoring) :: :ok | {:error, term()}
```

`set_objective` must:
1. Return `{:error, :claude_goal_unsupported_version}` when `not AgentAvailability.claude_goal_supported?()`
2. Ensure workspace exists (`Workspace.ensure` / path_for_issue + mkdir)
3. `GoalStore.put(..., pending_command: "set")`
4. Best-effort `Context.update_issue` / adapter to set `agent_goal` for execution role only

`clear` with no existing goal → `{:ok, :cleared}` (idempotent).

`consume_pending` returns inject instruction without clearing; `acknowledge_inject` clears pending (and on `:clear`, calls `GoalStore.mark_cleared`).

- [ ] **Step 5: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/claude/goal_control_test.exs test/symphony_elixir/agent_availability_test.exs`
Expected: PASS (create availability test for `version_gte?` / `claude_goal_supported?` with stubbed probe if needed)

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/claude/goal_control.ex elixir/lib/symphony_elixir/agent_availability.ex elixir/test/symphony_elixir/claude/goal_control_test.exs
git commit -m "feat(claude): GoalControl with mirror, pending inject, version gate"
```

---

### Task 3: AgentGoal facade

**Files:**
- Create: `elixir/lib/symphony_elixir/agent_goal.ex`
- Test: `elixir/test/symphony_elixir/agent_goal_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "routes execution set_objective to Claude.GoalControl when issue agent is claude"
test "routes execution set_objective to Codex.GoalControl when agent is codex"
test "cursor set_objective returns unsupported_for_agent"
test "claude pause returns unsupported_for_agent"
test "authoring context uses authoring role for Claude"
```

Resolve agent with this precedence:
1. Explicit `opts[:agent]` / issue `agent` / `agent_kind` settings
2. Default `"codex"`

```elixir
defmodule SymphonyElixir.AgentGoal do
  @spec execute(Project.t(), String.t(), String.t(), String.t(), map()) ::
          {:ok, map()} | {:error, term()}
  def execute(project, identifier, action, context, args \\ %{})

  # context in ["authoring", "execution"]
  # action in ["get", "set_objective", "pause", "resume", "clear", "set_budget"]
end
```

For Codex authoring, keep calling `AuthoringGoalControl` (needs thread) — facade may accept `opts[:thread]` for authoring Codex path. For Claude authoring, call `Claude.GoalControl` with `:authoring` and also update thread metadata via `History.set_goal_mode` when `opts[:thread]` is present (GoalTools / channel will pass thread when available).

Minimal v1 for GoalTools without thread: Claude authoring only needs workspace mirror keyed by issue; channel `set_goal_mode` still sets metadata separately.

- [ ] **Step 2: Implement + test + commit**

```bash
git commit -m "feat: add AgentGoal facade for codex/claude/cursor routing"
```

---

### Task 4: Rename `manage_codex_goal` → `goal`

**Files:**
- Modify: `goal_tools.ex`, `tool_executor.ex`, `dynamic_tool.ex`, `project_board_tools.ex`, `agent_session.ex` (prompt strings)
- Modify tests: `goal_tools_test.exs`, `dynamic_tool_test.exs`

- [ ] **Step 1: Update failing assertions first**

Change every `"manage_codex_goal"` expectation to `"goal"`.

Update `@tool "goal"` and description:

```text
Set, adjust, pause, resume, clear, or inspect a long-running agent goal.

Codex uses the native thread goal API. Claude Code uses native /goal (completion
condition) mirrored by Symphony. pause/resume/set_budget are Codex-only.

Use context "authoring" for the issue assistant conversation goal.
Use context "execution" for the orchestrator execution goal.
```

Wire `GoalTools.execute` through `AgentGoal.execute/5` instead of calling Codex modules directly.

- [ ] **Step 2: Run**

Run: `cd elixir && mix test test/symphony_elixir/assistant/goal_tools_test.exs test/symphony_elixir/dynamic_tool_test.exs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(assistant): rename manage_codex_goal tool to goal"
```

---

### Task 5: Inject `/goal` on Claude turns + resume re-queue

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/coding_agent.ex`
- Test: `elixir/test/symphony_elixir/claude/coding_agent_goal_inject_test.exs` (new; prefer unit-testing a pure helper)

- [ ] **Step 1: Extract pure helper and test it**

In `Claude.GoalControl` or `Claude.CodingAgent`:

```elixir
@spec apply_pending_to_prompt(String.t(), Path.t(), :execution | :authoring) ::
        {String.t(), :set | :clear | :none}
def apply_pending_to_prompt(prompt, workspace, role) do
  case GoalControl.consume_pending(workspace, role) do
    {:inject, :set, objective} ->
      {"/goal #{objective}\n\n" <> prompt, :set}

    {:inject, :clear} ->
      {"/goal clear\n\n" <> prompt, :clear}

    :none ->
      {prompt, :none}
  end
end
```

After successful `CliRunner.run_turn`, call `acknowledge_inject`. On `{:error, {:resume_session_not_found, _}}` retry path: call `GoalControl.requeue_set_if_active(workspace, role)` before starting the fresh session.

Role selection: default `:execution` for orchestrator; pass `:authoring` from `AgentSession` via session metadata / opts (`:goal_role`).

- [ ] **Step 2: Wire into `run_turn/4` before `CliRunner.run_turn`**

```elixir
role = Keyword.get(opts, :goal_role, :execution)
{prompt, pending} = apply_pending_to_prompt(prompt, session.workspace, role)
# ... run_turn ...
# on success: if pending != :none, GoalControl.acknowledge_inject(...)
```

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "feat(claude): inject /goal and /goal clear from pending mirror"
```

---

### Task 6: Dispatch + PromptBuilder + AgentExecution projection

**Files:**
- Modify: `elixir/lib/symphony_elixir/issue_dispatch.ex`
- Modify: `elixir/lib/symphony_elixir/prompt_builder.ex`
- Modify: `elixir/lib/symphony_elixir/agent_execution.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex` (`goal_control`)
- Tests: dispatch + agent_execution focused tests

- [ ] **Step 1: IssueDispatch**

Replace Codex-only routing with:

```elixir
defp maybe_route_agent_goal(project, identifier, opts, "codex") do
  # existing GoalControl.set_objective when goal present
end

defp maybe_route_agent_goal(project, identifier, opts, "claude") do
  case normalize_optional_string(Map.get(opts, :goal) || Map.get(opts, "goal")) do
    nil -> :ok
    objective ->
      case Claude.GoalControl.set_objective(project, identifier, :execution, objective) do
        {:ok, _} -> :ok
        {:error, reason} -> {:error, reason}
      end
  end
end

defp maybe_route_agent_goal(_project, _identifier, _opts, _other), do: :ok
```

Rename call site from `maybe_route_codex_goal` → `maybe_route_agent_goal`.

Keep `maybe_update_agent` behavior: for Claude, still OK to persist `agent_goal` as read mirror; for Codex keep `goal_attr = nil`.

- [ ] **Step 2: PromptBuilder**

Skip `workflow_guidance_section` for Claude when `GoalStore.read(workspace, :execution)` is `{:ok, %{"status" => "active"}}` — pass workspace into builder or read from issue path. Prefer: if Claude mirror active, return `""` so the objective is not duplicated (native `/goal` owns it).

- [ ] **Step 3: AgentExecution.build_goal**

```elixir
defp goal_kind(%{agent_kind: "claude"}), do: "goal"  # when mirror present; else workflow
defp goal_source("goal", "claude"), do: "claude"
defp goal_capabilities("goal", "claude"), do: ["get", "edit", "clear"]
```

Read objective from `Claude.GoalStore.read(workspace, :execution)` when agent is claude; fall back to `agent_goal` workflow only if no mirror.

Update TypeScript:

```ts
export type AgentExecutionGoalSource = "native" | "prompt" | "claude";
```

- [ ] **Step 4: HTTP `goal_control`**

In `IssueController.run_goal_action`, resolve issue agent; if claude, call `Claude.GoalControl`; if codex, existing; else validation error for mutations.

- [ ] **Step 5: Tests + commit**

```bash
git commit -m "feat: route Claude execution goals through GoalControl and project UI kind"
```

---

### Task 7: Authoring path for Claude

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/authoring_goal_control.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (if goal events assume Codex)
- Tests: authoring goal + agent_session continue

- [ ] **Step 1: Remove `:goal_not_native` for Claude**

In `continue_issue_goal/3`:

```elixir
agent_kind not in [nil, "codex", :codex, "claude", :claude] ->
  {:error, :goal_not_native}
```

- [ ] **Step 2: `maybe_put_authoring_goal`**

For Claude: ensure `Claude.GoalControl.set_objective(project, identifier, :authoring, objective)` when enabling; pass `goal_role: :authoring` into runner opts. Do **not** set Codex `:goal` keyword.

For Codex: keep existing native goal injection.

- [ ] **Step 3: AuthoringGoalControl**

When thread agent is Claude (from `History.agent_thread_ids` / preference):
- `set_objective` / `status` / `clear` → Claude.GoalControl authoring role + metadata
- `pause` / `resume` → `{:error, :unsupported_for_agent}`
- capabilities list for Claude authoring: `["get", "edit", "clear"]`

When Codex: unchanged.

- [ ] **Step 4: Channel `set_goal_mode`**

Allow enabling goal mode when effective agent is Claude (remove any Codex-only UI/server gate if present). On enable with objective, call AuthoringGoalControl.set_objective.

- [ ] **Step 5: Tests + commit**

```bash
git commit -m "feat(assistant): Claude authoring goals via /goal inject"
```

---

### Task 8: Tracker UI

**Files:**
- `tracker/src/types/agent-execution.ts`
- `tracker/src/services/agentExecutions.ts`
- `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- `tracker/src/components/issues/IssueCreateDialog.tsx`
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (if agent gate exists)
- Tests listed in File Structure

- [ ] **Step 1: Types + normalizer**

Accept `source: "claude"`. Treat controllable goal as:

```ts
const controllableGoal =
  execution?.goal?.kind === "goal" &&
  (execution.goal.source === "native" || execution.goal.source === "claude");
```

Pause/resume only when `capabilities.includes("pause"|"resume")`.

- [ ] **Step 2: IssueCreateDialog**

Change `longRunningModeTerm` so only Cursor uses “workflow”; Claude and Codex use “goal”:

```ts
function longRunningModeTerm(agent: AgentKind, t: TFunction): string {
  return agent === "cursor" ? t("issue.create.terms.workflow") : t("issue.create.terms.goal");
}
```

Ensure create payload still sends `goal` for Claude (today `issues.ts` may only attach goal for Codex — fix):

```ts
// tracker/src/services/issues.ts
if ((input.agent === "codex" || input.agent === "claude") && input.goal?.trim()) {
  payload.goal = input.goal.trim();
}
```

- [ ] **Step 3: Authoring panel**

If `/goal` or GoalPill is gated on Codex-only agent, widen to Claude. Add/adjust test that Claude agent can submit `/goal`.

- [ ] **Step 4: Run UI tests**

Run: `cd tracker && npm test -- --run IssueCreateDialog.goalMode ExecutionControlComposer ProjectAssistantPanel`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tracker): Claude goal UI parity for create, execution, authoring"
```

---

### Task 9: Verification gate

- [ ] **Step 1: Elixir suite for touched areas**

Run:

```bash
cd elixir && mix test \
  test/symphony_elixir/claude/goal_store_test.exs \
  test/symphony_elixir/claude/goal_control_test.exs \
  test/symphony_elixir/agent_goal_test.exs \
  test/symphony_elixir/assistant/goal_tools_test.exs \
  test/symphony_elixir/dynamic_tool_test.exs
```

Expected: PASS

- [ ] **Step 2: Manual smoke (optional but recommended)**

1. Issue with agent Claude, Execution `/goal all tests pass` → sidecar has `pending_command: set`
2. Resume run → prompt file / logs show `/goal …` prefix once
3. Clear goal → next turn shows `/goal clear`
4. Assistant authoring `/goal` with Claude agent → authoring sidecar updated; no orchestrator dispatch
5. Codex path still pause/resume/budget

- [ ] **Step 3: Final commit if docs/comments needed**

```bash
git commit -m "docs: note Claude /goal requires CLI >= 2.1.139"
```

Only if README/workflow docs need a one-liner; otherwise skip.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Rename tool → `goal` | Task 4 |
| AgentGoal facade | Task 3 |
| Claude mirror sidecars | Task 1 |
| pending `/goal` inject | Task 5 |
| unsupported pause/resume/budget | Task 2 |
| version gate 2.1.139 | Task 2 |
| execution dispatch routing | Task 6 |
| authoring + execution surfaces | Tasks 5–7 |
| UI kind/source/capabilities | Tasks 6, 8 |
| Cursor unsupported mutations | Task 3 |
| Resume-miss re-queue | Task 5 |
| No Haiku reimplementation | (by design, all tasks) |
| No Cursor native goal | (by design) |

## Notes for the implementer

- Prefer small commits per task; do not combine rename with Claude inject in one commit.
- When editing `AuthoringGoalControl`, keep Codex path byte-compatible; branch on agent early.
- `achieved` auto-detection is **out of v1** — mirror stays `active` until clear/replace.
- UI `source: "claude"` (not `"native"`) per spec open point.
