# Cursor Plan Interactive UX — Implementation Plan

**Goal:** Em Plan, MCP Symphony não auto-rejeita; cards Task/CreatePlan ficam legíveis (CreatePlan abre KB); sessões Cursor interativas usam ACP para permissões, perguntas e CreatePlan bloqueante.

**Architecture:** (1) `ExecutionMode.cursor_force?/1` + `CliRunner.force_flag/1` sempre `--force`, inclusive Plan, com `--mode plan` mantido. (2) Remover `:deny_plan` no gateway Cursor. (3) Enrich `toolCallDisplay` / `assistantToolCallToView` / `sessionToolCall` + click CreatePlan → KB. (4) Novo client ACP sob `elixir/lib/symphony_elixir/cursor/` para sessões interativas, mapeando blocking methods aos brokers/cards existentes.

**Tech Stack:** Elixir/OTP, Cursor CLI (`agent acp` + legado `--print` para non-interactive), Phoenix Channel, React/Vitest tracker.

**Spec:** [`../specs/2026-07-16-cursor-plan-interactive-ux-design.md`](../specs/2026-07-16-cursor-plan-interactive-ux-design.md)

**WSL:** um arquivo ou filtro de teste por vez; sem suites repository-wide.

---

## File map

| File | Responsibility |
|------|----------------|
| `elixir/lib/symphony_elixir/execution_mode.ex` | `cursor_force?/1` → true para todos os modes |
| `elixir/lib/symphony_elixir/cursor/cli_runner.ex` | `force_flag("plan")` → `" --force"` (stdlib-only; espelha ExecutionMode) |
| `elixir/lib/symphony_elixir/cursor/coding_agent.ex` | Remover `:deny_plan`; escolher ACP vs print por interativo |
| `elixir/lib/symphony_elixir/cursor/acp_client.ex` | **Create** — JSON-RPC stdio, request/response, blocking waiters |
| `elixir/lib/symphony_elixir/cursor/acp_bridge.ex` | **Create** — `session/update` → bridge events; permission/ask/plan → callbacks |
| `elixir/test/symphony_elixir/execution_mode_test.exs` | Force em plan |
| `elixir/test/symphony_elixir/cursor/cli_runner_test.exs` | Plan args incluem `--force` |
| `elixir/test/symphony_elixir/cursor/coding_agent_test.exs` | Plan permite MCP mutável |
| `elixir/test/symphony_elixir/cursor/acp_client_test.exs` | **Create** |
| `elixir/test/symphony_elixir/cursor/acp_bridge_test.exs` | **Create** |
| `tracker/src/lib/toolCallDisplay.ts` | Parsers Task/CreatePlan + labels |
| `tracker/src/lib/__tests__/toolCallDisplay.test.ts` | Unit tests |
| `tracker/src/components/assistant/assistantToolCall.ts` | View enrich |
| `tracker/src/components/issues/issue-detail/sessionToolCall.ts` | View enrich session log |
| `tracker/src/components/shared/ToolCallBlock.tsx` | Ação Abrir KB / Aceitar / Rejeitar |
| `tracker/src/components/assistant/ProjectAssistantPanel.tsx` | Wire open KB + create_plan submit |
| `tracker/locales/en/tracker.json` + `pt-BR` | Strings Plan/Task/Subagent/Open KB |

---

### Task 1: Plan gets `--force` (ExecutionMode + CliRunner)

**Files:**
- Modify: `elixir/lib/symphony_elixir/execution_mode.ex`
- Modify: `elixir/lib/symphony_elixir/cursor/cli_runner.ex`
- Modify: `elixir/test/symphony_elixir/execution_mode_test.exs`
- Modify: `elixir/test/symphony_elixir/cursor/cli_runner_test.exs`

- [ ] **Step 1: Update failing expectations in `execution_mode_test.exs`**

Replace the plan force assertion:

```elixir
test "cursor_force?/1 is true for every mode including plan" do
  assert ExecutionMode.cursor_force?("plan")
  assert ExecutionMode.cursor_force?("build")
  assert ExecutionMode.cursor_force?("yolo")
  assert ExecutionMode.cursor_force?(nil)
end
```

