# Extensible Plugin Framework — Hookable Agent Plugins (RTK + Caveman as first built-ins)

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Build a **real plugin framework** for Symphony (not just two hardcoded features), so token-reduction plugins — and anything future — plug into well-defined seams. Ship the framework + a `Plugin` behaviour + registry + runtime + persistence + a settings UI, and prove it with **two built-in plugins**:
- **RTK** (token reduction): wraps the agent CLI invocation (`rtk -- <cmd>`) to compress tool output.
- **Caveman** (terser replies): contributes a vendored skill + a prompt fragment.

The point of this plan is the **structure that lets us add plugin #3, #4, #N** by implementing one behaviour and registering it — no edits to the runners, prompt builder, or workspace prep.

**Why this is feasible (verified seams):** Symphony already has the exact chokepoints a plugin system needs:
- **Command-wrap (one string, three runners):** every agent spawns through `bash -lc <command>`:
  - Cursor: `cursor/cli_runner.ex:80` — `shell_line = "#{command} #{cli_args} < #{prompt}"`.
  - Codex: `codex/coding_agent.ex:443` — `command = CodexConfig.command(section)`.
  - Claude: `claude/app_server/cli_runner.ex` `run_turn/2` — `shell_line` from `command`.
- **Skill contribution:** `WorkspaceSkills.prepare/1` (`workspace_skills.ex:28-51`) materializes skills from `Skills.root()` into a per-workspace symlink mirror — a plugin can add a source.
- **MCP contribution:** per-workspace MCP config is written for each agent (`.cursor/mcp.json`; Claude `--mcp-config <path>` at `claude/app_server/cli_runner.ex:156-157`; `ToolGateway`).
- **Prompt fragment:** `PromptBuilder.build_prompt/2` (`prompt_builder.ex:35-49`) appends sections — a plugin can append one.
- **Persistence:** the `Settings` store (`settings.ex`) is fixed-key (toggles); a growing, listable, per-project plugin registry wants a dedicated `plugins` table (same call we made for Magic Prompts).

**Architecture (layers):**

```
Plugin (behaviour)            # what a plugin can do: id/name/desc/config + optional hooks
   ├── RTK (built-in)         # implements wrap_command/2
   └── Caveman (built-in)     # implements skill_sources/1 + prompt_fragment/1
PluginRegistry                # built-in module list + enabled/config rows (plugins table, global+project scope)
PluginRuntime                 # fan-out: wrap_command, skill_sources, mcp_servers, prompt_fragments
   ↑ called by ↑
   ├── cursor/codex/claude runners   (wrap_command)
   ├── WorkspaceSkills.prepare       (skill_sources)
   ├── MCP config writer             (mcp_servers)
   └── PromptBuilder.build_prompt    (prompt_fragments)
```

**Tech Stack:** Elixir behaviours + Ecto, Phoenix controller, React 19 + TanStack Query + shadcn/ui, ExUnit + vitest.

---

## File Structure

**Create (backend — framework core):**
- `elixir/lib/symphony_elixir/plugin.ex` — the behaviour (callbacks + optional-callback defaults via `__using__`).
- `elixir/lib/symphony_elixir/plugins/registry.ex` — built-in module list + enabled/config resolution.
- `elixir/lib/symphony_elixir/plugins/runtime.ex` — fan-out functions with a shared `context()` type.
- `elixir/lib/symphony_elixir/plugins/installation.ex` — Ecto schema (`plugins` table).
- `elixir/priv/repo/migrations/<ts>_create_plugins.exs`

**Create (backend — built-ins):**
- `elixir/lib/symphony_elixir/plugins/builtin/rtk.ex`
- `elixir/lib/symphony_elixir/plugins/builtin/caveman.ex`
- vendored skill: `<skills_root>/caveman/SKILL.md` (or `priv/plugins/caveman/SKILL.md`).

**Create (backend — API):**
- `elixir/lib/symphony_elixir_web/controllers/tracker/plugin_controller.ex` + route.

