# Tracker Agent Tools — Phase 1 Implementation Plan

**Goal:** Ship assistant + coding-agent tools for handoff diagnostics, evidence
status, workpad comments, preview control, project setup scan/suggest, and
dev-env setup/serve — reusing existing backend modules without changing gate or
dev-server semantics.

**Architecture:** Five focused modules under `SymphonyElixir.Assistant.*Tools`
implement `tool_specs/0` + `execute/3`. `ToolExecutor` delegates project-scoped
calls; `DynamicTool.coding_agent_tool_specs/0` adds issue-bound variants.
`PreviewTools` replaces inline `manage_preview` logic in `ToolExecutor`.
`ProjectBoardTools` exposes setup/dev-env tools to freeform chat with
`project_slug`.

**Tech Stack:** Elixir 1.19 / OTP 28, ExUnit, Ecto/SQLite, existing
`AgentHandoffGate`, `Evidence.*`, `DevServer.*`, `DevEnv`, `RepositoryScanner`,
`WorkflowSuggester`.

**Spec:** `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md`
(Phase 1 only; Phase 2/3 deferred).

**Out of scope for this plan:** `link_pull_request`, orchestrator debug tools,
blockers, sync, `mix symphony.tracker` CLI, daemon boot via tools.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `elixir/lib/symphony_elixir/assistant/handoff_tools.ex` | Create | `check_handoff_gate` |
| `elixir/lib/symphony_elixir/assistant/evidence_tools.ex` | Create | `get_evidence_status` |
| `elixir/lib/symphony_elixir/assistant/preview_tools.ex` | Create | `manage_preview` (extracted + enriched view) |
| `elixir/lib/symphony_elixir/assistant/dev_env_tools.ex` | Create | `manage_dev_env` |
| `elixir/lib/symphony_elixir/assistant/setup_tools.ex` | Create | `scan_project_setup`, `suggest_project_setup` |
| `elixir/lib/symphony_elixir/assistant/tool_executor.ex` | Modify | Register tools; delegate; comment list/update |
| `elixir/lib/symphony_elixir/codex/dynamic_tool.ex` | Modify | Issue-bound gate/evidence/preview/dev-env tools |
| `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` | Modify | Freeform specs for setup + dev-env |
| `elixir/lib/symphony_elixir/assistant/codex_session.ex` | Modify | System prompt tool list |
| `elixir/test/symphony_elixir/assistant/handoff_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/evidence_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/preview_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/dev_env_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/setup_tools_test.exs` | Create | Unit tests |
| `elixir/test/symphony_elixir/assistant/tool_executor_test.exs` | Modify | Integration tests |
| `elixir/test/symphony_elixir/dynamic_tool_test.exs` | Modify | Coding-agent tool tests |
| `skills/evidence/SKILL.md` | Modify | Reference new tools |
| `skills/workpad/SKILL.md` | Modify | Assistant comment tools |
| `skills/workflow/SKILL.md` | Modify | Setup scan/suggest/dev-env flow |
| `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md` | Modify | Status → Accepted |

---

### Task 1: `HandoffTools` — `check_handoff_gate`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/handoff_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/handoff_tools_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.HandoffToolsTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.Issue
  alias SymphonyElixir.ProjectConfig

  @moduletag :tmp_dir

  defp config(overrides \\ []) do
    struct!(
      ProjectConfig,
      Keyword.merge(
        [
          project_slug: "gam",
          wait_states: ["Human Review"],
          completion_transitions: %{"In Progress" => "Human Review"},
          evidence: %{required: false, repos: %{}}
        ],
        overrides
      )
    )
  end

  test "returns ready when both gates pass" do
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}

    assert {:ok, result} =
             HandoffTools.execute("gam", %{"identifier" => "GAM-1"},
               issue: issue,
               project_config: config(),
               workspace: "/tmp/ws"
             )

    assert result.tool == "check_handoff_gate"
    assert result.data.ready == true
    assert result.data.validate_gate.satisfied == true
    assert result.data.publish_gate.satisfied == true
    assert "Human Review" in result.data.target_statuses.wait_states
  end

  test "returns validate violations when manifest missing", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b feat && mkdir -p src && echo x > src/App.tsx && git add -A && git commit -m w")

    issue = %Issue{id: "1", identifier: "GAM-9", project_slug: "gam"}
    cfg = config(evidence: %{required: true, repos: %{"frontend" => %{unit_command: "yarn test"}}})

    assert {:ok, result} =
             HandoffTools.execute("gam", %{"identifier" => "GAM-9"},
               issue: issue,
               project_config: cfg,
               workspace: ws
             )

    assert result.data.ready == false
    assert result.data.validate_gate.satisfied == false
    assert Enum.any?(result.data.validate_gate.violations, &(&1.kind == "manifest_missing"))
  end