- [ ] **Step 2: Run the single test — expect FAIL**

Run (from `elixir/`):

```bash
mix test test/symphony_elixir/execution_mode_test.exs --only line:75
```

Or filter by test name if preferred. Expected: FAIL (`refute` still present or `cursor_force?("plan")` false).

- [ ] **Step 3: Implement `cursor_force?/1`**

In `execution_mode.ex`, replace the body and moduledoc:

```elixir
@doc """
Whether cursor-agent should run with `--force`.

Always true. Headless/ACP Cursor rejects MCP tools without force; Symphony
gates mutating MCP on interactive Build via ToolGateway approval instead.
Plan still passes `--mode plan` separately.
"""
@spec cursor_force?(term()) :: boolean()
def cursor_force?(_mode), do: true
```

- [ ] **Step 4: Re-run execution_mode test — expect PASS**

```bash
mix test test/symphony_elixir/execution_mode_test.exs --only line:<new_line>
```

- [ ] **Step 5: Update `cli_runner_test.exs` Plan expectations**

In the test `"execution mode maps plan to native cursor plan mode; build/yolo get force"`:

```elixir
plan_args = CliRunner.build_args(%{cli_session_id: nil, model: nil, mcp_config_path: nil, execution_mode: "plan"})
assert plan_args =~ "--mode plan"
assert plan_args =~ "--trust"
assert plan_args =~ "--force"
```

- [ ] **Step 6: Run cli_runner test — expect FAIL**

```bash
mix test test/symphony_elixir/cursor/cli_runner_test.exs --only line:101
```

Expected: FAIL on `refute plan_args =~ "--force"`.

- [ ] **Step 7: Implement CliRunner `force_flag/1`**

```elixir
# Always --force (mirrors ExecutionMode.cursor_force?/1). Kept inline (not via
# ExecutionMode) to honor this component's stdlib-only boundary. Plan still
# adds --mode plan via mode_flag/1.
defp force_flag(_execution_mode), do: " --force"
```

Remove the `force_flag("plan")` clause. Update the moduledoc line that says plan stays without force.

- [ ] **Step 8: Re-run cli_runner test — expect PASS**

```bash
mix test test/symphony_elixir/cursor/cli_runner_test.exs --only line:101
```

- [ ] **Step 9: Commit** (only if the user asked to commit)

```bash
git add elixir/lib/symphony_elixir/execution_mode.ex \
  elixir/lib/symphony_elixir/cursor/cli_runner.ex \
  elixir/test/symphony_elixir/execution_mode_test.exs \
  elixir/test/symphony_elixir/cursor/cli_runner_test.exs
git commit -m "$(cat <<'EOF'
fix(cursor): pass --force in plan so MCP tools are not auto-rejected

EOF
)"
```

---

### Task 2: Remove Plan MCP deny in Cursor gateway

**Files:**
- Modify: `elixir/lib/symphony_elixir/cursor/coding_agent.ex`
- Modify: `elixir/test/symphony_elixir/cursor/coding_agent_test.exs`
- Modify: `elixir/lib/symphony_elixir/execution_mode.ex` (`cursor_interactive_approval?/2` docs — Plan no longer “denies mutations”)

- [ ] **Step 1: Rewrite the Plan MCP test to expect allow**

Replace test `"yolo runs mutating MCP tools without approval; plan denies them"` with:

```elixir
test "yolo and plan run mutating MCP tools without approval; interactive build still gates" do
  {root, ws} = workspace()
  {:ok, calls} = Agent.start_link(fn -> [] end)

  executor = fn name, args ->
    Agent.update(calls, &[{name, args} | &1])
    %{"success" => true, "contentItems" => []}
  end

  {:ok, plan_session} =
    CodingAgent.start_session(ws,
      workspace_root: root,
      cursor_command: "FAKE_CURSOR_MODE=happy #{@fake}",
      dynamic_tools: [@create_issue_spec, @list_issues_spec],
      tool_executor: executor,
      execution_mode: "plan",
      interactive_user_input: true,
      on_approval_required: fn _ -> flunk("plan must not request approval") end
    )

  plan_exec = gateway_executor!(plan_session.gateway_token)
  assert plan_exec.("create_issue", %{"title" => "Go"})["success"] == true
  assert plan_exec.("list_issues", %{})["success"] == true
  CodingAgent.stop_session(plan_session)
  Agent.stop(calls)
end
```