**Modify (backend — wire seams):**
- `elixir/lib/symphony_elixir/cursor/cli_runner.ex` (~line 80)
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` (~line 443)
- `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex` (shell_line build)
- `elixir/lib/symphony_elixir/workspace_skills.ex` (`skill_sources/0`)
- `elixir/lib/symphony_elixir/prompt_builder.ex` (`build_prompt/2` append chain)
- the per-workspace MCP config writer (Task 5)
- `elixir/lib/symphony_elixir_web/controllers/tracker/router.ex`

**Create (tracker):**
- `tracker/src/types/plugin.ts`, `tracker/src/services/plugins.ts`
- `tracker/src/components/settings/PluginsPanel.tsx` (+ per-plugin config form)
- tests.

**Modify (tracker):** `SettingsPage.tsx` / `ProjectSettingsPage.tsx`, locales.

---

## Task 1: Plugin behaviour + optional-callback ergonomics

**Files:** Create `plugin.ex` + test.

Define the contract. Required: identity + config schema. Optional: the four hooks. Use `__using__` to inject no-op defaults so a plugin only implements the hooks it needs.

- [ ] **Step 1: Write failing test** — a tiny `defmodule NoopPlugin do use SymphonyElixir.Plugin; def id, do: "noop"; def name, do: "Noop"; def description, do: "" end` compiles and answers `wrap_command(cmd, ctx) == cmd`, `skill_sources(ctx) == []`, `mcp_servers(ctx) == %{}`, `prompt_fragment(ctx) == ""`.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/plugin_test.exs -o`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Plugin do
  @moduledoc "Behaviour for an agent plugin. Required identity + config; optional hooks."

  @type context :: %{
          agent_kind: String.t(),
          workspace: Path.t(),
          project_slug: String.t() | nil,
          issue: map() | nil,
          config: map()
        }

  @callback id() :: String.t()
  @callback name() :: String.t()
  @callback description() :: String.t()
  @callback config_schema() :: [map()]   # field descriptors for the settings form
  @callback default_config() :: map()

  @callback wrap_command(command :: String.t(), context()) :: String.t()
  @callback skill_sources(context()) :: [{name :: String.t(), path :: Path.t()}]
  @callback mcp_servers(context()) :: %{optional(String.t()) => map()}
  @callback prompt_fragment(context()) :: String.t()

  @optional_callbacks [
    config_schema: 0, default_config: 0,
    wrap_command: 2, skill_sources: 1, mcp_servers: 1, prompt_fragment: 1
  ]

  defmacro __using__(_opts) do
    quote do
      @behaviour SymphonyElixir.Plugin
      def config_schema, do: []
      def default_config, do: %{}
      def wrap_command(command, _ctx), do: command
      def skill_sources(_ctx), do: []
      def mcp_servers(_ctx), do: %{}
      def prompt_fragment(_ctx), do: ""
      defoverridable config_schema: 0, default_config: 0,
                     wrap_command: 2, skill_sources: 1, mcp_servers: 1, prompt_fragment: 1
    end
  end
end
```

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(plugins): Plugin behaviour + optional hook defaults`.

---

## Task 2: plugins table + Installation schema

**Files:** migration + `plugins/installation.ex` + test.

Columns: `plugin_id` (string), `scope` (`"global"` or project slug), `enabled` (bool, default false), `config` (map, default `%{}`), `position` (int), timestamps. Unique on `[:scope, :plugin_id]`.

- [ ] **Step 1: Migration** (mirror Task structure from Magic Prompts plan).
- [ ] **Step 2: Failing schema test** — changeset requires `plugin_id`/`scope`; `unique_constraint([:scope, :plugin_id])`; `config` defaults to `%{}`.
- [ ] **Step 3: Run (expect fail).**
- [ ] **Step 4: Implement** schema + changeset.
- [ ] **Step 5: Migrate + run (expect pass).**
- [ ] **Step 6: Commit** — `feat(plugins): plugins table + Installation schema`.

---

## Task 3: PluginRegistry (discovery + enabled/config resolution)

**Files:** `plugins/registry.ex` + test.