end
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir/assistant/handoff_tools_test.exs`
Expected: `HandoffTools` module not defined

- [ ] **Step 3: Add `AgentHandoffGate.check_validate/3` and `check_publish/3`**

Expose thin public wrappers (delegate to existing private functions) so
`HandoffTools` can report validate and publish independently:

```elixir
# agent_handoff_gate.ex
@spec check_validate(map(), ProjectConfig.t(), keyword()) :: :ok | {:error, :validate_gate, [violation()]}
def check_validate(issue, config, opts \\ []), do: check_validate(Workspace.path_for_issue_or_opt(issue, opts), config)

@spec check_publish(map(), ProjectConfig.t(), keyword()) :: :ok | {:error, :publish_gate, [violation()]}
def check_publish(issue, config, opts \\ []), do: check_publish(Workspace.path_for_issue_or_opt(issue, opts))
```

Add one test in `agent_handoff_gate_test.exs` per wrapper.

- [ ] **Step 4: Implement `HandoffTools`**

```elixir
defmodule SymphonyElixir.Assistant.HandoffTools do
  @moduledoc false

  alias SymphonyElixir.{AgentHandoffGate, Issue, ProjectConfig, Workspace}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @tool "check_handoff_gate"

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_spec(), issue_bound_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) do
    with {:ok, issue} <- resolve_issue(project_slug, arguments, opts),
         {:ok, config} <- load_config(project_slug, opts),
         workspace <- workspace_for(issue, opts),
         validate <- AgentHandoffGate.check_validate(issue, config, workspace: workspace),
         publish <- AgentHandoffGate.check_publish(issue, config, workspace: workspace) do
      {:ok, present(config, issue.identifier, validate, publish)}
    end
  end

  defp present(config, identifier, validate, publish) do
    validate_ok = validate == :ok
    publish_ok = publish == :ok
    validate_violations = violations(validate)
    publish_violations = violations(publish)

    %{
      tool: @tool,
      message: gate_message(identifier, validate_ok and publish_ok),
      data: %{
        ready: validate_ok and publish_ok,
        target_statuses: target_statuses(config),
        validate_gate: gate_payload(validate_ok, validate_violations),
        publish_gate: gate_payload(publish_ok, publish_violations),
        environment_blocked_only: Evidence.Gate.environment_blocked_only?(validate_violations)
      }
    }
  end
end
```

`resolve_issue/3`: use `opts[:issue]` when present (coding agent), else
`Context.get_issue(project_slug, identifier)`.

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/assistant/handoff_tools_test.exs test/symphony_elixir/agent_handoff_gate_test.exs`

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_handoff_gate.ex \
  elixir/lib/symphony_elixir/assistant/handoff_tools.ex \
  elixir/test/symphony_elixir/assistant/handoff_tools_test.exs
git commit -m "feat(assistant): check_handoff_gate tool module"
```

---

### Task 2: `EvidenceTools` — `get_evidence_status`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/evidence_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/evidence_tools_test.exs`

- [ ] **Step 1: Write failing tests**

Cover:
- `evidence.required == false` → `gate.satisfied == true`, empty violations
- missing manifest + required true → violations in `data.gate`
- `Evidence.Store.list/2` runs included in `data.runs` (mock Store via opts)
- `workspace_path` + `manifest_path` fields present

- [ ] **Step 2: Run — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir/assistant/evidence_tools_test.exs`

- [ ] **Step 3: Implement**

Reuse presenter logic from `EvidenceController.present/1` for run shape.
Gate evaluation: `Evidence.Gate.evaluate(workspace, evidence_config)`.

Issue-bound spec: empty `inputSchema` (like `list_comments` in DynamicTool).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): get_evidence_status tool module"
```

---