Keep the existing interactive-build approval test unchanged.

- [ ] **Step 2: Run coding_agent test — expect FAIL**

```bash
mix test test/symphony_elixir/cursor/coding_agent_test.exs --only line:232
```

Expected: FAIL with Plan mode is read-only (or old test name).

- [ ] **Step 3: Remove `:deny_plan` from `tool_gate/3`**

```elixir
defp tool_gate(tool, mode, interactive?) do
  cond do
    ToolExecutor.read_only_tool?(tool) ->
      :allow

    ExecutionMode.cursor_interactive_approval?(mode, interactive?) ->
      :require_approval

    true ->
      :allow
  end
end
```

Remove the `:deny_plan` branch in `wrap_executor/3` match.

Update `cursor_interactive_approval?/2` moduledoc: delete “plan denies mutations without prompting”.

- [ ] **Step 4: Re-run — expect PASS**

```bash
mix test test/symphony_elixir/cursor/coding_agent_test.exs --only line:232
```

- [ ] **Step 5: Commit** (if requested)

```bash
git commit -m "$(cat <<'EOF'
fix(cursor): allow Symphony MCP tools in plan mode at the gateway

EOF
)"
```

---

### Task 3: Parse Task / CreatePlan display helpers

**Files:**
- Modify: `tracker/src/lib/toolCallDisplay.ts`
- Modify: `tracker/src/lib/__tests__/toolCallDisplay.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import {
  formatToolOutput,
  resolveCreatePlanKbPath,
  resolveSubagentTypeLabel,
  resolveToolDisplayName,
  enrichCursorToolPresentation,
} from "@/lib/toolCallDisplay";

describe("enrichCursorToolPresentation", () => {
  it("labels Task with explore subagent and description", () => {
    const args = {
      description: "Explore frontend for GAM-20 context",
      subagentType: "explore",
      prompt: "long…",
    };
    expect(enrichCursorToolPresentation("Task", args)).toEqual({
      toolType: "Task · Explore",
      description: "Explore frontend for GAM-20 context",
      detailLanguage: "json",
      detailMarkdown: null,
      kbPath: null,
      kind: "task",
    });
  });

  it("maps unspecified subagentType to Subagent", () => {
    expect(resolveSubagentTypeLabel({ unspecified: {} })).toBe("Subagent");
    expect(resolveSubagentTypeLabel(undefined)).toBe("Subagent");
  });

  it("labels CreatePlan and extracts kb path from plan markdown", () => {
    const args = {
      name: "GAM-20 Spec Design",
      overview: "Criar a spec de design da GAM-20",
      plan: "See [spec](frontend/docs/superpowers/specs/2026-07-16-gam-20-symphony-preview-check-design.md).",
      planUri: null,
    };
    const view = enrichCursorToolPresentation("CreatePlan", args);
    expect(view.toolType).toBe("Plan · GAM-20 Spec Design");
    expect(view.description).toBe("Criar a spec de design da GAM-20");
    expect(view.kind).toBe("create_plan");
    expect(view.detailLanguage).toBe("markdown");
    expect(view.detailMarkdown).toContain("See [spec]");
    expect(view.kbPath).toBe(
      "frontend/docs/superpowers/specs/2026-07-16-gam-20-symphony-preview-check-design.md",
    );
  });

  it("prefers planUri over markdown links", () => {
    expect(
      resolveCreatePlanKbPath({
        planUri: "docs/superpowers/specs/from-uri.md",
        plan: "[x](docs/other.md)",
      }),
    ).toBe("docs/superpowers/specs/from-uri.md");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd tracker && npm test -- src/lib/__tests__/toolCallDisplay.test.ts
```

Expected: FAIL — exports missing.

- [ ] **Step 3: Implement helpers in `toolCallDisplay.ts`**

