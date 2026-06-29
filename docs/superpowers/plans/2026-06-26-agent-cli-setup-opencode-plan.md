# Agent CLI Setup & OpenCode Integration Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools (Elixir `mix`, tracker `npm`/`vitest`).

**Goal:** Add OpenCode as a first-class 4th coding-agent backend (run orchestrator issues + assistant chat like codex/claude/cursor) and add a tracker **Setup** panel that reports per-agent health (installed / version / auth / handshake) **plus the supporting tools the orchestrator depends on — `code-server` (browser VS Code) with its required extensions, and the Cloudflare `cloudflared` tunnel** — each with copy-paste install/configure commands and a re-probe button, mirroring Jean's per-CLI setup UX, adapted for a server-side orchestrator.

**Architecture:** Backend mirrors the existing Cursor adapter set (`Config` + `ModelCatalog` + `CodingAgent` + `CliRunner`) for OpenCode, wires it into the `CodingAgent.adapter_for/1` facade, the `AgentPreference`/`AgentRouting` validators, and `AssistantController` catalog. `AgentAvailability` is extended from a binary `--version` probe into a richer health record (installed/version/auth) and a 4th `opencode` entry. A new `ToolingAvailability` probe covers supporting tools by **reusing what already exists**: `code-server` (binary `Config.editor_binary/0`, version, `--list-extensions` for the required `openai.chatgpt`/`anthropic.claude-code` extensions, and live `Editor.Server.status/0`) and `cloudflared` (binary, version, and live `Cloudflare.Tunnel.status/0`). Install/configure stays delegated to the **existing scripts** (`scripts/install-code-server.sh`, `scripts/configure-code-server-extensions.sh`, `scripts/public-tunnel.sh` / `make install-code-server`, `make configure-code-server`, `make tunnel-bg`). The tracker gains a `SetupPanel` in Settings with an **Agents** section (`GET /settings/agents/availability`) and a **Supporting tools** section (`GET /settings/tooling/availability`) plus a static install-instructions map.

**Tech Stack:** Elixir (ports/`System.cmd`, Jason), Phoenix controllers, React 19 + TanStack Query + shadcn/ui, vitest, ExUnit.

---

## File Structure

**Create (backend):**
- `elixir/lib/symphony_elixir/opencode/config.ex` — reads `opencode:` workflow section, falls back to `InstanceConfig`.
- `elixir/lib/symphony_elixir/opencode/model_catalog.ex` — runs `opencode models [--refresh]`, parses `provider/model` ids, static fallback.
- `elixir/lib/symphony_elixir/opencode/cli_runner.ex` — spawns one `opencode run` turn, parses output → bridge events (mirror `cursor/cli_runner.ex`).
- `elixir/lib/symphony_elixir/opencode/coding_agent.ex` — `CodingAgent` behaviour impl (mirror `cursor/coding_agent.ex`).
- `elixir/test/symphony_elixir/opencode/config_test.exs`, `model_catalog_test.exs`, `cli_runner_test.exs`, `coding_agent_test.exs`.

**Create (backend — supporting tools):**
- `elixir/lib/symphony_elixir/tooling_availability.ex` — probes `code-server` (+ required extensions + `Editor.Server.status/0`) and `cloudflared` (+ `Cloudflare.Tunnel.status/0`), 60s cache (mirror `AgentAvailability`).
- `elixir/lib/symphony_elixir_web/controllers/tracker/tooling_controller.ex` — `GET /settings/tooling/availability` (+ optional `POST` setup actions in Task 16).
- `elixir/test/symphony_elixir/tooling_availability_test.exs`, `tooling_controller_test.exs`.

**Modify (backend):**
- `elixir/lib/symphony_elixir/coding_agent.ex:17-20` — add `adapter_for("opencode")`.
- `elixir/lib/symphony_elixir/agent_preference.ex:19` — add `"opencode"` to valid kinds.
- `elixir/lib/symphony_elixir/agent_routing.ex:15-17` — add `symphony:opencode` label.
- `elixir/lib/symphony_elixir/instance_config.ex` — add `@default_opencode_command "opencode"` + `opencode_command/0` + `SYMPHONY_OPENCODE_COMMAND`.
- `elixir/lib/symphony_elixir/agent_availability.ex` — 4th entry + richer health record (`installed/version/authenticated/detail`).
- `elixir/lib/symphony_elixir_web/controllers/assistant_controller.ex` — include opencode catalog in `config/2`.
- `elixir/lib/symphony_elixir_web/controllers/issue_controller.ex:193-194` — accept `"opencode"` agent.
- `elixir/lib/symphony_elixir_web/channels/session_log_channel.ex:121` — recognize `opencode` agent_kind for log streaming.