- [ ] **Step 1: Write failing test**
- `Registry.all()` returns the compile-time built-in modules (RTK, Caveman) — stubbed in this task with a test config override so the test doesn't depend on later tasks; assert it lists modules implementing the behaviour.
- `Registry.enabled(scope)` returns only modules with an `enabled: true` row for that scope (project scope OR global), each paired with its merged config (`default_config` ← stored `config`).
- `Registry.set_enabled(plugin_id, scope, true)` upserts a row; `Registry.put_config(plugin_id, scope, %{...})` merges + validates against `config_schema`.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/plugins/registry_test.exs -o`

- [ ] **Step 3: Implement**
- `@builtins [SymphonyElixir.Plugins.Builtin.Rtk, SymphonyElixir.Plugins.Builtin.Caveman]` (made overridable via app env for tests: `Application.get_env(:symphony_elixir, :plugins, @builtins)`). **This is the single list new plugins register in.**
- `all/0`, `get/1` (by id), `enabled/1` (resolve rows from the `plugins` table; project scope shadows/augments global), `set_enabled/3`, `put_config/3`, `describe/1` (id/name/description/config_schema/default_config/enabled/config for the API).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(plugins): registry with built-in discovery + enable/config`.

---

## Task 4: PluginRuntime (the fan-out the seams call)

**Files:** `plugins/runtime.ex` + test.

This is the **only** module the runners/prompt-builder/workspace import. It builds the `context`, asks the registry for enabled plugins, and folds their hooks. Must be defensive: a plugin raising must **not** crash a run — log + skip.

- [ ] **Step 1: Write failing test** (with two fake plugins registered via app env)
- `wrap_command/2` applies enabled plugins' `wrap_command` in registry order (e.g. `b -- (a -- cmd)`), and a plugin that returns the command unchanged is a no-op.
- A fake plugin whose `wrap_command` raises is skipped (command survives) and a warning is logged.
- `skill_sources/1` concatenates all enabled plugins' sources; `mcp_servers/1` deep-merges maps; `prompt_fragments/1` joins non-empty fragments with `\n\n`.
- Disabled-scope: a plugin enabled only for project `B` does not affect a run scoped to project `A`.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/plugins/runtime_test.exs -o`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Plugins.Runtime do
  alias SymphonyElixir.Plugins.Registry
  require Logger

  def wrap_command(command, ctx) when is_binary(command) do
    Enum.reduce(enabled_with_config(ctx), command, fn {mod, cfg}, acc ->
      safe(mod, :wrap_command, [acc, put_config(ctx, cfg)], acc)
    end)
  end

  def skill_sources(ctx),
    do: each(ctx, :skill_sources, [], &Kernel.++/2)

  def mcp_servers(ctx),
    do: each(ctx, :mcp_servers, %{}, &Map.merge/2)

  def prompt_fragments(ctx) do
    each(ctx, :prompt_fragment, [], fn frag, acc ->
      if is_binary(frag) and frag != "", do: acc ++ [frag], else: acc
    end)
  end

  # each/4 folds the chosen hook over enabled plugins; safe/4 wraps a call in
  # try/rescue so one bad plugin never breaks a run.
end
```

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(plugins): defensive PluginRuntime fan-out`.

---

## Task 5: Wire the four seams

Each sub-step is independent and small — keep them as separate commits so a regression bisects cleanly.

- [ ] **Step 1 — command-wrap (cursor):** in `cursor/cli_runner.ex:run_turn/2`, before building `shell_line`, do `command = Plugins.Runtime.wrap_command(command, ctx)` where `ctx` is assembled from `args` (`agent_kind: "cursor"`, workspace, project_slug, issue). Add a runner test: with a fake plugin that prepends `echo X &&`, the spawned `shell_line` contains it. *(Verify the existing arg map carries enough to build `ctx`; if not, thread `project_slug`/`issue` through the call site that builds `args`.)*

- [ ] **Step 2 — command-wrap (codex):** in `codex/coding_agent.ex:start_port/2`, after `command = CodexConfig.command(codex_section)` (line 443), wrap it. Test analogously.

- [ ] **Step 3 — command-wrap (claude):** in `claude/app_server/cli_runner.ex:run_turn/2`, wrap `command` before `shell_line`. Test analogously.

- [ ] **Step 4 — skill contribution:** in `workspace_skills.ex:skill_sources/0`, append `Plugins.Runtime.skill_sources(ctx)` to the discovered sources before sorting (`workspace_skills.ex:41-51`). Thread a minimal `ctx` into `prepare/1` (it currently takes only `workspace`; add an optional second arg `prepare(workspace, ctx \\ %{})` so callers can pass agent/project; default keeps current behavior). Update the two callers: `Workspace.ensure_at/2` (`workspace.ex:37`) and `Editor.ensure_browser_workspace/1` (`editor.ex:100,117`). Test: a fake plugin contributing `{ "caveman", path }` results in a symlink at `<workspace>/.symphony/skills/caveman`.

- [ ] **Step 5 — prompt fragment:** in `prompt_builder.ex:build_prompt/2`, append `plugin_fragments_section(opts)` to the chain (after `discussion_section`, before `artifacts_section`), rendering `Plugins.Runtime.prompt_fragments(ctx)` joined under a `## Plugin guidance` header (omit when empty). Test in `prompt_builder_test.exs`.