```ts
export type CursorToolKind = "task" | "create_plan" | "other";

export interface CursorToolPresentation {
  toolType: string;
  description: string | null;
  detailLanguage: "json" | "markdown";
  detailMarkdown: string | null;
  kbPath: string | null;
  kind: CursorToolKind;
}

const TASK_NAMES = new Set(["task", "Task", "cursor/task"]);
const PLAN_NAMES = new Set(["createplan", "create_plan", "CreatePlan", "cursor/create_plan"]);

export function enrichCursorToolPresentation(
  name: string,
  args: unknown,
): CursorToolPresentation {
  const record = asRecord(args);
  if (isTaskName(name)) {
    const description = truncateMeta(stringField(record, "description"));
    const typeLabel = resolveSubagentTypeLabel(record?.subagentType ?? record?.subagent_type);
    return {
      toolType: `Task · ${typeLabel}`,
      description,
      detailLanguage: "json",
      detailMarkdown: null,
      kbPath: null,
      kind: "task",
    };
  }
  if (isPlanName(name)) {
    const planName = stringField(record, "name");
    const overview = truncateMeta(stringField(record, "overview"));
    const planMd = stringField(record, "plan");
    return {
      toolType: planName ? `Plan · ${planName}` : "Plan",
      description: overview,
      detailLanguage: planMd ? "markdown" : "json",
      detailMarkdown: planMd,
      kbPath: resolveCreatePlanKbPath(record),
      kind: "create_plan",
    };
  }
  return {
    toolType: resolveToolDisplayName(name),
    description: null,
    detailLanguage: "json",
    detailMarkdown: null,
    kbPath: null,
    kind: "other",
  };
}

export function resolveSubagentTypeLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    if (value === "unspecified") return "Subagent";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("unspecified" in record) return "Subagent";
    if (typeof record.custom === "string" && record.custom.trim()) return record.custom.trim();
    const key = Object.keys(record)[0];
    if (key) return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return "Subagent";
}

export function resolveCreatePlanKbPath(args: unknown): string | null {
  const record = asRecord(args);
  if (!record) return null;
  const uri = stringField(record, "planUri") ?? stringField(record, "plan_uri");
  if (uri) return normalizeDocsPath(uri);
  const plan = stringField(record, "plan");
  if (!plan) return null;
  const mdLink = plan.match(/\(([^)]*docs\/[^)]+\.md)\)/);
  if (mdLink?.[1]) return normalizeDocsPath(mdLink[1]);
  const bare = plan.match(/(?:^|\s)((?:[\w.-]+\/)*docs\/[\w./-]+\.md)/);
  if (bare?.[1]) return normalizeDocsPath(bare[1]);
  return null;
}

function normalizeDocsPath(raw: string): string {
  return raw.replace(/^\.?\//, "").trim();
}

function truncateMeta(value: string | null): string | null {
  if (!value) return null;
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

function isTaskName(name: string): boolean {
  return TASK_NAMES.has(name) || name.toLowerCase() === "task";
}

function isPlanName(name: string): boolean {
  const n = name.toLowerCase().replace(/_/g, "");
  return n === "createplan" || PLAN_NAMES.has(name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}
```

Keep existing `resolveToolDisplayName` / `formatToolOutput`.

- [ ] **Step 4: Re-run — expect PASS**

```bash
cd tracker && npm test -- src/lib/__tests__/toolCallDisplay.test.ts
```

---

### Task 4: Wire views (`assistantToolCall` + `sessionToolCall`)

**Files:**
- Modify: `tracker/src/components/assistant/assistantToolCall.ts`
- Modify: `tracker/src/components/issues/issue-detail/sessionToolCall.ts`
- Modify: `tracker/src/components/shared/ToolCallBlock.tsx` (`ToolCallView` fields)
- Modify: `tracker/src/components/assistant/__tests__/assistantToolCall.test.ts` (or create if missing)

- [ ] **Step 1: Extend `ToolCallView`**

```ts
export interface ToolCallView {
  toolType: string;
  description: string | null;
  status: ToolBlockStatus;
  input: ToolBlockSection | null;
  output: ToolBlockSection | null;
  defaultCollapsed: boolean;
  outputTruncated?: boolean;
  outputByteSize?: number | null;
  /** When set, CreatePlan (or similar) can open this path in the KB modal. */
  kbPath?: string | null;
  kind?: "task" | "create_plan" | "other";
}
```

