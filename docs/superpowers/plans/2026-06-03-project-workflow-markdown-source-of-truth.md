# Per-Project Workflow Markdown + Remove Global WORKFLOW.md — Implementation Plan

**Goal:** Make per-project behavior live in a single `workflow_markdown` text blob
(DB, edited in the tracker UI), delete the process-global `WORKFLOW.md` entirely,
and re-home process settings to `config/runtime.exs` + `SYMPHONY_*` env.

**Architecture:** Three ownership buckets — (1) connection/identity in DB columns
via a small form, (2) per-project behavior in `workflow_markdown` (YAML front
matter + prompt body) resolved by `ProjectConfig`, (3) process settings in
`runtime.exs`/env read by `SymphonyElixir.Config`. Agent (Codex/Claude) selection
is resolved by precedence: per-task (label) > assistant choice > per-project
default > process default. Discovery, `WorkflowStore`, single-project mode, and all
`WORKFLOW*.md` files are removed. Shipped as one change.

**Tech Stack:** Elixir/Phoenix, Ecto/SQLite, NimbleOptions (front-matter schema),
Solid (prompt templating), YamlElixir; React/TypeScript tracker (Vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-06-03-project-workflow-markdown-source-of-truth-design.md`

---

## File Structure

Backend (create):
- `priv/repo/migrations/<ts>_add_workflow_markdown_and_drop_legacy_setup_columns.exs`
- `config/runtime.exs` — process settings from env
- `lib/symphony_elixir/instance_config.ex` — typed process-settings accessors (env)
- `lib/mix/tasks/symphony.workflows.export.ex` — optional export DB→markdown

Backend (modify):
- `lib/symphony_elixir/workflow.ex` — add `parse_string/1`; drop global load/store helpers
- `lib/symphony_elixir/config.ex` — process accessors read env; keep front-matter schema; add `parse_workflow_markdown/1`
- `lib/symphony_elixir/project_config.ex` — resolve from `workflow_markdown`; expose codex/claude/agent/dev_server/hooks
- `lib/symphony_elixir/local_tracker/project_setup.ex` — schema: add `workflow_markdown`, drop legacy
- `lib/symphony_elixir/local_tracker/context.ex` — `upsert_project_setup` accepts markdown
- `lib/symphony_elixir/prompt_builder.ex` — already DB-based; adjust resolve
- `lib/symphony_elixir/agent_routing.ex` + `agent_runner.ex` + `coding_agent.ex` — per-project default kind
- `lib/symphony_elixir/codex/config.ex`, `claude/config.ex` — accept resolved per-project block
- `lib/symphony_elixir/orchestrator.ex` — per-project completion_transitions, concurrency, timeouts; process accessors via `InstanceConfig`
- `lib/symphony_elixir/shared_supervisor.ex` — remove `WorkflowStore`
- `lib/symphony_elixir.ex` (Application) — remove discovery boot call
- `lib/symphony_elixir_web/controllers/tracker/project_controller.ex` — `workflow_markdown` in setup
- `lib/symphony_elixir/workspace.ex`, `dev_server/*`, `editor*`, `http_server.ex`, `status_dashboard.ex`, `observability/reporter.ex` — read `InstanceConfig`
- `dev/serve.exs`, `lib/symphony_elixir/cli.ex`, `lib/mix/tasks/symphony.ctl.ex`, `Makefile` — drop global file requirement
- `test/support/test_support.exs` — process settings via env + project-with-markdown helpers

Backend (delete):
- `lib/symphony_elixir/workflow_store.ex`, `lib/symphony_elixir/workflow_discovery.ex`
- `lib/mix/tasks/symphony.workflows.backfill.ex` (after one-time data migration)
- All `elixir/WORKFLOW*.md` and `elixir/WORKFLOW.*.example.md`

Frontend (modify/create):
- `tracker/src/components/projects/ProjectConfigEditor.tsx` — replace tabs with basics form + markdown editor
- `tracker/src/components/projects/WorkflowMarkdownEditor.tsx` (create)
- `tracker/src/services/projects.ts` / `issues.ts` — `workflowMarkdown` field; assistant agent param
- `tracker/src/types/workflow-config.ts` — trim to connection types
- `tracker/src/components/assistant/*` — agent (codex/claude) selector in dispatch

---

## Phase 0 — Safety net

### Task 0: Branch + green baseline

**Files:** none

- [ ] **Step 1: Create a branch**

```bash
cd /home/raphaelcangucu/symphony && git checkout -b feat/per-project-workflow-markdown
```

- [ ] **Step 2: Confirm baseline is green**

Run: `cd elixir && mix test`
Expected: PASS (note any pre-existing failures to distinguish from regressions).

- [ ] **Step 3: Commit nothing yet (baseline noted)**

---

## Phase A — Storage + parser + resolution (per-project markdown)

### Task A1: Migration — add `workflow_markdown`, backfill, drop legacy columns

**Files:**
- Create: `elixir/priv/repo/migrations/<ts>_add_workflow_markdown_and_drop_legacy_setup_columns.exs`
- Reference: `elixir/lib/symphony_elixir/local_tracker/project_setup.ex`

- [ ] **Step 1: Generate the migration**

```bash
cd elixir && mix ecto.gen.migration add_workflow_markdown_and_drop_legacy_setup_columns
```

- [ ] **Step 2: Write the migration (add column, data-migrate, drop legacy)**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddWorkflowMarkdownAndDropLegacySetupColumns do
  use Ecto.Migration
  import Ecto.Query

  def up do
    alter table(:local_tracker_project_setups) do
      add :workflow_markdown, :text
    end
    flush()

    # Data-migrate: serialize existing workflow_config + prompt_template into a
    # single markdown blob (YAML front matter + body).
    repo = repo()

    rows =
      repo.all(
        from s in "local_tracker_project_setups",
          select: %{id: s.id, workflow_config: s.workflow_config, prompt_template: s.prompt_template}
      )

    Enum.each(rows, fn row ->
      markdown =
        SymphonyElixir.Workflow.to_markdown(
          decode_config(row.workflow_config),
          row.prompt_template || ""
        )

      repo.update_all(
        from(s in "local_tracker_project_setups", where: s.id == ^row.id),
        set: [workflow_markdown: markdown]
      )
    end)

    alter table(:local_tracker_project_setups) do
      remove :workflow_config
      remove :prompt_template
    end
  end

  def down do
    alter table(:local_tracker_project_setups) do
      add :workflow_config, :map
      add :prompt_template, :text
    end

    alter table(:local_tracker_project_setups) do
      remove :workflow_markdown
    end
  end

  defp decode_config(nil), do: %{}
  defp decode_config(map) when is_map(map), do: map
  defp decode_config(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, map} when is_map(map) -> map
      _ -> %{}
    end
  end
end
```

- [ ] **Step 3: Implement `Workflow.to_markdown/2` (used by the migration)**

In `elixir/lib/symphony_elixir/workflow.ex` add:

```elixir
@doc "Serialize front-matter map + prompt body into WORKFLOW markdown text."
@spec to_markdown(map(), String.t()) :: String.t()
def to_markdown(front_matter, body) when is_map(front_matter) and is_binary(body) do
  yaml = front_matter |> stringify_keys() |> Ymlr.document!() |> String.trim_leading("---\n")
  "---\n" <> yaml <> "\n---\n\n" <> body
end

defp stringify_keys(%{} = m),
  do: Map.new(m, fn {k, v} -> {to_string(k), stringify_keys(v)} end)
defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
defp stringify_keys(other), do: other
```

- [ ] **Step 4: Add the `ymlr` dependency (YAML writer)**

In `elixir/mix.exs` deps add `{:ymlr, "~> 5.0"}`, then:

```bash
cd elixir && mix deps.get
```

- [ ] **Step 5: Run the migration on a scratch DB and verify**

Run: `cd elixir && MIX_ENV=dev mix ecto.migrate`
Expected: migration runs; `local_tracker_project_setups` now has `workflow_markdown`, no `workflow_config`/`prompt_template`.

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations elixir/lib/symphony_elixir/workflow.ex elixir/mix.exs elixir/mix.lock
git commit -m "feat(tracker): add workflow_markdown column, backfill, drop legacy setup columns"
```

### Task A2: `Workflow.parse_string/1`

**Files:**
- Modify: `elixir/lib/symphony_elixir/workflow.ex`
- Test: `elixir/test/symphony_elixir/workflow_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "parse_string/1 returns front matter and body" do
  md = "---\ntracker:\n  active_states: [Todo]\n---\n\nHello {{ issue.identifier }}"
  assert {:ok, %{config: cfg, prompt: body}} = SymphonyElixir.Workflow.parse_string(md)
  assert get_in(cfg, ["tracker", "active_states"]) == ["Todo"]
  assert body =~ "Hello"
end

test "parse_string/1 reports invalid yaml" do
  assert {:error, _} = SymphonyElixir.Workflow.parse_string("---\n: bad\n---\nx")
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/workflow_test.exs -k parse_string`
Expected: FAIL (`parse_string/1` undefined).

- [ ] **Step 3: Implement by extracting the existing parse body**

In `workflow.ex`, refactor `parse/1` so the string-parsing core is public:

```elixir
@spec parse_string(String.t()) :: {:ok, map()} | {:error, term()}
def parse_string(content) when is_binary(content), do: parse(content)
```

(If `parse/1` is already public and string-based, alias it; otherwise expose the
existing front-matter+body splitter as `parse_string/1`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/workflow_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/workflow.ex elixir/test/symphony_elixir/workflow_test.exs
git commit -m "feat(workflow): public parse_string/1 for markdown text"
```

### Task A3: `Config.parse_workflow_markdown/1` (validate + reject foreign keys)

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "parse_workflow_markdown validates behavior keys" do
  md = "---\ntracker:\n  active_states: [Todo]\nagent:\n  max_turns: 5\n---\nbody"
  assert {:ok, %{front_matter: fm, body: "body"}} =
           SymphonyElixir.Config.parse_workflow_markdown(md)
  assert get_in(fm, [:agent, :max_turns]) == 5
end

test "parse_workflow_markdown rejects connection and process keys" do
  for section <- ["github", "server", "observability", "polling", "editor"] do
    md = "---\n#{section}: {}\n---\nb"
    assert {:error, msg} = SymphonyElixir.Config.parse_workflow_markdown(md)
    assert msg =~ section
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs -k parse_workflow_markdown`
Expected: FAIL.

- [ ] **Step 3: Implement**

```elixir
@forbidden_per_project_sections ~w(github linear local server observability polling editor)

@spec parse_workflow_markdown(String.t()) ::
        {:ok, %{front_matter: keyword() | map(), body: String.t()}} | {:error, String.t()}
def parse_workflow_markdown(markdown) when is_binary(markdown) do
  with {:ok, %{config: raw, prompt: body}} <- SymphonyElixir.Workflow.parse_string(markdown),
       :ok <- reject_forbidden(raw),
       opts <- validate_front_matter(raw) do
    {:ok, %{front_matter: opts, body: body}}
  else
    {:error, reason} -> {:error, humanize(reason)}
  end
end

defp reject_forbidden(raw) do
  present = Enum.filter(@forbidden_per_project_sections, &Map.has_key?(raw, &1))
  if present == [], do: :ok,
    else: {:error, "not allowed in per-project workflow: #{Enum.join(present, ", ")} (set these as process/connection config)"}
end

defp humanize(reason) when is_binary(reason), do: reason
defp humanize(reason), do: inspect(reason)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(config): parse_workflow_markdown with per-project key validation"
```

### Task A4: `ProjectSetup` schema + `Context.upsert_project_setup`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/project_setup.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/context_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "upsert_project_setup stores workflow_markdown" do
  {:ok, project} = Context.ensure_project(%{slug: "p1", name: "P1"})
  md = "---\ntracker:\n  active_states: [Todo]\n---\nprompt body"
  {:ok, setup} = Context.upsert_project_setup(project, %{"workflow_markdown" => md})
  assert setup.workflow_markdown =~ "prompt body"
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs -k workflow_markdown`
Expected: FAIL (field unknown).

- [ ] **Step 3: Update schema and changeset**

In `project_setup.ex`: replace `field :workflow_config, :map` and
`field :prompt_template, :string` with `field :workflow_markdown, :string`; update
`@cast_fields`/`cast/3` accordingly.

In `context.ex` `upsert_project_setup/2`: accept `"workflow_markdown"` key.

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/local_tracker/context_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/local_tracker/project_setup.ex elixir/lib/symphony_elixir/local_tracker/context.ex elixir/test/symphony_elixir/local_tracker/context_test.exs
git commit -m "feat(tracker): project setup stores workflow_markdown"
```

### Task A5: `ProjectConfig.resolve/1` reads `workflow_markdown`

**Files:**
- Modify: `elixir/lib/symphony_elixir/project_config.ex`
- Test: `elixir/test/symphony_elixir/project_config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "resolve reads states + prompt from workflow_markdown" do
  {:ok, project} = Context.ensure_project(%{slug: "pc", name: "PC", tracker_kind: "local"})
  md = "---\ntracker:\n  active_states: [Todo, In Progress]\n  terminal_states: [Done]\nagent:\n  max_turns: 7\ncodex: {}\n---\nDo {{ issue.identifier }}"
  {:ok, _} = Context.upsert_project_setup(project, %{"workflow_markdown" => md})
  cfg = ProjectConfig.resolve(Repo.reload(project))
  assert cfg.active_states == ["Todo", "In Progress"]
  assert cfg.prompt_template =~ "Do {{ issue.identifier }}"
  assert cfg.max_turns == 7
  assert cfg.agent_kind == "codex"
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/project_config_test.exs -k workflow_markdown`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `project_config.ex`:
- Add struct fields: `:codex`, `:claude`, `:max_turns`, `:turn_timeout_ms`,
  `:read_timeout_ms`, `:stall_timeout_ms`, `:completion_transitions`,
  `:max_concurrent_agents_by_state`, `:dev_server`, `:hooks`.
- Replace `setup_front_matter/1` + `resolve_prompt/1` to parse
  `setup.workflow_markdown` via `Config.parse_workflow_markdown/1`:

```elixir
defp parsed(setup) do
  case setup && setup.workflow_markdown do
    md when is_binary(md) and md != "" ->
      case Config.parse_workflow_markdown(md) do
        {:ok, %{front_matter: fm, body: body}} -> {fm, body}
        {:error, _} -> {[], nil}
      end
    _ -> {[], nil}
  end
end
```

- Populate the new fields from `fm` (e.g. `get_in(fm, [:agent, :max_turns])`,
  `Map.get(fm, :codex)`, etc.), `prompt_template: body`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/project_config_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/project_config.ex elixir/test/symphony_elixir/project_config_test.exs
git commit -m "feat(project_config): resolve behavior from workflow_markdown"
```

---

## Phase B — Route per-project agent runtime (Phase 2)

### Task B1: Per-project agent selection default

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex`, `coding_agent.ex`
- Modify: callers of `AgentRouting.resolve_agent_kind/3` (issue_mapper / github+linear clients)
- Test: `elixir/test/symphony_elixir/agent_routing_test.exs` (extend) + a project_config-based test

- [ ] **Step 1: Write the failing test**

```elixir
test "bare symphony label uses project default kind" do
  # project markdown declares only claude:
  kinds = ["claude"]
  assert SymphonyElixir.AgentRouting.resolve_agent_kind(["symphony"], kinds, "claude") == "claude"
end
```

- [ ] **Step 2: Run to verify it fails / passes**

Run: `cd elixir && mix test test/symphony_elixir/agent_routing_test.exs`
Expected: PASS for routing (logic already supports it) — the change is **who supplies `default_kind`/`configured_kinds`**.

- [ ] **Step 3: Thread project default into label→kind resolution**

At the call sites that map labels to `agent_kind` for an issue (issue_mapper /
clients), pass `ProjectConfig.resolve(project)`-derived
`configured_kinds` (which of `codex`/`claude` the project's markdown defines) and
`default_kind` (project default, else `Config.default_agent_kind()`), instead of
the global `Config.configured_agent_kinds()`/`Config.default_agent_kind()`.

- [ ] **Step 4: `agent_runner.ex:119` uses per-project max_turns**

Replace `Config.agent_max_turns()` with the resolved
`ProjectConfig.resolve(project).max_turns || InstanceConfig.default_max_turns()`.

- [ ] **Step 5: Run focused tests**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_test.exs test/symphony_elixir/agent_routing_test.exs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/lib/symphony_elixir/coding_agent.ex elixir/lib/symphony_elixir/local_tracker/issue_mapper.ex elixir/test/symphony_elixir/agent_routing_test.exs
git commit -m "feat(agent): per-project default agent kind + max_turns"
```

### Task B2: Per-project codex/claude config resolved at dispatch

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/config.ex`, `claude/config.ex`
- Modify: dispatch path in `agent_runner.ex` / `coding_agent.ex` to pass resolved block
- Test: `elixir/test/symphony_elixir/codex/config_test.exs` (or new)

- [ ] **Step 1: Write the failing test**

```elixir
test "codex command resolves from per-project block, falls back to env" do
  block = %{"command" => "codex --custom app-server"}
  assert SymphonyElixir.Codex.Config.command(block) == "codex --custom app-server"
  assert SymphonyElixir.Codex.Config.command(%{}) == SymphonyElixir.InstanceConfig.codex_command()
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/config_test.exs`
Expected: FAIL (arity / InstanceConfig undefined yet — InstanceConfig comes in Task D1; sequence D1 before B2 if needed).

- [ ] **Step 3: Implement arity-1 accessors taking the project block**

In `codex/config.ex` change `section_value/1` to accept an optional block:

```elixir
def command(block \\ %{}), do: value(block, "command") || InstanceConfig.codex_command()
defp value(block, key), do: Map.get(block || %{}, key) || Map.get(block || %{}, String.to_atom(key))
```

Mirror in `claude/config.ex`.

- [ ] **Step 4: Resolve at dispatch and pass down**

In the dispatch path, compute `codex_block = ProjectConfig.resolve(project).codex`
once and pass to session start (`start_session(workspace, kind, codex: codex_block)`).

- [ ] **Step 5: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/codex test/symphony_elixir/claude`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/config.ex elixir/lib/symphony_elixir/claude/config.ex elixir/lib/symphony_elixir/agent_runner.ex
git commit -m "feat(agent): resolve codex/claude config per project at dispatch"
```

### Task B3: Orchestrator per-project completion_transitions / concurrency / stall

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex:368,497,759`
- Test: `elixir/test/symphony_elixir/orchestrator_*_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "completion transition uses project markdown mapping" do
  # project markdown: agent.completion_transitions: {"In Progress": "Merging"}
  # dispatch an issue in In Progress, complete it, assert it moves to Merging
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/orchestrator_completion_test.exs`
Expected: FAIL.

- [ ] **Step 3: Implement**

At `orchestrator.ex:759`, resolve the running entry's project and use
`ProjectConfig.resolve(project).completion_transitions || InstanceConfig.completion_transitions()`.
At `:497`, use per-project `max_concurrent_agents_by_state`.
At `:368`, use per-project `stall_timeout_ms` falling back to InstanceConfig.

- [ ] **Step 4: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/orchestrator_completion_test.exs test/symphony_elixir/orchestrator_dispatch_gate_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator.ex elixir/test/symphony_elixir
git commit -m "feat(orchestrator): per-project completion transitions, concurrency, stall"
```

### Task B4: Per-project workspace hooks (before_run/after_run/before_remove)

**Files:**
- Modify: `elixir/lib/symphony_elixir/workspace.ex:132-145,244,267`
- Test: `elixir/test/symphony_elixir/workspace_test.exs`

- [ ] **Step 1: Write the failing test** (hook from project markdown runs)

```elixir
test "before_run hook comes from project workflow_markdown" do
  # markdown hooks.before_run: "echo hi"; assert workspace uses it
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/workspace_test.exs -k before_run`
Expected: FAIL.

- [ ] **Step 3: Implement** — read hooks from `ProjectConfig.resolve(project).hooks`.

- [ ] **Step 4: Run / Commit**

```bash
cd elixir && mix test test/symphony_elixir/workspace_test.exs
git add elixir/lib/symphony_elixir/workspace.ex elixir/test/symphony_elixir/workspace_test.exs
git commit -m "feat(workspace): per-project run/remove hooks from markdown"
```

---

## Phase C — Assistant agent selection (Codex/Claude)

### Task C1: Backend generic dispatch with agent param

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/issue_controller.ex`
- Modify: assistant tool executor dispatch (`assistant/tool_executor.ex`)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs`

- [ ] **Step 1: Write the failing test** (dispatch with `agent_kind: "claude"` sets the issue's agent)

```elixir
test "dispatch accepts explicit agent_kind and applies symphony:claude" do
  # POST dispatch with %{"agent_kind" => "claude"} → issue ends up routed to claude
end
```

- [ ] **Step 2–4: Implement** an `agent_kind` param on the dispatch action that sets
  the issue label/`agent_kind` before enqueueing; run + commit.

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/issue_controller_test.exs
git commit -am "feat(assistant): explicit agent selection at dispatch"
```

### Task C2: Frontend agent selector in assistant + new-issue

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, `assistantToolCall.ts`
- Modify: `tracker/src/services/issues.ts`
- Test: `tracker/src/components/assistant/__tests__/*`

- [ ] **Step 1: Write failing RTL test** — selecting "Claude" sends `agentKind: "claude"`.
- [ ] **Step 2–4: Implement** a Codex/Claude toggle wired to the dispatch service; run + commit.

```bash
cd tracker && npm run test:unit -- src/components/assistant
git commit -am "feat(assistant-ui): codex/claude selector"
```

---

## Phase D — Process settings → env (`InstanceConfig`)

### Task D1: `InstanceConfig` + `runtime.exs`

**Files:**
- Create: `elixir/lib/symphony_elixir/instance_config.ex`
- Create: `elixir/config/runtime.exs`
- Test: `elixir/test/symphony_elixir/instance_config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
test "instance config reads env with defaults" do
  Application.put_env(:symphony_elixir, :poll_interval_ms, 1234)
  assert SymphonyElixir.InstanceConfig.poll_interval_ms() == 1234
end

test "defaults apply when unset" do
  Application.delete_env(:symphony_elixir, :poll_interval_ms)
  assert SymphonyElixir.InstanceConfig.poll_interval_ms() == 5000
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/instance_config_test.exs`
Expected: FAIL.

- [ ] **Step 3: Implement `InstanceConfig`**

```elixir
defmodule SymphonyElixir.InstanceConfig do
  @moduledoc "Process-level settings (env/config), replacing the global WORKFLOW.md."

  @spec poll_interval_ms() :: pos_integer()
  def poll_interval_ms, do: get(:poll_interval_ms, 5000)

  @spec max_concurrent_agents() :: pos_integer()
  def max_concurrent_agents, do: get(:max_concurrent_agents, 5)

  @spec default_max_turns() :: pos_integer()
  def default_max_turns, do: get(:default_max_turns, 20)

  @spec completion_transitions() :: map()
  def completion_transitions, do: get(:completion_transitions, %{})

  @spec server_host() :: String.t()
  def server_host, do: get(:server_host, "127.0.0.1")

  @spec server_port() :: pos_integer()
  def server_port, do: get(:server_port, 4000)

  @spec editor_enabled?() :: boolean()
  def editor_enabled?, do: get(:editor_enabled, false)

  @spec codex_command() :: String.t()
  def codex_command, do: get(:codex_command, "codex --config shell_environment_policy.inherit=all app-server")

  @spec claude_command() :: String.t()
  def claude_command, do: get(:claude_command, "symphony-claude")

  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: get(:default_agent_kind, "codex")

  defp get(key, default) do
    case Application.get_env(:symphony_elixir, key, default) do
      nil -> default
      v -> v
    end
  end
end
```

(Add observability + stall/turn/read timeout accessors mirroring the old
`Config` ones.)

- [ ] **Step 4: Create `config/runtime.exs`**

```elixir
import Config

config :symphony_elixir,
  poll_interval_ms: String.to_integer(System.get_env("SYMPHONY_POLL_INTERVAL_MS") || "5000"),
  max_concurrent_agents: String.to_integer(System.get_env("SYMPHONY_MAX_CONCURRENT_AGENTS") || "5"),
  default_max_turns: String.to_integer(System.get_env("SYMPHONY_MAX_TURNS") || "20"),
  server_host: System.get_env("SYMPHONY_TRACKER_HOST") || "127.0.0.1",
  server_port: String.to_integer(System.get_env("SYMPHONY_TRACKER_PORT") || "4000"),
  editor_enabled: System.get_env("SYMPHONY_EDITOR_ENABLED") == "true",
  editor_binary: System.get_env("SYMPHONY_EDITOR_BINARY") || "code-server",
  editor_host: System.get_env("SYMPHONY_EDITOR_HOST") || "127.0.0.1",
  editor_port: String.to_integer(System.get_env("SYMPHONY_EDITOR_PORT") || "4002"),
  codex_command: System.get_env("SYMPHONY_CODEX_COMMAND") ||
    "codex --config shell_environment_policy.inherit=all app-server",
  claude_command: System.get_env("SYMPHONY_CLAUDE_COMMAND") || "symphony-claude",
  default_agent_kind: System.get_env("SYMPHONY_DEFAULT_AGENT_KIND") || "codex"
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/instance_config_test.exs`
Expected: PASS.

- [ ] **Step 6: Update `elixir/.env.example`** with the `SYMPHONY_*` keys.

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/instance_config.ex elixir/config/runtime.exs elixir/.env.example elixir/test/symphony_elixir/instance_config_test.exs
git commit -m "feat(config): InstanceConfig process settings from env/runtime"
```

### Task D2: Repoint process readers to `InstanceConfig`

**Files:**
- Modify: `orchestrator.ex:59,60,1055,1328,1329`; `http_server.ex:21-23`;
  `status_dashboard.ex:342,446,103-106,182-184`; `observability/reporter.ex:*`;
  `editor_supervisor.ex:29`, `editor.ex:29`, `editor/server.ex`;
  `dev_server/reconciler.ex:397`

- [ ] **Step 1: Replace each global `Config.<accessor>()` with `InstanceConfig.<accessor>()`** at the listed lines (process-loop, HTTP, observability, editor, poll).

- [ ] **Step 2: Run the affected suites**

Run: `cd elixir && mix test test/symphony_elixir/orchestrator_test.exs test/symphony_elixir/status_dashboard_test.exs test/symphony_elixir/observability`
Expected: PASS (after Task G updates TestSupport).

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor: process readers use InstanceConfig"
```

---

## Phase E — Remove global WORKFLOW.md, store, discovery, single-project

### Task E1: Remove `WorkflowStore` + discovery from boot

**Files:**
- Modify: `elixir/lib/symphony_elixir/shared_supervisor.ex:50` (drop `WorkflowStore`)
- Modify: `elixir/lib/symphony_elixir.ex` (drop `WorkflowDiscovery.discover/1` call)
- Delete: `elixir/lib/symphony_elixir/workflow_store.ex`, `workflow_discovery.ex`
- Modify: `elixir/lib/symphony_elixir/workflow.ex` — drop `workflow_file_path/0`,
  `set/clear_workflow_file_path/1`, `current/0`, `load/0`; keep `parse_string/1`,
  `to_markdown/2`, `load/1` (used only by export).

- [ ] **Step 1: Delete the two modules and their references**

```bash
cd elixir && git rm lib/symphony_elixir/workflow_store.ex lib/symphony_elixir/workflow_discovery.ex
```

- [ ] **Step 2: Remove `SymphonyElixir.WorkflowStore` from `shared_supervisor.ex` child list.**

- [ ] **Step 3: Remove the discovery boot call in `symphony_elixir.ex`.**

- [ ] **Step 4: Remove `Config.validate!/0` global-file path** and any
  `Config.workflow_config/0`/`section/1`/`current_workflow/0` that read the global
  file; the only front-matter parsing left is `parse_workflow_markdown/1`.

- [ ] **Step 5: Compile**

Run: `cd elixir && mix compile --warnings-as-errors`
Expected: PASS (fix every now-undefined reference the compiler flags).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove global WorkflowStore, discovery, and global workflow accessors"
```

### Task E2: CLI / serve / Makefile no longer require a workflow file

**Files:**
- Modify: `elixir/dev/serve.exs:57-71`, `elixir/lib/symphony_elixir/cli.ex:56-87`,
  `elixir/lib/mix/tasks/symphony.ctl.ex`, `elixir/Makefile:178`

- [ ] **Step 1: Drop the WORKFLOW path arg/requirement** from CLI + serve; remove
  `$SYMPHONY_WORKFLOW` handling and the `./WORKFLOW.md` default. The escript starts
  with process env only.

- [ ] **Step 2: Run**

Run: `cd elixir && mix test test/symphony_elixir/dev_serve_test.exs`
Expected: PASS (after rewriting that test in Task G).

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(cli): remove global workflow file requirement"
```

### Task E3: Delete `WORKFLOW*.md` files + repoint docs/assistant tool

**Files:**
- Delete: `elixir/WORKFLOW.md`, `elixir/WORKFLOW.*.md`, `elixir/WORKFLOW.*.example.md`
- Modify: `elixir/lib/symphony_elixir/assistant/read_tools.ex` (`get_workflow` →
  read the issue's project `workflow_markdown`, or remove the tool)
- Modify: `elixir/README.md`, `elixir/docs/troubleshooting.md`, `SPEC.md`, `AGENTS.md`
- Delete/repurpose: `elixir/lib/mix/tasks/symphony.workflows.backfill.ex`

- [ ] **Step 1: Run the data migration first** (Task A1 already backfills on
  migrate). Verify existing projects have `workflow_markdown` populated:

Run: `cd elixir && mix run -e 'IO.inspect(SymphonyElixir.Repo.aggregate(SymphonyElixir.LocalTracker.ProjectSetup, :count))'`

- [ ] **Step 2: Delete the files**

```bash
cd elixir && git rm WORKFLOW.md WORKFLOW.*.md
```

- [ ] **Step 3: Repoint `get_workflow` assistant tool** to per-project markdown.

- [ ] **Step 4: Update docs** to describe `SYMPHONY_*` env + UI-managed per-project markdown.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete WORKFLOW.md files; docs + assistant tool to per-project markdown"
```

---

## Phase F — Frontend settings (basics form + markdown editor)

### Task F1: Services + types

**Files:**
- Modify: `tracker/src/services/projects.ts` (setup payload uses `workflowMarkdown`)
- Modify: `tracker/src/types/workflow-config.ts` (trim to connection types)
- Test: `tracker/src/services/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing test** — `updateProjectSetup` sends `workflow_markdown`.
- [ ] **Step 2–4: Implement; run; commit.**

```bash
cd tracker && npm run test:unit -- src/services
git commit -am "feat(tracker-svc): workflow_markdown setup payload"
```

### Task F2: `WorkflowMarkdownEditor` component

**Files:**
- Create: `tracker/src/components/projects/WorkflowMarkdownEditor.tsx`
- Test: `tracker/src/components/projects/__tests__/WorkflowMarkdownEditor.test.tsx`

- [ ] **Step 1: Write failing RTL test**

```tsx
it("shows validation errors and a preview", async () => {
  render(<WorkflowMarkdownEditor value={"---\ngithub: {}\n---\nx"} onChange={vi.fn()} onValidate={vi.fn()} />);
  // typing invalid (forbidden github) surfaces an inline error from the API/validator
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tracker && npm run test:unit -- WorkflowMarkdownEditor`
Expected: FAIL.

- [ ] **Step 3: Implement** a textarea (or existing `MarkdownEditor`) with Write/Preview, calling a `/setup/validate` endpoint or client-side YAML parse to surface errors, and a parsed-config + rendered-prompt preview pane.

- [ ] **Step 4: Run / Commit**

```bash
cd tracker && npm run test:unit -- WorkflowMarkdownEditor
git commit -am "feat(tracker): WorkflowMarkdownEditor with validation + preview"
```

### Task F3: Replace `ProjectConfigEditor` with basics form + editor

**Files:**
- Modify: `tracker/src/components/projects/ProjectConfigEditor.tsx`
- Test: `tracker/src/components/projects/__tests__/ProjectConfigEditor.test.tsx`

- [ ] **Step 1: Write failing test** — renders Basics (name, tracker picker, repos)
  + the markdown editor; Save calls `updateProject`, `updateProjectRepositories`,
  `updateProjectSetup({ workflowMarkdown })`; no `buildWorkflowConfig`.

- [ ] **Step 2: Run to verify it fails.**

Run: `cd tracker && npm run test:unit -- ProjectConfigEditor`

- [ ] **Step 3: Implement** — delete the 9-tab `SECTIONS`/`buildWorkflowConfig`;
  keep `TrackerSourceFields`, `RepositoriesSection`; add the markdown editor; wire
  `LoadDefaultMenu`/templates to seed it.

- [ ] **Step 4: Run / Commit**

```bash
cd tracker && npm run test:unit -- ProjectConfigEditor && npm run lint
git commit -am "feat(tracker): hybrid settings — basics form + workflow markdown editor"
```

---

## Phase G — Test support migration

### Task G1: `TestSupport` process settings + project-with-markdown helpers

**Files:**
- Modify: `elixir/test/support/test_support.exs:31-46`
- Test: covered by the suite running green

- [ ] **Step 1: Replace global-file setup** with env-based process config:

```elixir
def put_process_config(overrides \\ %{}) do
  base = %{poll_interval_ms: 5000, max_concurrent_agents: 5, default_agent_kind: "codex"}
  Enum.each(Map.merge(base, overrides), fn {k, v} ->
    Application.put_env(:symphony_elixir, k, v)
  end)
  :ok
end

def project_with_markdown(slug, markdown, attrs \\ %{}) do
  {:ok, project} =
    SymphonyElixir.LocalTracker.Context.ensure_project(Map.merge(%{slug: slug, name: slug}, attrs))
  {:ok, _setup} =
    SymphonyElixir.LocalTracker.Context.upsert_project_setup(project, %{"workflow_markdown" => markdown})
  SymphonyElixir.Repo.reload(project)
end
```

Remove the temp-`WORKFLOW.md` writer and `set_workflow_file_path/1` call from
`setup`.

- [ ] **Step 2: Run the whole suite, fix fallout per module**

Run: `cd elixir && mix test`
Expected: iterate — replace per-test `set_workflow_file_path`/global-config
assumptions with `put_process_config/1` and `project_with_markdown/3`. Delete
obsolete tests: `extensions_test.exs` (WorkflowStore), `workflow_discovery_test.exs`,
`symphony_workflows_backfill_test.exs`, the global-file branches of
`core_test.exs`/`dev_serve_test.exs`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: migrate suite to InstanceConfig env + per-project markdown helpers"
```

---

## Phase H — Final verification

### Task H1: Full gates + boot-without-WORKFLOW check

**Files:** none

- [ ] **Step 1: Boots with no workflow file**

```bash
cd elixir && rm -f WORKFLOW.md && MIX_ENV=dev iex -S mix run -e ":timer.sleep(2000)"
```
Expected: app starts, no `{:missing_workflow_file, ...}`, no Orchestrator crash.

- [ ] **Step 2: Backend gates**

Run: `cd elixir && make all`
Expected: format, lint, coverage, dialyzer, `mix specs.check` PASS.

- [ ] **Step 3: Frontend gates**

Run: `cd tracker && npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 4: Smoke test in UI** — open `/tracker/projects/distributionmachine/settings`,
  confirm basics form + markdown editor render the migrated config, edit + save,
  re-dispatch DIS-1, confirm a turn runs and a PR is created.

- [ ] **Step 5: Update SPEC + READMEs** to reflect the removal (DRY with the spec).

- [ ] **Step 6: Final commit**

```bash
git commit -am "docs: spec/readme reflect per-project markdown + env process config"
```

---

## Self-Review notes

- **Spec coverage:** A (storage/parser/resolution) ✓; B (per-project agent
  runtime) ✓; C (assistant selection) ✓; D (process env) ✓; E (remove global +
  files) ✓; F (frontend hybrid) ✓; G (tests) ✓; legacy column removal in A1 ✓;
  agent three-level precedence in B1/C ✓.
- **Ordering dependency:** `InstanceConfig` (D1) is referenced by B1/B2/B3 — if
  executing strictly in order, do D1 before B. Recommended execution order:
  A → D1 → B → C → E → F → G → H.
- **Type consistency:** `parse_workflow_markdown/1` returns
  `{:ok, %{front_matter, body}}` everywhere; `ProjectConfig` fields named
  `codex/claude/max_turns/completion_transitions/dev_server/hooks` used
  consistently in B1–B4.