### Task 3: Assistant comment tools — `list_comments` / `update_comment`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
  test "list_comments returns issue comments" do
    {:ok, _} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, issue} = Context.create_issue("macro-markets", %{"title" => "T", "status" => "Todo"})
    {:ok, _} = Context.add_comment("macro-markets", issue.identifier, "## Codex Workpad\nhi", %{})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "list_comments", %{"identifier" => issue.identifier})

    assert result.tool == "list_comments"
    assert length(result.data.comments) == 1
    assert hd(result.data.comments).body =~ "Workpad"
  end

  test "update_comment edits an existing comment" do
    {:ok, _} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, issue} = Context.create_issue("macro-markets", %{"title" => "T", "status" => "Todo"})
    {:ok, comment} = Context.add_comment("macro-markets", issue.identifier, "old", %{})

    assert {:ok, result} =
             ToolExecutor.execute("macro-markets", "update_comment", %{
               "identifier" => issue.identifier,
               "comment_id" => comment.id,
               "body" => "new body"
             })

    assert result.data.comment.body == "new body"
  end
```

- [ ] **Step 2: Run — expect FAIL** (`unsupported_tool`)

- [ ] **Step 3: Implement in `ToolExecutor`**

Add to `@tracker_tools`: `list_comments`, `update_comment`.

Add `tool_spec/3` entries mirroring DynamicTool descriptions.

`do_execute/4`:

```elixir
defp do_execute(project, "list_comments", arguments, _opts) do
  with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
       {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [identifier]) do
    presented = Enum.map(comments, &TrackerPresenter.comment/1)
    {:ok, %{tool: "list_comments", message: "Found #{length(presented)} comment(s).", data: %{comments: presented}}}
  end
end

defp do_execute(project, "update_comment", arguments, _opts) do
  with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
       {:ok, comment_id} <- normalize_comment_id(Map.get(arguments, "comment_id")),
       {:ok, body} <- normalize_required_string(Map.get(arguments, "body"), :body),
       {:ok, comment} <- IssueAdapter.dispatch(project, :update_comment, [identifier, comment_id, body]) do
    {:ok, %{tool: "update_comment", message: "Updated comment on #{identifier}.", data: %{comment: TrackerPresenter.comment(comment)}}}
  end
end
```

Copy `normalize_comment_id/1` from `DynamicTool` or extract to shared `Assistant.CommentTools` helper if duplication exceeds ~10 lines.

- [ ] **Step 4: Run — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): list_comments and update_comment tools"
```

---

### Task 4: `PreviewTools` — extract + enrich `manage_preview`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/preview_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/preview_tools_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex` (delegate)

- [ ] **Step 1: Write failing test for enriched status view**

```elixir
test "status includes serve_steps_configured and next_steps when no serve step" do
  {:ok, project} = Context.ensure_project(%{name: "P", slug: "preview-proj"})
  # workflow without dev_server enabled OR no serve steps — stub Context.get_project + DevEnv.list_serve_steps

  assert {:ok, result} =
           PreviewTools.execute("preview-proj", %{"identifier" => "P-1", "action" => "status"},
             dev_env_list_serve_steps: fn _ -> [] end,
             issue_targets: fn _, _ -> {:ok, %{available: false, reason: :no_serve_step, servers: []}} end
           )

  assert result.data.serve_steps_configured == false
  assert result.data.next_steps =~ "manage_dev_env"
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Move logic from `ToolExecutor` `do_execute("manage_preview", …)` into `PreviewTools`**

Add fields to returned `data`:
- `serve_steps_configured: DevEnv.list_serve_steps(slug) != []`
- `next_steps: hint_string(reason)` when `available: false`
- Ensure each server map includes `url`, `port`, `status`, `repo` (pass through Manager list)

Issue-bound spec: `{ "action": "status|start|stop|restart" }` only.

- [ ] **Step 4: Replace inline handler in `ToolExecutor` with `PreviewTools.execute/3`**

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/assistant/preview_tools_test.exs test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(assistant): PreviewTools with enriched manage_preview diagnostics"
```

---