- [ ] **Step 2: Use enrich in `buildToolCallView`**

```ts
function buildToolCallView(toolCall: AssistantToolCall): ToolCallView {
  const presentation = enrichCursorToolPresentation(toolCall.name, toolCall.arguments);
  const inputJson = serializeArguments(toolCall.arguments);
  const output = toolCall.output ? formatToolOutput(toolCall.output) : null;
  const inputSection =
    presentation.detailMarkdown != null
      ? { value: presentation.detailMarkdown, language: "markdown" as const }
      : inputJson
        ? { value: inputJson, language: isShellTool(toolCall.name) ? ("bash" as const) : ("json" as const) }
        : null;

  return {
    toolType:
      presentation.kind === "other"
        ? localizeToolName(toolCall.name, inputJson, output)
        : presentation.toolType,
    description: presentation.description,
    status: mapStatus(toolCall.status),
    input: inputSection,
    output: output ? { value: output, language: "text" } : null,
    defaultCollapsed: true,
    outputTruncated: toolCall.outputTruncated === true,
    outputByteSize: toolCall.outputByteSize ?? null,
    kbPath: presentation.kbPath,
    kind: presentation.kind,
  };
}
```

Mirror the same enrich in `sessionPairToView` by parsing `call.body` JSON when title is Task/CreatePlan.

- [ ] **Step 3: Add/adjust unit test for assistantToolCall**

Assert CreatePlan view has `kbPath` and `toolType` starting with `Plan ·`.

- [ ] **Step 4: Run targeted tests**

```bash
cd tracker && npm test -- src/components/assistant/__tests__/assistantToolCall.test.ts
```

(If the file does not exist, create it with one focused case.)

---

### Task 5: CreatePlan → open KB from ToolCallBlock

**Files:**
- Modify: `tracker/src/components/shared/ToolCallBlock.tsx`
- Modify: `tracker/src/components/shared/__tests__/ToolCallBlock.test.tsx`
- Modify: `tracker/src/components/agent-activity/ToolActivityItem.tsx`
- Modify: `tracker/src/components/assistant/AssistantTurnTimeline.tsx` (pass-through)
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Failing UI test**

```tsx
it("offers Open in knowledge base when kbPath is set", async () => {
  const onOpenKbPath = vi.fn();
  const user = userEvent.setup();
  render(
    <ToolCallBlock
      view={{
        ...baseView,
        toolType: "Plan · GAM-20 Spec Design",
        description: "overview",
        kind: "create_plan",
        kbPath: "docs/superpowers/specs/example.md",
      }}
      onOpenKbPath={onOpenKbPath}
    />,
  );
  await user.click(screen.getByRole("button", { name: /open in knowledge base/i }));
  expect(onOpenKbPath).toHaveBeenCalledWith("docs/superpowers/specs/example.md");
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd tracker && npm test -- src/components/shared/__tests__/ToolCallBlock.test.tsx -t "Open in knowledge base"
```

- [ ] **Step 3: Implement**

Add optional `onOpenKbPath?: (path: string) => void` to `ToolCallBlock`. When `view.kbPath` and handler exist, render a text button in the summary row / details footer:

```tsx
{view.kbPath && onOpenKbPath ? (
  <button
    type="button"
    className="text-[11px] font-medium text-primary hover:underline"
    onClick={(event) => {
      event.stopPropagation();
      onOpenKbPath(view.kbPath!);
    }}
  >
    {t("issue.toolCall.openInKnowledgeBase")}
  </button>
) : null}
```

i18n:

```json
"openInKnowledgeBase": "Open in knowledge base"
```

```json
"openInKnowledgeBase": "Abrir na knowledge base"
```

Thread `onOpenKbPath` from `ProjectAssistantPanel` → timeline → `ToolActivityItem` → `ToolCallBlock`, calling existing `openKnowledgeBase(path)`.

When path missing and user somehow triggers: `toast.error(t("issue.toolCall.kbPathMissing"))`.

- [ ] **Step 4: Re-run — expect PASS**

```bash
cd tracker && npm test -- src/components/shared/__tests__/ToolCallBlock.test.tsx -t "Open in knowledge base"
```

---