**Create (tracker):**
- `tracker/src/components/settings/AgentSetupPanel.tsx` — agent health cards + install commands + re-probe.
- `tracker/src/components/settings/SupportingToolsPanel.tsx` — code-server + cloudflared cards (status, required-extensions checklist, install/configure commands + re-probe).
- `tracker/src/lib/agentInstallInstructions.ts` — static per-agent install/auth command strings.
- `tracker/src/lib/toolInstallInstructions.ts` — static per-tool install/configure command strings + required-extension ids.
- `tracker/src/services/tooling.ts` — `getToolingAvailability()` (+ optional `runToolSetup()` in Task 16).
- `tracker/src/components/settings/__tests__/AgentSetupPanel.test.tsx`, `SupportingToolsPanel.test.tsx`.

**Modify (tracker):**
- `tracker/src/types/issue.ts` — extend `AgentKind` with `"opencode"`.
- `tracker/src/services/settings.ts` — extend `AgentAvailability` DTO with new health fields.
- `tracker/src/lib/assistantSettings.ts` — add `fallbackOpenCodeCatalog` + include in `fallbackCatalogBundle`, accept `"opencode"` in `loadComposerState`.
- `tracker/src/pages/SettingsPage.tsx` — mount `AgentSetupPanel` + `SupportingToolsPanel`.
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — new keys.

---

## Task 1: Pin the OpenCode CLI contract (spike, recorded)

**Files:** Create `docs/superpowers/notes/opencode-cli-contract.md` (scratch; delete before merge or keep as dev note).

- [ ] **Step 1: Record the real CLI surface** (run on a machine with `opencode` installed)

Run and capture output:
```bash
opencode --version
opencode run --help
opencode models | head -30
opencode auth list
```
Expected: `opencode run` supports a message arg, `-m/--model <provider/model>`, a session/continue flag (`-c/--continue` or `-s/--session <id>`), and a logs/print flag. `opencode models` prints `provider/model` lines (e.g. `anthropic/claude-sonnet-4-6`). `opencode auth list` lists configured credentials or "0 credentials".