### Task 5: `SetupTools` — scan + suggest

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/setup_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/setup_tools_test.exs`

- [ ] **Step 1: Write failing tests**

- `scan_project_setup` loads repos from `Context.list_repositories/1` when `repositories` omitted
- `suggest_project_setup` calls `WorkflowSuggester.suggest/1` with scans
- `suggest_project_setup` runs implicit scan when `scans` omitted (inject scanner via opts in test)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.SetupTools do
  alias SymphonyElixir.LocalTracker.{Context, RepositoryScanner, WorkflowSuggester}

  @tools ~w(scan_project_setup suggest_project_setup)

  def execute("scan_project_setup", project_slug, arguments, opts) do
    repos = Map.get(arguments, "repositories") || repositories_for_project(project_slug)
    scans = Enum.map(repos, fn repo -> scan_repo(repo, opts) end)
    {:ok, %{tool: "scan_project_setup", message: "...", data: %{scans: scans}}}
  end

  def execute("suggest_project_setup", project_slug, arguments, opts) do
    scans = Map.get(arguments, "scans") || implicit_scan(project_slug, arguments, opts)
    repos = Map.get(arguments, "repositories") || repositories_for_project(project_slug)
    {:ok, suggestion} = WorkflowSuggester.suggest(%{repositories: repos, scans: scans})
    {:ok, %{tool: "suggest_project_setup", message: "...", data: suggestion}}
  end
end
```

Map repository structs to maps expected by `RepositoryScanner.scan/1` (mirror
`ProjectSetupController.scan/2`).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): scan_project_setup and suggest_project_setup tools"
```

---

### Task 6: `DevEnvTools` — `manage_dev_env`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/dev_env_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/dev_env_tools_test.exs`

- [ ] **Step 1: Write failing tests**

Mirror `DevEnvControllerTest` flows via tools:
- `list_steps` on empty project → `[]`
- `save_steps` + `list_steps` round-trip (assistant mode)
- `propose_steps` returns list
- `run_step` with invalid id → error
- **Coding-agent subset:** `execute(..., coding_agent: true)` rejects `save_steps` and `propose_steps` with `{:error, :action_not_allowed}`

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Delegate to `DevEnv` + `DevEnv.Runner` + `DevEnvPresenter` (same as controller).

Action parsing mirrors `normalize_preview_action` style.

For `run`: copy sequential loop from `DevEnvController.run/2`.

Optional `category_filter`: when set, filter steps before `run` (coding agents pass `"serve"`).

```elixir
@assistant_actions ~w(list_steps propose_steps save_steps run run_step list_runs)
@coding_agent_actions ~w(list_steps run run_step list_runs)

def allowed_actions?(opts) do
  if Keyword.get(opts, :coding_agent, false), do: @coding_agent_actions, else: @assistant_actions
end
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/assistant/dev_env_tools_test.exs test/symphony_elixir_web/controllers/tracker/dev_env_controller_test.exs`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): manage_dev_env tool module"
```

---

### Task 7: Wire `ToolExecutor` + `ProjectBoardTools`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/project_board_tools.ex`
- Modify: `elixir/test/symphony_elixir/assistant/project_board_tools_test.exs`

- [ ] **Step 1: Write failing test — new tools appear in specs**

```elixir
test "tool_specs includes phase 1 agent tools" do
  names = ToolExecutor.tool_specs() |> Enum.map(& &1["name"])

  for tool <- ~w(check_handoff_gate get_evidence_status list_comments update_comment manage_dev_env scan_project_setup suggest_project_setup) do
    assert tool in names
  end
end

test "freeform specs include setup and dev_env with project_slug" do
  names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"])
  assert "manage_dev_env" in names
  assert "scan_project_setup" in names

  dev_env = Enum.find(ToolExecutor.freeform_tool_specs(), &(&1["name"] == "manage_dev_env"))
  assert "project_slug" in dev_env["inputSchema"]["required"]
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire delegation**

In `ToolExecutor`:
- Add new tool names to `@tracker_tools` (except setup tools if global-only — put setup in `@discovery_tools` or separate `@setup_tools`)
- `tool_specs/0` append `HandoffTools`, `EvidenceTools`, `DevEnvTools`, `SetupTools` specs (assistant variants)
- `do_execute/4` clauses delegate to module `execute/3`
- `freeform_codex_tool_executor/1` route `SetupTools` + `DevEnvTools` through `ProjectBoardTools` or direct execute with `project_slug` from arguments

In `ProjectBoardTools`:
- Add `@scoped_tools` entries: `check_handoff_gate`, `get_evidence_status`, `list_comments`, `update_comment`, `manage_dev_env`, `scan_project_setup`, `suggest_project_setup`
- `manage_preview` already scoped

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): wire phase 1 tools into ToolExecutor and ProjectBoardTools"
```

---