### Task 6: ACP client (JSON-RPC stdio)

**Files:**
- Create: `elixir/lib/symphony_elixir/cursor/acp_client.ex`
- Create: `elixir/test/symphony_elixir/cursor/acp_client_test.exs`

- [ ] **Step 1: Write failing test with a Port/fake IO script**

Use a small Elixir fake that speaks NDJSON on the Port (or `StringIO` + GenServer if Port is heavy). Minimal cases:

1. `request("initialize", %{...})` receives matching response id.
2. Incoming `session/request_permission` with id calls configured handler and writes response.

Sketch:

```elixir
test "request/3 correlates json-rpc responses by id" do
  {:ok, client} = AcpClient.start_link(transport: fake_transport())
  task = Task.async(fn -> AcpClient.request(client, "initialize", %{"protocolVersion" => 1}) end)
  # fake responds with %{"jsonrpc"=>"2.0","id"=>1,"result"=>%{}}
  assert {:ok, %{}} = Task.await(task)
end
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
mix test test/symphony_elixir/cursor/acp_client_test.exs
```

- [ ] **Step 3: Implement `AcpClient`**

Public API:

```elixir
@spec start_link(keyword()) :: GenServer.on_start()
@spec request(pid(), String.t(), map(), timeout()) :: {:ok, map()} | {:error, term()}
@spec notify(pid(), String.t(), map()) :: :ok
@spec respond(pid(), term(), map()) :: :ok
```

State: next_id, pending map id→from, line buffer, on_server_request callback `(method, id, params) -> :ok` (caller must `respond/3`).

Spawn: `Port.open({:spawn_executable, command}, [:binary, :exit_status, {:args, ["acp"]}, {:cd, workspace}, …])` — command from `Cursor.Config` / opts (`agent` or `cursor-agent` path that supports `acp`).

- [ ] **Step 4: Re-run — expect PASS**

```bash
mix test test/symphony_elixir/cursor/acp_client_test.exs
```

---

### Task 7: ACP bridge → existing event/callback shape

**Files:**
- Create: `elixir/lib/symphony_elixir/cursor/acp_bridge.ex`
- Create: `elixir/test/symphony_elixir/cursor/acp_bridge_test.exs`

- [ ] **Step 1: Failing tests**

```elixir
test "agent_message_chunk becomes item/progress text delta" do
  events = Agent.start_link(fn -> [] end) |> elem(1)
  on_event = fn e -> Agent.update(events, &[e | &1]) end
  AcpBridge.handle_server_message(
    %{
      "method" => "session/update",
      "params" => %{
        "update" => %{
          "sessionUpdate" => "agent_message_chunk",
          "content" => %{"type" => "text", "text" => "Hi"}
        }
      }
    },
    %{on_event: on_event, on_approval_required: fn _ -> :ok end, on_user_input_required: fn _ -> :ok end,
      on_create_plan_required: fn _ -> :ok end, respond: fn _, _ -> :ok end}
  )
  assert [%{"method" => "item/progress"} | _] = Agent.get(events, & &1)
end

test "request_permission invokes on_approval_required and respond on resolve" do
  # ...
end
```

Map:

| ACP | Bridge |
|-----|--------|
| `agent_message_chunk` | `item/progress` assistant delta |
| tool call updates (per Cursor ACP payload) | `item/created` tool_call / tool_result |
| `session/request_permission` | `on_approval_required` + wait `ApprovalBroker` / channel resolve → `respond` with `allow-once` / `reject-once` |
| `cursor/ask_question` | `on_user_input_required` with questions shaped for `UserQuestionsCard` |
| `cursor/create_plan` | `on_create_plan_required` with name/overview/plan/planUri |

- [ ] **Step 2: Implement bridge + PASS tests**

```bash
mix test test/symphony_elixir/cursor/acp_bridge_test.exs
```

---

### Task 8: Wire ACP into interactive Cursor sessions