- [ ] **Step 2: Decide transport** — Record in the note whether to use (a) `opencode run` reading stdout (per-turn, mirrors Cursor) or (b) `opencode serve` + HTTP/SSE (mirrors Jean's `opencode_server`). **Default for this plan: per-turn `opencode run`** (smallest delta vs the Cursor adapter). Note the exact flags chosen; later tasks reference them as `@run_base_args`.

- [ ] **Step 3: Commit the note** (no production code yet)
```bash
git add docs/superpowers/notes/opencode-cli-contract.md
git commit -m "docs: record OpenCode CLI contract for adapter work"
```

---

## Task 2: InstanceConfig — opencode command default

**Files:**
- Modify: `elixir/lib/symphony_elixir/instance_config.ex`
- Test: `elixir/test/symphony_elixir/instance_config_test.exs` (add case)

- [ ] **Step 1: Write the failing test**

```elixir
test "opencode_command/0 returns default when env unset" do
  System.delete_env("SYMPHONY_OPENCODE_COMMAND")
  SymphonyElixir.InstanceConfig.reload()
  assert SymphonyElixir.InstanceConfig.opencode_command() == "opencode"
end
```

- [ ] **Step 2: Run test (expect fail)**

Run: `cd elixir && mix test test/symphony_elixir/instance_config_test.exs -o`
Expected: FAIL — `function SymphonyElixir.InstanceConfig.opencode_command/0 is undefined`.

- [ ] **Step 3: Implement** — near the codex/claude/cursor command defaults (around line 37-41) add:

```elixir
@default_opencode_command "opencode"
```
and near `cursor_command/0`:
```elixir
@spec opencode_command() :: String.t()
def opencode_command, do: get(:opencode_command, @default_opencode_command)
```
Add `SYMPHONY_OPENCODE_COMMAND` to the env-reading map (follow the existing pattern used for `:cursor_command`).

- [ ] **Step 4: Run test (expect pass)**

Run: `cd elixir && mix test test/symphony_elixir/instance_config_test.exs -o`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/instance_config.ex elixir/test/symphony_elixir/instance_config_test.exs
git commit -m "feat(agents): add opencode_command instance config"
```

---

## Task 3: OpenCode.Config (mirror Cursor.Config)

**Files:**
- Create: `elixir/lib/symphony_elixir/opencode/config.ex`
- Test: `elixir/test/symphony_elixir/opencode/config_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.OpenCode.ConfigTest do
  use ExUnit.Case, async: false
  alias SymphonyElixir.OpenCode.Config

  test "command/0 falls back to instance command when section empty" do
    assert is_binary(Config.command())
    assert String.length(Config.command()) > 0
  end

  test "validate!/0 ok when command present" do
    assert Config.validate!() == :ok
  end
end
```

- [ ] **Step 2: Run test (expect fail)**

Run: `cd elixir && mix test test/symphony_elixir/opencode/config_test.exs -o`
Expected: FAIL — module not loaded.

- [ ] **Step 3: Implement** (copy `cursor/config.ex`, swap names)

```elixir
defmodule SymphonyElixir.OpenCode.Config do
  @moduledoc "OpenCode-specific configuration read from the `opencode:` YAML section."
  @behaviour SymphonyElixir.AgentConfig

  @spec command() :: String.t()
  def command do
    case section_value("command") do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> SymphonyElixir.InstanceConfig.opencode_command()
    end
  end

  @impl SymphonyElixir.AgentConfig
  def validate! do
    if byte_size(String.trim(command())) > 0,
      do: :ok,
      else: {:error, "OpenCode command missing — set opencode.command in WORKFLOW.md"}
  end

  defp section_value(key), do: Map.get(SymphonyElixir.Config.section("opencode"), key)
end
```

- [ ] **Step 4: Run test (expect pass)** — `cd elixir && mix test test/symphony_elixir/opencode/config_test.exs -o` → PASS.

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/opencode/config.ex elixir/test/symphony_elixir/opencode/config_test.exs
git commit -m "feat(opencode): add OpenCode.Config"
```

---

## Task 4: OpenCode.ModelCatalog (mirror Cursor.ModelCatalog)

**Files:**
- Create: `elixir/lib/symphony_elixir/opencode/model_catalog.ex`
- Test: `elixir/test/symphony_elixir/opencode/model_catalog_test.exs`

OpenCode `models` output is one `provider/model` per line (confirmed in Jean's `opencode_cli/commands.rs` parser). Catalog shape must match `Cursor.ModelCatalog` exactly (`agent, agent_label, command, default_model, models[]` with `id/model/label/is_default/default_effort/efforts/input_modalities`). OpenCode has no reasoning-effort flag → `efforts: []`.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.OpenCode.ModelCatalogTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.OpenCode.ModelCatalog

  test "parses provider/model lines and ignores noise" do
    stub = fn -> {"Models cache refreshed\nanthropic/claude-sonnet-4-6\nopencode/gpt-5.5\n", 0} end
    {:ok, catalog} = ModelCatalog.list_models(list_models_fun: stub)
    ids = Enum.map(catalog.models, & &1.id)
    assert "anthropic/claude-sonnet-4-6" in ids
    assert "opencode/gpt-5.5" in ids
    assert Enum.all?(catalog.models, &(&1.efforts == []))
    assert catalog.agent == "opencode"
  end

  test "falls back to static list when CLI fails" do
    {:ok, catalog} = ModelCatalog.list_models(list_models_fun: fn -> {"", 1} end)
    assert catalog.models != []
  end
end
```

- [ ] **Step 2: Run test (expect fail)** — `cd elixir && mix test test/symphony_elixir/opencode/model_catalog_test.exs -o` → FAIL (module missing).

- [ ] **Step 3: Implement** (adapt `cursor/model_catalog.ex`; the `provider/model` validation matches Jean's `is_model_identifier`)

```elixir
defmodule SymphonyElixir.OpenCode.ModelCatalog do
  @moduledoc "OpenCode model catalog shaped like SymphonyElixir.Cursor.ModelCatalog.catalog()."
  require Logger
  alias SymphonyElixir.{InstanceConfig, OpenCode.Config}

  @default_model "opencode/gpt-5.5"
  @fallback_models [
    %{id: "opencode/gpt-5.5", label: "GPT-5.5 (OpenCode)", default: true},
    %{id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false}
  ]

  @spec list_models(keyword()) :: {:ok, map()}
  def list_models(opts \\ []) do
    list_models_fun = Keyword.get(opts, :list_models_fun, &run_list_models/0)

    models =
      case fetch(list_models_fun) do
        {:ok, [_ | _] = parsed} -> parsed
        _ -> @fallback_models
      end

    {:ok,
     %{
       agent: "opencode",
       agent_label: "OpenCode",
       command: Config.command(),
       default_model: @default_model,
       models: Enum.map(models, &present_model/1)
     }}
  end

  defp fetch(fun) do
    case safe(fun) do
      {out, 0} when is_binary(out) -> {:ok, parse(out)}
      {_out, status} -> Logger.warning("OpenCode models exited #{inspect(status)}"); :error
    end
  end

  defp safe(fun), do: fun.()
  rescue
    e -> Logger.warning("OpenCode models raised #{Exception.message(e)}"); {"", 1}

  defp run_list_models do
    [cmd | base] = String.split(Config.command(), " ", trim: true)
    System.cmd(cmd, base ++ ["models"], stderr_to_stdout: true, env: [])
  rescue
    _ -> {"", 1}
  catch
    :exit, _ -> {"", 1}
  end

  defp parse(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&model_identifier?/1)
    |> Enum.uniq()
    |> Enum.map(&%{id: &1, label: &1, default: &1 == @default_model})
  end

  # provider/model or openrouter/provider/model with optional :qualifier
  defp model_identifier?(v) do
    String.contains?(v, "/") and
      Regex.match?(~r{\A[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+(:[A-Za-z0-9._-]+)?\z}, v)
  end

  defp present_model(m) do
    %{
      id: m.id, model: m.id, label: m.label, is_default: m.default,
      default_effort: "", efforts: [], input_modalities: ["text", "image"]
    }
  end
end
```

- [ ] **Step 4: Run test (expect pass)** — `cd elixir && mix test test/symphony_elixir/opencode/model_catalog_test.exs -o` → PASS.

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/opencode/model_catalog.ex elixir/test/symphony_elixir/opencode/model_catalog_test.exs
git commit -m "feat(opencode): add OpenCode.ModelCatalog"
```

---

## Task 5: OpenCode.CliRunner (mirror Cursor.CliRunner)

**Files:**
- Create: `elixir/lib/symphony_elixir/opencode/cli_runner.ex`
- Test: `elixir/test/symphony_elixir/opencode/cli_runner_test.exs`

Reuse Cursor's spawn/timeout/port-kill machinery verbatim (`setsid bash -lc "<command> <args> < prompt"`). Only `build_args/1` and `process_event/3` differ, per the contract recorded in Task 1.

- [ ] **Step 1: Write the failing test for arg building**

```elixir
defmodule SymphonyElixir.OpenCode.CliRunnerTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.OpenCode.CliRunner

  test "build_args includes model and resume session when present" do
    args = CliRunner.build_args(%{cli_session_id: "abc123", model: "opencode/gpt-5.5"})
    assert args =~ "--model opencode/gpt-5.5"
    assert args =~ "abc123"
  end

  test "build_args omits model flag for empty/auto" do
    assert CliRunner.build_args(%{cli_session_id: nil, model: nil}) =~ "run"
    refute CliRunner.build_args(%{cli_session_id: nil, model: nil}) =~ "--model"
  end

  test "build_args rejects unsafe model" do
    refute CliRunner.build_args(%{cli_session_id: nil, model: "x; rm -rf /"}) =~ "rm"
  end
end
```

- [ ] **Step 2: Run test (expect fail)** — `cd elixir && mix test test/symphony_elixir/opencode/cli_runner_test.exs -o` → FAIL.

- [ ] **Step 3: Implement** — copy `cursor/cli_runner.ex` to `opencode/cli_runner.ex`, rename module, replace `build_args/1` with the OpenCode flags from Task 1 (example below assumes `opencode run --print-logs -m <model> [-s <session>]`):

```elixir
@safe_model_regex ~r{\A[A-Za-z0-9._/:-]+\z}
@safe_id_regex ~r/\A[A-Za-z0-9._-]+\z/

@spec build_args(map()) :: String.t()
def build_args(%{cli_session_id: cli_session_id, model: model}) do
  base = "run --print-logs --output-format json"   # confirm exact flags in Task 1
  base <> model_flag(model) <> session_flag(cli_session_id)
end

defp model_flag(model) when is_binary(model) and model not in ["", "auto"] do
  if Regex.match?(@safe_model_regex, model), do: " --model #{model}", else: ""
end
defp model_flag(_), do: ""

defp session_flag(id) when is_binary(id) do
  if Regex.match?(@safe_id_regex, id), do: " --session #{id}", else: ""
end
defp session_flag(_), do: ""
```
Adjust `process_event/3` to map OpenCode's output events to the bridge vocabulary (`item/progress`, `item/created` text + tool_call/tool_result, `turn/completed`, `turn/failed`) exactly as the Cursor runner does, using the event shapes recorded in Task 1. If `--output-format json` is unavailable, parse text deltas into a single `item/created` text item.

- [ ] **Step 4: Run test (expect pass)** — `cd elixir && mix test test/symphony_elixir/opencode/cli_runner_test.exs -o` → PASS.

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/opencode/cli_runner.ex elixir/test/symphony_elixir/opencode/cli_runner_test.exs
git commit -m "feat(opencode): add OpenCode.CliRunner"
```

---

## Task 6: OpenCode.CodingAgent (mirror Cursor.CodingAgent) + facade wiring

**Files:**
- Create: `elixir/lib/symphony_elixir/opencode/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/coding_agent.ex:17-20`
- Test: `elixir/test/symphony_elixir/opencode/coding_agent_test.exs`

- [ ] **Step 1: Write the failing test (routing)**

```elixir
test "CodingAgent.adapter_for/1 routes opencode" do
  assert SymphonyElixir.CodingAgent.adapter_for("opencode") == SymphonyElixir.OpenCode.CodingAgent
end
```
(Place in `elixir/test/symphony_elixir/coding_agent_test.exs`.)

- [ ] **Step 2: Run test (expect fail)** — FAIL (routes to default).

- [ ] **Step 3: Implement** — copy `cursor/coding_agent.ex` → `opencode/coding_agent.ex` (rename module, alias `OpenCode.CliRunner`/`OpenCode.Config`, keep ToolGateway MCP wiring; OpenCode reads MCP from its own config — confirm path in Task 1, default to writing `<workspace>/opencode.json` or `.opencode/mcp.json`). Then edit the facade:

```elixir
def adapter_for("codex"), do: SymphonyElixir.Codex.CodingAgent
def adapter_for("claude"), do: SymphonyElixir.Claude.CodingAgent
def adapter_for("cursor"), do: SymphonyElixir.Cursor.CodingAgent
def adapter_for("opencode"), do: SymphonyElixir.OpenCode.CodingAgent
def adapter_for(_), do: adapter_for(Config.default_agent_kind())
```

- [ ] **Step 4: Run test (expect pass)** — PASS.

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/opencode/coding_agent.ex elixir/lib/symphony_elixir/coding_agent.ex elixir/test/symphony_elixir/opencode/coding_agent_test.exs elixir/test/symphony_elixir/coding_agent_test.exs
git commit -m "feat(opencode): add OpenCode.CodingAgent + facade route"
```

---

## Task 7: Routing & validation (preference, routing labels, controllers, channel)

**Files:**
- Modify: `agent_preference.ex:19`, `agent_routing.ex:15-17`, `issue_controller.ex:193-194`, `session_log_channel.ex:121`
- Test: `elixir/test/symphony_elixir/agent_preference_test.exs`, `agent_routing_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
test "opencode is a valid agent kind" do
  assert "opencode" in SymphonyElixir.AgentPreference.valid_kinds()
end

test "routing label for opencode" do
  assert SymphonyElixir.AgentRouting.label_for("opencode") == "symphony:opencode"
end
```

- [ ] **Step 2: Run (expect fail).** `cd elixir && mix test test/symphony_elixir/agent_preference_test.exs test/symphony_elixir/agent_routing_test.exs -o`

- [ ] **Step 3: Implement** — add `"opencode"` to `@valid_kinds` (`agent_preference.ex:19`); add the `symphony:opencode` label mapping (`agent_routing.ex:15-17`); add `"opencode"` to the accepted agent list in `issue_controller.ex` (~193-194); add `"opencode"` to the recognized `agent_kind` branch in `session_log_channel.ex:121`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/agent_preference.ex elixir/lib/symphony_elixir/agent_routing.ex elixir/lib/symphony_elixir_web/controllers/issue_controller.ex elixir/lib/symphony_elixir_web/channels/session_log_channel.ex elixir/test/symphony_elixir/agent_preference_test.exs elixir/test/symphony_elixir/agent_routing_test.exs
git commit -m "feat(opencode): route, validate, and stream logs for opencode agent"
```

---

## Task 8: Richer AgentAvailability health record + opencode entry

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_availability.ex`
- Test: `elixir/test/symphony_elixir/agent_availability_test.exs`

Extend `result` from `%{available, version, command}` to `%{available, version, command, authenticated, detail}` and add the `opencode` key. `authenticated` is `nil` when unknown, `true/false` when checkable (`opencode auth list`, `cursor-agent status`, etc.). Keep the 60s cache.

- [ ] **Step 1: Write failing test**

```elixir
test "probe/0 includes opencode with health fields" do
  SymphonyElixir.AgentAvailability.invalidate_cache()
  result = SymphonyElixir.AgentAvailability.probe()
  assert Map.has_key?(result, :opencode)
  assert Map.has_key?(result.opencode, :authenticated)
  assert Map.has_key?(result.opencode, :detail)
end
```

- [ ] **Step 2: Run (expect fail).** `cd elixir && mix test test/symphony_elixir/agent_availability_test.exs -o`

- [ ] **Step 3: Implement** — add `opencode: probe_command(InstanceConfig.opencode_command())` to the `probe/0` map; extend `@type result`; have `probe_command/1` return `authenticated: nil, detail: nil` for unknown and fill `version` as today. (Auth probing per agent can be a follow-up; ship the field as `nil` now so the UI renders "unknown".)

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir/agent_availability.ex elixir/test/symphony_elixir/agent_availability_test.exs
git commit -m "feat(agents): add opencode + health fields to AgentAvailability probe"
```

---

## Task 9: AssistantController exposes opencode catalog

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/assistant_controller.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/assistant_controller_test.exs`

- [ ] **Step 1: Write failing test** — assert `GET /assistant/config` agents array includes an `agent: "opencode"` catalog with non-empty `models`.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — in `config/2`, add `OpenCode.ModelCatalog.list_models/0` to the agents list (alongside codex/claude/cursor catalogs), guarded so a CLI failure falls back to the static catalog (the catalog module already does this).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add elixir/lib/symphony_elixir_web/controllers/assistant_controller.ex elixir/test/symphony_elixir_web/controllers/assistant_controller_test.exs
git commit -m "feat(opencode): expose opencode catalog from /assistant/config"
```

---

## Task 10: Tracker types + fallback catalog accept opencode

**Files:**
- Modify: `tracker/src/types/issue.ts`, `tracker/src/lib/assistantSettings.ts`
- Test: `tracker/src/lib/__tests__/assistantSettings.test.ts` (or existing)

- [ ] **Step 1: Write failing test**

```ts
import { fallbackCatalogBundle, catalogFor } from "@/lib/assistantSettings";
it("includes an opencode fallback catalog", () => {
  const bundle = fallbackCatalogBundle();
  const oc = catalogFor(bundle, "opencode");
  expect(oc.agent).toBe("opencode");
  expect(oc.models.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/lib/__tests__/assistantSettings.test.ts` → FAIL (`"opencode"` not assignable to `AgentKind`).

- [ ] **Step 3: Implement**
- In `tracker/src/types/issue.ts`, extend `AgentKind` to include `"opencode"`.
- In `assistantSettings.ts`, add `fallbackOpenCodeCatalog(command = "opencode", t)` mirroring `fallbackCursorCatalog` (models: `opencode/gpt-5.5` default, `anthropic/claude-sonnet-4-6`; all `efforts: []`), include it in `fallbackCatalogBundle().agents`, and accept `"opencode"` in `loadComposerState` agent guard.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add tracker/src/types/issue.ts tracker/src/lib/assistantSettings.ts tracker/src/lib/__tests__/assistantSettings.test.ts
git commit -m "feat(opencode): tracker AgentKind + fallback catalog"
```

---

## Task 11: Install-instructions map + settings DTO

**Files:**
- Create: `tracker/src/lib/agentInstallInstructions.ts`
- Modify: `tracker/src/services/settings.ts`
- Test: `tracker/src/lib/__tests__/agentInstallInstructions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { AGENT_INSTALL } from "@/lib/agentInstallInstructions";
it("has install + auth commands for each agent", () => {
  for (const k of ["codex", "claude", "cursor", "opencode"] as const) {
    expect(AGENT_INSTALL[k].install.length).toBeGreaterThan(0);
    expect(typeof AGENT_INSTALL[k].auth).toBe("string");
  }
});
```

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement**

```ts
import type { AgentKind } from "@/types/issue";
export interface AgentInstallInfo { label: string; install: string[]; auth: string; docsUrl: string }
export const AGENT_INSTALL: Record<AgentKind, AgentInstallInfo> = {
  codex: { label: "Codex CLI", install: ["npm i -g @openai/codex"], auth: "codex login", docsUrl: "https://github.com/openai/codex" },
  claude: { label: "Claude Code", install: ["npm i -g @anthropic-ai/claude-code"], auth: "claude /login", docsUrl: "https://docs.anthropic.com/claude-code" },
  cursor: { label: "Cursor Agent", install: ["curl https://cursor.com/install -fsS | bash"], auth: "cursor-agent login", docsUrl: "https://cursor.com/cli" },
  opencode: { label: "OpenCode", install: ["curl -fsSL https://opencode.ai/install | bash", "# or: npm i -g opencode-ai"], auth: "opencode auth login", docsUrl: "https://opencode.ai" },
};
```
Extend the `AgentAvailability` DTO in `settings.ts` to include `authenticated: boolean | null` and `detail: string | null` per agent, and add `opencode` to its keys.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add tracker/src/lib/agentInstallInstructions.ts tracker/src/services/settings.ts tracker/src/lib/__tests__/agentInstallInstructions.test.ts
git commit -m "feat(agents): install-instructions map + extended availability DTO"
```

---

## Task 12: AgentSetupPanel component

**Files:**
- Create: `tracker/src/components/settings/AgentSetupPanel.tsx`
- Test: `tracker/src/components/settings/__tests__/AgentSetupPanel.test.tsx`
- Modify: `tracker/src/pages/SettingsPage.tsx`, locale files.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { AgentSetupPanel } from "@/components/settings/AgentSetupPanel";

it("renders a health card per agent with install command when not installed", () => {
  render(<AgentSetupPanel availability={{
    codex: { available: true, version: "1.2.3", command: "codex", authenticated: true, detail: null },
    claude: { available: true, version: "2.0", command: "claude", authenticated: null, detail: null },
    cursor: { available: false, version: null, command: "cursor-agent", authenticated: null, detail: null },
    opencode: { available: false, version: null, command: "opencode", authenticated: null, detail: null },
  }} isLoading={false} onReprobe={() => {}} />);
  expect(screen.getByText(/OpenCode/)).toBeInTheDocument();
  expect(screen.getByText(/opencode auth login/)).toBeInTheDocument(); // shown because not installed
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/settings/__tests__/AgentSetupPanel.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — a card grid (one card per `AgentKind`) showing: status dot (green=available+auth, amber=available/auth-unknown, red=missing), version, command. When `!available`, render the `AGENT_INSTALL[k].install` lines in a copy button block + the `auth` command; a "Re-check" button calls `onReprobe`. Use existing shadcn `Card`, `Button`, and the `StatusDot`/badge components in `tracker/src/components/ui`. Add i18n keys under `settings.agents.*` to both locale files. Mount `<AgentSetupPanel>` in `SettingsPage.tsx`, fetching availability via the existing settings query (add a tiny `useAgentAvailability` hook if absent that calls `GET /settings/agents/availability` and exposes `refetch` as `onReprobe`).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit**
```bash
git add tracker/src/components/settings/AgentSetupPanel.tsx tracker/src/components/settings/__tests__/AgentSetupPanel.test.tsx tracker/src/pages/SettingsPage.tsx tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(agents): Agent Setup panel with health + install commands"
```

---

## Task 13: ToolingAvailability probe (code-server + cloudflared)

**Files:**
- Create: `elixir/lib/symphony_elixir/tooling_availability.ex`
- Test: `elixir/test/symphony_elixir/tooling_availability_test.exs`

Mirror `AgentAvailability` (60s `:persistent_term` cache, injectable probes for tests). Report two tools, reusing the live status that already exists rather than re-deriving it:

- `code_server`: `%{available, version, command, editor_status, extensions: %{"openai.chatgpt" => bool, "anthropic.claude-code" => bool}}` — binary = `Config.editor_binary/0`; `version` via `code-server --version`; `editor_status` = `Editor.Server.status/0` (`:starting | :ready | :unavailable`); `extensions` parsed from `code-server --list-extensions` (the two ids the `configure-code-server-extensions.sh` script installs).
- `cloudflared`: `%{available, version, command, tunnel_status}` — binary `"cloudflared"`; `version` via `cloudflared --version`; `tunnel_status` = `Cloudflare.Tunnel.status/0` (`:running | :stopped | :disabled`).

- [ ] **Step 1: Write failing test**

```elixir
test "probe/0 reports code_server with required-extension flags + editor status" do
  SymphonyElixir.ToolingAvailability.invalidate_cache()
  result = SymphonyElixir.ToolingAvailability.probe()
  assert Map.has_key?(result, :code_server)
  assert Map.has_key?(result.code_server.extensions, "openai.chatgpt")
  assert Map.has_key?(result.code_server.extensions, "anthropic.claude-code")
  assert result.code_server.editor_status in [:starting, :ready, :unavailable]
end

test "probe/0 reports cloudflared with tunnel status" do
  SymphonyElixir.ToolingAvailability.invalidate_cache()
  result = SymphonyElixir.ToolingAvailability.probe()
  assert Map.has_key?(result, :cloudflared)
  assert result.cloudflared.tunnel_status in [:running, :stopped, :disabled]
end
```

- [ ] **Step 2: Run (expect fail)** — `cd elixir && mix test test/symphony_elixir/tooling_availability_test.exs -o`

- [ ] **Step 3: Implement** — `probe/0` returns `%{code_server: ..., cloudflared: ...}`; `extensions/1` runs `<binary> --list-extensions` and maps each required id to a boolean (missing binary → all `false`); guard every `System.cmd` with rescue/catch (a missing binary must never crash the probe); cache like `AgentAvailability`. Required-extension ids live in a single `@required_code_server_extensions ~w(openai.chatgpt anthropic.claude-code)` so the list has one source of truth.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(setup): tooling availability probe for code-server + cloudflared`.

---

## Task 14: Tooling availability endpoint

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/tooling_controller.ex` + route + test.

- [ ] **Step 1: Write failing test** — `GET /settings/tooling/availability` returns JSON with `codeServer` (available/version/editorStatus/extensions map) and `cloudflared` (available/version/tunnelStatus).

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `availability/2` calls `ToolingAvailability.probe/0`, presents snake→camel (reuse the settings/availability presenter pattern). Add the route next to the existing `GET /settings/agents/availability`.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(setup): GET /settings/tooling/availability`.

---

## Task 15: Tool install-instructions map + tracker service

**Files:**
- Create: `tracker/src/lib/toolInstallInstructions.ts`, `tracker/src/services/tooling.ts`
- Test: `tracker/src/lib/__tests__/toolInstallInstructions.test.ts`, `src/services/__tests__/tooling.test.ts`

- [ ] **Step 1: Write failing tests** — `TOOL_INSTALL` has `codeServer` and `cloudflared` entries each with non-empty `install` lines + a `configure`/`auth` line + `docsUrl`; `codeServer.requiredExtensions` lists the two ids; `getToolingAvailability()` maps the DTO (snake→camel).

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/lib/__tests__/toolInstallInstructions.test.ts`

- [ ] **Step 3: Implement** — surface the **existing** make targets / scripts as copy-paste commands:

```ts
export const TOOL_INSTALL = {
  codeServer: {
    label: "VS Code Server (code-server)",
    install: ["make install-code-server", "# or: scripts/install-code-server.sh"],
    configure: "make configure-code-server", // installs openai.chatgpt + anthropic.claude-code, disables Copilot
    requiredExtensions: ["openai.chatgpt", "anthropic.claude-code"],
    docsUrl: "https://coder.com/docs/code-server",
  },
  cloudflared: {
    label: "Cloudflare Tunnel (cloudflared)",
    install: [
      "# macOS: brew install cloudflared",
      "# Debian/Ubuntu: see https://pkg.cloudflare.com/",
    ],
    auth: "cloudflared tunnel login", // then create/route the named tunnel
    start: "make tunnel-bg",
    docsUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
  },
} as const;
```

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(setup): tool install-instructions map + tooling service`.

---

## Task 16: SupportingToolsPanel + mount (optional: server-triggered setup actions)

**Files:**
- Create: `tracker/src/components/settings/SupportingToolsPanel.tsx` + test.
- Modify: `tracker/src/pages/SettingsPage.tsx`, locale files.

- [ ] **Step 1: Write failing test**

```tsx
it("shows code-server card with required-extension checklist and configure command", () => {
  render(<SupportingToolsPanel availability={{
    codeServer: { available: true, version: "4.x", editorStatus: "ready",
      extensions: { "openai.chatgpt": true, "anthropic.claude-code": false } },
    cloudflared: { available: false, version: null, tunnelStatus: "disabled" },
  }} isLoading={false} onReprobe={() => {}} />);
  expect(screen.getByText(/anthropic\.claude-code/)).toBeInTheDocument();      // listed as missing
  expect(screen.getByText(/make configure-code-server/)).toBeInTheDocument();  // shown because an extension is missing
  expect(screen.getByText(/cloudflared/)).toBeInTheDocument();                 // missing → install commands shown
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/components/settings/__tests__/SupportingToolsPanel.test.tsx`

- [ ] **Step 3: Implement**
- **code-server card:** status dot from `available` + `editorStatus` (ready=green, starting=amber, unavailable/absent=red); version; a **required-extensions checklist** (✓/✗ per id from `requiredExtensions`); when not installed → show `install` commands; when installed but an extension is missing → show the `configure` command; "Re-check" → `onReprobe`.
- **cloudflared card:** status dot from `available` + `tunnelStatus` (running=green, stopped=amber, disabled/absent=grey/red); version; when missing → `install` lines; show `auth` + `start` commands; "Re-check".
- Mount `<SupportingToolsPanel>` under `<AgentSetupPanel>` in `SettingsPage.tsx`, fed by a `useToolingAvailability` query (`GET /settings/tooling/availability`) exposing `refetch` as `onReprobe`. i18n keys under `settings.tools.*` (en + pt-BR).

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5 (OPTIONAL): server-triggered setup actions** — only if running installers from the UI is desired. Add `POST /settings/tooling/:tool/:action` (`code_server/install`, `code_server/configure`, `cloudflared/start`) that shells the **existing idempotent scripts** via `System.cmd`, **behind a config flag** (default off) and **localhost-bind only**, returning combined output; add a guarded "Run" button per card that invalidates the availability query on completion. Default of this plan: **commands + re-probe only** (consistent with the agent cards); ship 5 only if explicitly wanted.

- [ ] **Step 6: Commit** — `feat(setup): Supporting Tools panel (code-server + cloudflared)`.

---

## Task 17: Full gates + docs

- [ ] **Step 1: Backend gate** — `cd elixir && mix specs.check && make all` → all pass (format, lint, coverage, dialyzer, specs).
- [ ] **Step 2: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 3: Update docs** — add `opencode:` section example to `elixir/README.md` workflow_markdown docs, `SYMPHONY_OPENCODE_COMMAND` to `.env.example`, and a line in `../SPEC.md` listing OpenCode as a supported backend. Document the **Supporting tools** setup section: link `make install-code-server` / `make configure-code-server` (required extensions `openai.chatgpt` + `anthropic.claude-code`) and `make tunnel-bg` (cloudflared named tunnel), referencing the existing `INSTALL.md`. Remove the scratch note from Task 1 if not keeping it.
- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "docs(setup): document opencode backend + agent/tooling setup panel"
```

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| OpenCode as a backend we don't currently have | 2–7, 9, 10 |
| "Nice install" / setup flow | 8, 11, 12 (server-appropriate: health + copy-paste install + re-probe) |
| Setup of the existing CLIs | 8, 11, 12 (codex/claude/cursor cards) |
| List all models for opencode | 4, 9, 10 |
| **VS Code server (code-server) + required plugins** | 13, 14, 15, 16 (status + `openai.chatgpt`/`anthropic.claude-code` checklist + `make install/configure-code-server`) |
| **Cloudflare tunnel (cloudflared)** | 13, 14, 15, 16 (binary/version + live tunnel status + install/login/`make tunnel-bg`) |

**Notes:**
- "Install" is surfaced as guided commands + re-probe (server-side orchestrator), not binary download. If literal Jean-style server-side download is wanted later, add an `OpenCode.Installer` that downloads `anomalyco/opencode` release assets into a managed dir (mirror `opencode_cli/commands.rs`) and a progress channel — that is a separate plan.
- The supporting-tools tasks deliberately **reuse what already exists**: the `scripts/install-code-server.sh`, `scripts/configure-code-server-extensions.sh` (required extensions `openai.chatgpt` + `anthropic.claude-code`, Copilot disabled), and `scripts/public-tunnel.sh` scripts, plus the live `Editor.Server.status/0` and `Cloudflare.Tunnel.status/0`. The plan adds **detection + UI + a re-probe loop**, not new install logic. Server-triggered "Run" buttons are an opt-in (Task 16, Step 5), gated and localhost-only, because shelling installers from a web UI is a privilege/security boundary.