- [ ] **Step 6 — MCP contribution:** MCP injection is **not** centralized — it lives in three per-backend sites, so this hook is applied three times (each its own test + commit):
  - **Claude:** merge `Plugins.Runtime.mcp_servers(ctx)` into the `"mcpServers"` map in `Claude.AppServer.ToolGateway.write_mcp_config!/2` (`tool_gateway.ex:229-245`) before `File.write!` (today it writes only the single `"symphony"` http server).
  - **Cursor:** merge into the servers map in `Cursor.CodingAgent.write_mcp_config!/2` (`cursor/coding_agent.ex:157-180`) beside the `"symphony"` entry, then write `.cursor/mcp.json`.
  - **Codex:** Codex has no `mcp.json` file — it passes `dynamicTools` over JSON-RPC at `Codex.CodingAgent.start_thread/4` (`codex/coding_agent.ex:594-604`), sourced from `Codex.DynamicTool.coding_agent_tool_specs/0`. For Codex, a plugin's MCP/tool contribution must be translated into tool specs appended to that list (or skip Codex MCP in v1 and document the limitation).
  - Test (per backend): a fake plugin's server/tool appears in the written config / dynamicTools list.

- [ ] **Step 7:** Commit each sub-step: `feat(plugins): wire <seam> hook`.

---

## Task 6: Built-in plugin — RTK (token-reduction command proxy)

**Files:** `plugins/builtin/rtk.ex` + test.

- [ ] **Step 1: Write failing test**
- `Rtk.id() == "rtk"`, has name/description and a `config_schema` (e.g. `binary_path`, `compression_level`).
- `wrap_command("codex exec ...", ctx)` → `"rtk -- codex exec ..."` **only when** the `rtk` binary resolves (`config.binary_path` or `System.find_executable("rtk")`).
- When `rtk` is **not** installed → returns the command unchanged (graceful degradation, logs once). This makes RTK safe to enable before install.

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/plugins/builtin/rtk_test.exs -o`

- [ ] **Step 3: Implement** — `use SymphonyElixir.Plugin`; only override `wrap_command/2`, `config_schema/0`, `default_config/0`. Resolve binary defensively; shell-escape; respect config flags. (Pair this with the CLI-setup plan's installer so operators can install the `rtk` binary from the Agent Setup panel.)

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(plugins): RTK token-reduction built-in`.

---

## Task 7: Built-in plugin — Caveman (terser replies)

**Files:** `plugins/builtin/caveman.ex`, vendored `caveman/SKILL.md` + test.