### Task 8: Wire `DynamicTool` for coding agents

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/dynamic_tool.ex`
- Modify: `elixir/test/symphony_elixir/dynamic_tool_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "coding_agent_tool_specs includes gate evidence preview and dev_env tools" do
  names = DynamicTool.coding_agent_tool_specs() |> Enum.map(& &1["name"])

  assert "check_handoff_gate" in names
  assert "get_evidence_status" in names
  assert "manage_preview" in names
  assert "manage_dev_env" in names
  refute "scan_project_setup" in names
end

test "manage_dev_env rejects save_steps for coding agent" do
  issue = %Issue{identifier: "GAM-1", project_slug: "gam"}
  response = DynamicTool.execute("manage_dev_env", %{"action" => "save_steps", "steps" => []}, issue: issue)
  assert response["success"] == false
end

test "check_handoff_gate uses bound issue without identifier argument" do
  issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam", ...}
  response = DynamicTool.execute("check_handoff_gate", %{}, issue: issue)
  assert response["success"] == true
  assert response["toolResult"]["data"]["ready"] in [true, false]
end
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

In `execute/3` add clauses routing to shared modules with `coding_agent: true` in opts.

Append issue-bound specs to `coding_agent_tool_specs/0` (not `tool_specs/0` — keep GraphQL-only there).

`manage_preview` → `PreviewTools.execute(project_slug, Map.put(args, "identifier", issue.identifier), issue: issue)`

- [ ] **Step 4: Run — expect PASS**

Run: `cd elixir && mix test test/symphony_elixir/dynamic_tool_test.exs`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(coding-agent): expose gate, evidence, preview, and dev_env tools via MCP"
```

---

### Task 9: Prompts and skills

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Modify: `skills/evidence/SKILL.md`
- Modify: `skills/workpad/SKILL.md`
- Modify: `skills/workflow/SKILL.md`

- [ ] **Step 1: Update `build_issue_prompt` / agent system sections**

Add bullet list:
- Before handoff status: `check_handoff_gate`
- After manifest: `get_evidence_status`
- Before UI e2e: `manage_dev_env` serve steps + `manage_preview(start|status)`
- Workpad: `list_comments` / `update_comment`

- [ ] **Step 2: Update skills** (short sections — tool names + when to call)

- [ ] **Step 3: Run prompt tests**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs test/symphony_elixir/assistant/codex_session_agent_test.exs`

Update assertions if prompt snapshots include tool names.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(agent): reference phase 1 tools in prompts and skills"
```

---

### Task 10: Final verification + spec status

- [ ] **Step 1: Run full Elixir quality gate**

Run: `cd elixir && make all`
Expected: format, lint, tests, coverage, dialyzer pass

- [ ] **Step 2: Run specs check**

Run: `cd elixir && mix specs.check`
Expected: no missing `@spec` on new public `def` in `lib/`

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md` change
`Status: Proposed` → `Status: Accepted (Phase 1 plan: 2026-06-17-tracker-agent-tools-phase-1.md)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-17-tracker-agent-tools-design.md docs/superpowers/plans/2026-06-17-tracker-agent-tools-phase-1.md
git commit -m "docs: accept tracker agent tools spec and add phase 1 plan"
```

---

## Spec coverage checklist (Phase 1)

| Spec requirement | Task |
|------------------|------|
| `check_handoff_gate` A+B | Task 1, 7, 8 |
| `get_evidence_status` A+B | Task 2, 7, 8 |
| `list_comments` / `update_comment` B | Task 3, 7 |
| `manage_preview` extend A+B | Task 4, 7, 8 |
| `scan_project_setup` / `suggest_project_setup` B | Task 5, 7 |
| `manage_dev_env` A+B subset | Task 6, 7, 8 |
| Prompt/skill updates | Task 9 |
| No daemon boot tool | Out of scope (unchanged) |
| Phase 2/3 tools | Not in this plan |

---

## Execution notes

- Keep modules `@moduledoc false` to match sibling `DiscoveryTools`.
- Inject dependencies via `opts` in tests (`workspace:`, `project_config:`, `issue:`) — do not bypass gates in production code paths.
- When extracting comment ID normalization, prefer a tiny `SymphonyElixir.Assistant.CommentHelpers` module if both `ToolExecutor` and `DynamicTool` need it.
- If `HandoffTools` publish-on-validate-failure logic is awkward, add `AgentHandoffGate.check_validate/3` and `check_publish/3` as thin public wrappers (preferred over duplicating RunContract calls).