**Files:**
- Modify: `elixir/lib/symphony_elixir/cursor/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (handle_in create_plan + callback)
- Modify: tests for coding_agent / channel as needed

- [ ] **Step 1: Branch transport**

When `interactive_user_input: true`, start turn via ACP:

1. `AcpClient.start_link`
2. `initialize` → `authenticate` (`cursor_login`) → `session/new` (cwd = workspace, mcpServers from written mcp.json if any)
3. Set mode plan/agent on session if ACP supports mode params (else pass plan intent in prompt / session config per Cursor docs)
4. `session/prompt` with user prompt
5. Handle server messages through `AcpBridge` until stopReason
6. Persist `sessionId` like today’s `cli_session_id` for resume via `session/load`

Non-interactive / orchestrator: keep existing `CliRunner.run_turn/2` (`--print`).

- [ ] **Step 2: Channel — `on_create_plan_required`**

Mirror approval wiring:

```elixir
|> Keyword.put(:on_create_plan_required, fn request ->
  send(channel_pid, {:assistant_create_plan_required, request})
end)
```

`handle_info({:assistant_create_plan_required, request}, socket)` pushes e.g. `create_plan_required` with `%{request_id, name, overview, plan, plan_uri}`.

`handle_in("submit_create_plan", %{"request_id" => id, "action" => action}, socket)` when action in `["accept", "reject"]` delivers to turn pid / ACP respond.

- [ ] **Step 3: Targeted tests**

Fake ACP transport in coding_agent test: interactive session receives permission request → callback fired → resolve → tool proceeds.

```bash
mix test test/symphony_elixir/cursor/coding_agent_test.exs --only line:<acp_test>
```

---

### Task 9: Frontend CreatePlan accept/reject + permission/questions already wired

**Files:**
- Modify: `tracker/src/services/phoenix/assistantChannel.ts`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Create (optional): `tracker/src/components/assistant/CreatePlanCard.tsx`
- Tests: panel or card test with fake channel events

- [ ] **Step 1: Subscribe to `create_plan_required`**

Reuse patterns from `approval_required` / `user_input_required`:

- State `pendingCreatePlan`
- Card showing name, overview, truncated plan, buttons Aceitar / Rejeitar / Abrir KB
- Aceitar → `channel.push("submit_create_plan", {request_id, action: "accept"})`
- Rejeitar → `action: "reject"`
- Abrir KB → `openKnowledgeBase(path)` only

Permission + questions: verify Cursor ACP path populates the **same** `pendingApproval` / `pendingQuestions` events already handled for Claude/Codex. If payload shape differs, normalize in the channel presenter before push.

- [ ] **Step 2: Test card submit**

```bash
cd tracker && npm test -- src/components/assistant/__tests__/CreatePlanCard.test.tsx
```

(or extend `ProjectAssistantPanel.test.tsx` with one focused case)

---

### Task 10: Docs + smoke checklist

**Files:**
- Modify: `elixir/lib/symphony_elixir/execution_mode.ex` docs (already in Task 1)
- Modify: `docs/superpowers/specs/2026-07-09-claude-ask-user-question-pretooluse-design.md` — replace “Cursor follow-up” note with pointer to this shipped design
- Modify: spec status → `approved` / `implementing`

- [ ] **Step 1: Manual smoke (local)**

1. Nova sessão Cursor Plan + seed pedindo `get_issue` → sem `User rejected MCP`.
2. Turn que dispara Task explore → header `Task · Explore`.
3. CreatePlan com link docs → Abrir KB abre o arquivo.
4. Interactive Build: shell/MCP mutável ainda mostra approval card.
5. (ACP) AskQuestion + permission aguardam UI.

- [ ] **Step 2: Commit docs** (if requested)

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `--mode plan` + `--force` | Task 1 |
| Gateway sem `:deny_plan` | Task 2 |
| Task · tipo + description | Tasks 3–4 |
| CreatePlan card + KB path | Tasks 3–5 |
| ACP permission wait | Tasks 6–8 |
| ACP ask_question wait | Tasks 6–8 |
| ACP create_plan accept/reject | Tasks 7–9 |
| Interactive Build approval preserved | Task 2 (existing test kept) |
| Non-interactive unchanged | Task 8 branch |

## Placeholder / consistency self-review

- No TBD steps; ACP fake transport left as test double pattern (StringIO/Port) with concrete API.
- `enrichCursorToolPresentation` names used consistently in Tasks 3–5.
- WSL: every run step is a single file/filter.