- [ ] **Step 1: Write failing test**
- `Caveman.id() == "caveman"`.
- `skill_sources(ctx)` returns `[{"caveman", <abs path to vendored SKILL dir>}]` (path exists, contains `SKILL.md`).
- `prompt_fragment(ctx)` returns a short "be terse / minimize tokens" instruction (non-empty).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — vendor `caveman/SKILL.md` (concise-output skill); plugin overrides `skill_sources/1` (point at the vendored dir, resolved via `Application.app_dir` or `Skills.root()`) + `prompt_fragment/1`.

- [ ] **Step 4: Run (expect pass)** — also confirm `WorkspaceSkills.prepare` (Task 5/Step 4) materializes it end-to-end with Caveman enabled.

- [ ] **Step 5: Commit** — `feat(plugins): Caveman terse-replies built-in`.

---

## Task 8: REST API + tracker Plugins settings panel

**Files:** `plugin_controller.ex` + route; tracker `types/plugin.ts`, `services/plugins.ts`, `PluginsPanel.tsx` + tests; mount; locales.

- [ ] **Step 1: Backend failing test** — `GET /plugins` (and `/projects/:slug/plugins`) returns `[{id,name,description,enabled,config,configSchema}]` from `Registry.describe/1`; `PUT /plugins/:id` toggles `enabled`/sets `config` (validated against schema → 422 on bad config); project scope persists separately from global.
- [ ] **Step 2: Run (expect fail); Step 3: implement controller + routes; Step 4: run (expect pass).**
- [ ] **Step 5: Tracker failing tests** — service maps DTOs; `PluginsPanel` lists plugins with an enable toggle + an expandable config form driven by `configSchema` (text/number/select/boolean fields); toggling/saving calls the API and invalidates.
- [ ] **Step 6: Run (expect fail); Step 7: implement; Step 8: run (expect pass).**
- [ ] **Step 9:** Mount in settings (global + per-project), add `settings.plugins.*` i18n (en + pt-BR).
- [ ] **Step 10:** Commit — `feat(plugins): plugins API + settings panel`.

---

## Task 9: Full gates + extensibility docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all`.
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build`.
- [ ] **Step 3: Write "Authoring a plugin" doc** — a short guide: implement `SymphonyElixir.Plugin`, choose which hooks to override, add the module to `Registry @builtins`, expose config via `config_schema`. Include a copy-paste skeleton. This is the deliverable that proves the structure is extensible.
- [ ] **Step 4:** Commit — `docs(plugins): plugin authoring guide + hook reference`.

---

## Self-Review (spec coverage)

| Requirement | Task(s) |
| --- | --- |
| Token-reduction plugins (RTK + Caveman) | 6, 7 |
| **Complete, extensible structure for future plugins** | 1 (behaviour), 3 (registry), 4 (runtime), 5 (seams), 9 (authoring doc) |
| Command-wrap seam (RTK-style proxies) | 5.1–5.3 |
| Skill-contribution seam (skill plugins) | 5.4 |
| MCP-contribution seam (tool plugins) | 5.6 |
| Prompt-fragment seam (behavior plugins) | 5.5 |
| Per-project + global enable/config | 2, 3, 8 |
| Operator UI to manage plugins | 8 |

**Notes / decisions:**
- A new plugin = one module implementing `SymphonyElixir.Plugin` (overriding only relevant hooks) + one line in `Registry @builtins`. No edits to runners/prompt-builder/workspace — that's the extensibility guarantee, proven by the authoring doc + the two built-ins exercising different hooks.
- `PluginRuntime` is **defensive** (try/rescue per hook): a misbehaving plugin degrades to a no-op, never crashes a run. Verified in Task 4.
- Dedicated `plugins` table (not the fixed-key `Settings` store) for the same reason as Magic Prompts: it's a growing, listable, per-project collection.
- Command-wrap is inserted at the three verified `bash -lc <command>` chokepoints (cursor `cli_runner.ex:80`, codex `coding_agent.ex:443`, claude `cli_runner.ex` shell_line). Ordering of multiple command-wrap plugins follows registry order (documented).
- RTK degrades gracefully when its binary is absent — pair enablement with the CLI-setup plan's installer.
