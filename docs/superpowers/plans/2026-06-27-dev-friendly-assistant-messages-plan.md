# Dev-Friendly Assistant Messages (Real-Time + Grouped Tool Calls) Implementation Plan

**Goal:** Make Symphony's assistant chat feel like Jean's — real-time and dev-friendly — by giving each tool call a stable identity (so repeated calls stop overwriting each other), and by collapsing consecutive *similar* tool calls into compact, expandable groups ("Read 5 files", "Ran 3 commands") instead of a flat wall of bordered cards.

**Architecture:** The transport is already real-time (Phoenix channel streams `assistant_delta`, `tool_call_started`, `tool_call_completed`). All work is in the `tracker/` React layer plus one tiny service-normalization change: (1) thread the backend tool-call `id` through `normalizeToolCall`; (2) extract the streaming reducers into a pure, tested module that upserts tool calls **by id, preserving order**; (3) add a pure `groupToolCalls` function and two presentation components (`ToolActivityGroup`, `ToolActivityTimeline`) that render consecutive same-kind calls as one collapsible group, reusing the existing `FileActivityCard` / `ToolCallBlock` for the rows; (4) wire the timeline into `AssistantBubble`. Groups update live (counts increment, running group shows a spinner) because tool calls keep upserting into the in-flight streaming message.

**Tech Stack:** React 19 + TypeScript, Vitest + React Testing Library, i18next (`en` + `pt-BR`), lucide-react, Tailwind, Phoenix channels (already streaming; no backend change required).

---

## Background: current state (verified)

- Channel handlers in `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`onToolCallStarted` / `onToolCallCompleted`) call `updateStreamingToolCall`, which today does:
  ```ts
  const nextToolCalls = [...target.toolCalls.filter((current) => current.name !== toolCall.name), toolCall];
  ```
  → **de-dups by `name`** and **moves the call to the end**. Two `read_file` calls collapse into one; ordering is lost.
- `tracker/src/services/assistant.ts`: `AssistantToolCall` has **no `id`**, and `normalizeToolCall` ignores it — but the backend emits one (`elixir/lib/symphony_elixir/assistant/codex_session.ex` builds `%{name, status, arguments, output, result, id}` and `upsert_tool_call_by_id/3`s it; the channel pushes the raw map in `assistant_channel.ex` `on_tool_call_*`). The id is on the wire; the client throws it away.
- `AssistantBubble` (in `ProjectAssistantPanel.tsx:1289-1300`) renders `message.toolCalls.map(...)` as a flat list of `FileActivityCard` (for read/edit/command) or `ToolCallBlock` (everything else), after the markdown — no grouping.
- `WorkingIndicator.tsx` already shows rotating verbs + elapsed time + active tool. Good enough; not touched here.
- Existing pure helpers we reuse: `fileActivityFromToolCall` (`fileActivity.ts`), `isActionTool` (`assistantToolCall.ts`), `assistantToolCallToView` (`assistantToolCall.ts`).

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `tracker/src/services/assistant.ts` | Add `id` to the tool-call model + read it in `normalizeToolCall` | Modify |
| `tracker/src/services/__tests__/assistant.test.ts` | Cover `normalizeToolCall` id extraction | Modify |
| `tracker/src/components/assistant/assistantStream.ts` | **New** pure streaming reducers (`appendAssistantDelta`, `updateStreamingToolCall`, `upsertToolCall`, `toolCallIdentity`, `replaceStreamingMessage`, `appendMessage`, `assistantMessage`, `STREAMING_ASSISTANT_ID`) | Create |
| `tracker/src/components/assistant/__tests__/assistantStream.test.ts` | Test the reducers (upsert-by-id, order, no-collapse) | Create |
| `tracker/src/components/assistant/ProjectAssistantPanel.tsx` | Import reducers from `assistantStream`; delete inline copies; render `ToolActivityTimeline` | Modify |
| `tracker/src/lib/toolCallGroups.ts` | **New** pure grouping (`classifyToolCall`, `groupToolCalls`, `groupStatus`, `summarizeGroup`) | Create |
| `tracker/src/lib/__tests__/toolCallGroups.test.ts` | Test classification + consecutive grouping + summary | Create |
| `tracker/src/components/assistant/ToolActivityGroup.tsx` | **New** collapsible group card (header + rows) | Create |
| `tracker/src/components/assistant/__tests__/ToolActivityGroup.test.tsx` | Test label, collapse/expand, error-open | Create |
| `tracker/src/components/assistant/ToolActivityTimeline.tsx` | **New** maps grouped/single calls to group cards or single rows | Create |
| `tracker/src/components/assistant/__tests__/ToolActivityTimeline.test.tsx` | Test single-vs-group rendering | Create |
| `tracker/locales/en/tracker.json` | `assistant.toolGroup.*` labels | Modify |
| `tracker/locales/pt-BR/tracker.json` | `assistant.toolGroup.*` labels | Modify |

**Out of scope (future):** The issue-run session log (`tracker/src/components/issues/issue-detail/IssueSessionLog.tsx` + `sessionToolCall.ts` + `SessionLogEntryCard.tsx`) is a separate surface and can adopt `groupToolCalls` / `ToolActivityTimeline` later. **True chronological text↔tool interleaving** (splitting assistant text into segments around tool calls) is intentionally excluded: it would only be reconstructable for the live turn and not for reloaded history, producing inconsistent UX. We keep one consistent model: text, then a live grouped activity timeline.

---

### Task 1: Thread the backend tool-call `id` through normalization

**Files:**
- Modify: `tracker/src/services/assistant.ts` (`AssistantToolCall`, `BackendAssistantToolCallDto`, `normalizeToolCall`)
- Test: `tracker/src/services/__tests__/assistant.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tracker/src/services/__tests__/assistant.test.ts`:

```ts
import { normalizeToolCall } from "@/services/assistant";

describe("normalizeToolCall id", () => {
  it("reads a string id", () => {
    expect(normalizeToolCall({ name: "read_file", id: "call_1" }).id).toBe("call_1");
  });

  it("falls back to call_id then tool_use_id", () => {
    expect(normalizeToolCall({ name: "shell", call_id: "c2" }).id).toBe("c2");
    expect(normalizeToolCall({ name: "shell", tool_use_id: "tu3" }).id).toBe("tu3");
  });

  it("coerces a numeric id to string", () => {
    expect(normalizeToolCall({ name: "shell", id: 7 }).id).toBe("7");
  });

  it("is null when no id is present", () => {
    expect(normalizeToolCall({ name: "shell" }).id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/assistant.test.ts -t "normalizeToolCall id"`
Expected: FAIL — `id` is `undefined`/missing on the returned object.

- [ ] **Step 3: Write minimal implementation**

In `tracker/src/services/assistant.ts`, add `id` to the interface (lines 43-55):

```ts
export interface AssistantToolCall {
  id: string | null;
  name: string;
  status: AssistantToolStatus;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  result: {
    issue?: Issue;
    issues?: Issue[];
    comment?: Comment;
    agentExecutions?: unknown[];
    [key: string]: unknown;
  };
}
```

Add id fields to the DTO (lines 135-148):

```ts
interface BackendAssistantToolCallDto {
  id?: string | number | null;
  call_id?: string | number | null;
  callId?: string | number | null;
  tool_use_id?: string | number | null;
  toolUseId?: string | number | null;
  name?: string | null;
  status?: string | null;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  result?: {
    issue?: BackendIssueDto | null;
    issues?: BackendIssueDto[] | null;
    comment?: BackendCommentDto | null;
    agent_executions?: unknown[] | null;
    agentExecutions?: unknown[] | null;
    [key: string]: unknown;
  } | null;
}
```

Update `normalizeToolCall` (lines 440-456) to set `id` first, and add the helper just below it:

```ts
export function normalizeToolCall(dto: BackendAssistantToolCallDto): AssistantToolCall {
  const result = dto.result ?? {};

  return {
    id: normalizeToolCallId(dto),
    name: dto.name ?? "unknown",
    status: normalizeToolStatus(dto.status),
    arguments: dto.arguments ?? null,
    output: typeof dto.output === "string" ? dto.output : null,
    result: {
      ...result,
      issue: result.issue ? normalizeIssue(result.issue) : undefined,
      issues: Array.isArray(result.issues) ? result.issues.map(normalizeIssue) : undefined,
      comment: result.comment ? normalizeComment(result.comment) : undefined,
      agentExecutions: result.agentExecutions ?? result.agent_executions ?? undefined,
    },
  };
}

function normalizeToolCallId(dto: BackendAssistantToolCallDto): string | null {
  const raw = dto.id ?? dto.call_id ?? dto.callId ?? dto.tool_use_id ?? dto.toolUseId;
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}
```

> Note: `id` is required (`string | null`) on the model. If the TypeScript build flags any literal `AssistantToolCall` constructed elsewhere (e.g. test fixtures in `tracker/src/test-fixtures/assistantCatalog.ts`) that omits `id`, add `id: null` to those literals in the same task.

- [ ] **Step 4: Run test + typecheck**

Run: `cd tracker && npx vitest run src/services/__tests__/assistant.test.ts && npx tsc --noEmit`
Expected: PASS, and no new TS errors. (If `tsc` reports missing `id` on a fixture, add `id: null` there and rerun.)

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/assistant.ts tracker/src/services/__tests__/assistant.test.ts
git commit -m "feat(assistant): carry stable tool-call id through normalizeToolCall"
```

---

### Task 2: Pure streaming reducers with upsert-by-id (no collapse, ordered)

**Files:**
- Create: `tracker/src/components/assistant/assistantStream.ts`
- Test: `tracker/src/components/assistant/__tests__/assistantStream.test.ts`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (import + delete inline copies)

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/assistantStream.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  STREAMING_ASSISTANT_ID,
  appendAssistantDelta,
  toolCallIdentity,
  updateStreamingToolCall,
  upsertToolCall,
} from "@/components/assistant/assistantStream";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "running", arguments: null, output: null, result: {}, ...overrides };
}

describe("appendAssistantDelta", () => {
  it("creates a streaming message then appends", () => {
    const once = appendAssistantDelta([], "Hel");
    expect(once).toHaveLength(1);
    expect(once[0].id).toBe(STREAMING_ASSISTANT_ID);

    const twice = appendAssistantDelta(once, "lo");
    expect(twice[0].content).toBe("Hello");
  });
});

describe("toolCallIdentity", () => {
  it("prefers id, falls back to name", () => {
    expect(toolCallIdentity(call({ id: "c1" }))).toBe("id:c1");
    expect(toolCallIdentity(call({ id: null, name: "shell" }))).toBe("name:shell");
  });
});

describe("upsertToolCall", () => {
  it("appends a new call and keeps order", () => {
    const out = upsertToolCall([call({ id: "a" })], call({ id: "b", name: "shell" }));
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("updates the matching id in place (running -> complete)", () => {
    const out = upsertToolCall([call({ id: "a", status: "running" })], call({ id: "a", status: "complete" }));
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("complete");
  });

  it("does NOT collapse two same-name calls that have distinct ids", () => {
    const out = upsertToolCall([call({ id: "a", name: "read_file" })], call({ id: "b", name: "read_file" }));
    expect(out).toHaveLength(2);
  });
});

describe("updateStreamingToolCall", () => {
  it("attaches tool calls to the streaming message preserving arrival order", () => {
    const base: AssistantChatMessage[] = [];
    const afterFirst = updateStreamingToolCall(base, call({ id: "a", name: "read_file" }));
    const afterSecond = updateStreamingToolCall(afterFirst, call({ id: "b", name: "shell" }));
    const streaming = afterSecond.find((m) => m.id === STREAMING_ASSISTANT_ID)!;
    expect(streaming.toolCalls.map((c) => c.name)).toEqual(["read_file", "shell"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/assistantStream.test.ts`
Expected: FAIL — module `@/components/assistant/assistantStream` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `tracker/src/components/assistant/assistantStream.ts`:

```ts
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

export const STREAMING_ASSISTANT_ID = "assistant-streaming";

export function assistantMessage(id: string, content: string): AssistantChatMessage {
  return { id, role: "assistant", content, toolCalls: [], metadata: {} };
}

export function appendMessage(
  messages: AssistantChatMessage[],
  message: AssistantChatMessage,
): AssistantChatMessage[] {
  if (messages.some((current) => current.id === message.id)) return messages;
  return [...messages, message];
}

export function appendAssistantDelta(messages: AssistantChatMessage[], delta: string): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  if (!existing) return [...messages, assistantMessage(STREAMING_ASSISTANT_ID, delta)];

  return messages.map((message) =>
    message.id === STREAMING_ASSISTANT_ID ? { ...message, content: `${message.content}${delta}` } : message,
  );
}

export function toolCallIdentity(call: AssistantToolCall): string {
  if (typeof call.id === "string" && call.id.trim() !== "") return `id:${call.id}`;
  return `name:${call.name}`;
}

export function upsertToolCall(calls: AssistantToolCall[], next: AssistantToolCall): AssistantToolCall[] {
  const key = toolCallIdentity(next);
  const index = calls.findIndex((current) => toolCallIdentity(current) === key);
  if (index === -1) return [...calls, next];
  return calls.map((current, position) => (position === index ? next : current));
}

export function updateStreamingToolCall(
  messages: AssistantChatMessage[],
  toolCall: AssistantToolCall,
): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  const target = existing ?? assistantMessage(STREAMING_ASSISTANT_ID, "");
  const nextTarget = { ...target, toolCalls: upsertToolCall(target.toolCalls, toolCall) };

  if (!existing) return [...messages, nextTarget];
  return messages.map((message) => (message.id === STREAMING_ASSISTANT_ID ? nextTarget : message));
}

export function replaceStreamingMessage(
  messages: AssistantChatMessage[],
  message: AssistantChatMessage,
): AssistantChatMessage[] {
  if (messages.some((current) => current.id === STREAMING_ASSISTANT_ID)) {
    return messages.map((current) => (current.id === STREAMING_ASSISTANT_ID ? message : current));
  }

  return appendMessage(messages, message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/assistantStream.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Rewire `ProjectAssistantPanel.tsx` to use the module**

In `tracker/src/components/assistant/ProjectAssistantPanel.tsx`:

1. Delete the inline `const STREAMING_ASSISTANT_ID = "assistant-streaming";` (line 154).
2. Delete the inline function definitions `assistantMessage`, `appendMessage`, `appendAssistantDelta`, `updateStreamingToolCall`, `replaceStreamingMessage` (lines 1485-1519).
3. Add the import near the other `@/components/assistant/*` imports:

```ts
import {
  STREAMING_ASSISTANT_ID,
  appendAssistantDelta,
  appendMessage,
  assistantMessage,
  replaceStreamingMessage,
  updateStreamingToolCall,
} from "@/components/assistant/assistantStream";
```

(`assistantMessage` is still used by `displayMessages`; `STREAMING_ASSISTANT_ID` is still referenced near line 955. Keep both imports.)

- [ ] **Step 6: Verify nothing else broke**

Run: `cd tracker && npx tsc --noEmit && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: PASS, no TS errors (no duplicate-definition or unused-symbol errors).

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/assistant/assistantStream.ts \
        tracker/src/components/assistant/__tests__/assistantStream.test.ts \
        tracker/src/components/assistant/ProjectAssistantPanel.tsx
git commit -m "refactor(assistant): extract streaming reducers; upsert tool calls by id"
```

---

### Task 3: Pure tool-call grouping module

**Files:**
- Create: `tracker/src/lib/toolCallGroups.ts`
- Test: `tracker/src/lib/__tests__/toolCallGroups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tracker/src/lib/__tests__/toolCallGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { classifyToolCall, groupStatus, groupToolCalls, summarizeGroup } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: null, output: null, result: {}, ...overrides };
}

describe("classifyToolCall", () => {
  it("maps tool names to kinds", () => {
    expect(classifyToolCall(call({ name: "read_file" }))).toBe("read");
    expect(classifyToolCall(call({ name: "apply_patch" }))).toBe("edit");
    expect(classifyToolCall(call({ name: "shell" }))).toBe("command");
    expect(classifyToolCall(call({ name: "create_issue" }))).toBe("action");
    expect(classifyToolCall(call({ name: "list_issues" }))).toBe("query");
    expect(classifyToolCall(call({ name: "get_project" }))).toBe("query");
    expect(classifyToolCall(call({ name: "mystery_tool" }))).toBe("other");
  });
});

describe("groupToolCalls", () => {
  it("groups consecutive same-kind calls", () => {
    const groups = groupToolCalls([
      call({ id: "1", name: "read_file" }),
      call({ id: "2", name: "read_workspace_file" }),
      call({ id: "3", name: "shell" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "read" });
    expect(groups[0].calls).toHaveLength(2);
    expect(groups[1]).toMatchObject({ kind: "command" });
  });

  it("splits a group when a different kind interrupts the run", () => {
    const groups = groupToolCalls([
      call({ id: "1", name: "read_file" }),
      call({ id: "2", name: "shell" }),
      call({ id: "3", name: "read_file" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["read", "command", "read"]);
  });
});

describe("groupStatus", () => {
  it("running beats error beats complete", () => {
    expect(groupStatus([call({ status: "running" }), call({ status: "error" })])).toBe("running");
    expect(groupStatus([call({ status: "error" }), call({ status: "complete" })])).toBe("error");
    expect(groupStatus([call({ status: "complete" })])).toBe("complete");
  });
});

describe("summarizeGroup", () => {
  it("counts calls and sums diff stats", () => {
    const summary = summarizeGroup({
      kind: "edit",
      status: "complete",
      calls: [
        call({ name: "apply_patch", result: { additions: 10, deletions: 2 } }),
        call({ name: "apply_patch", result: { additions: 5, deletions: 1 } }),
      ],
    });
    expect(summary).toEqual({ count: 2, additions: 15, deletions: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/lib/__tests__/toolCallGroups.test.ts`
Expected: FAIL — module `@/lib/toolCallGroups` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `tracker/src/lib/toolCallGroups.ts`:

```ts
import { isActionTool } from "@/components/assistant/assistantToolCall";
import type { AssistantToolCall } from "@/services/assistant";

export type ToolGroupKind = "read" | "edit" | "command" | "query" | "action" | "other";
export type ToolGroupStatus = "running" | "complete" | "error";

export interface ToolCallGroup {
  kind: ToolGroupKind;
  status: ToolGroupStatus;
  calls: AssistantToolCall[];
}

export interface ToolGroupSummary {
  count: number;
  additions: number;
  deletions: number;
}

const READ_TOOLS = new Set(["read_workspace_file", "read_file"]);
const EDIT_TOOLS = new Set(["apply_patch", "edit_file", "write_file"]);
const COMMAND_TOOLS = new Set(["shell", "exec_command", "bash"]);
const QUERY_PREFIXES = ["list_", "get_", "scan_"];

export function classifyToolCall(call: AssistantToolCall): ToolGroupKind {
  const name = call.name;
  if (EDIT_TOOLS.has(name)) return "edit";
  if (COMMAND_TOOLS.has(name)) return "command";
  if (READ_TOOLS.has(name)) return "read";
  if (isActionTool(name)) return "action";
  if (QUERY_PREFIXES.some((prefix) => name.startsWith(prefix))) return "query";
  return "other";
}

export function groupStatus(calls: AssistantToolCall[]): ToolGroupStatus {
  if (calls.some((call) => call.status === "running")) return "running";
  if (calls.some((call) => call.status === "error")) return "error";
  return "complete";
}

export function groupToolCalls(calls: AssistantToolCall[]): ToolCallGroup[] {
  const groups: ToolCallGroup[] = [];

  for (const call of calls) {
    const kind = classifyToolCall(call);
    const last = groups[groups.length - 1];

    if (last && last.kind === kind) {
      groups[groups.length - 1] = { ...last, calls: [...last.calls, call] };
    } else {
      groups.push({ kind, status: "complete", calls: [call] });
    }
  }

  return groups.map((group) => ({ ...group, status: groupStatus(group.calls) }));
}

export function summarizeGroup(group: ToolCallGroup): ToolGroupSummary {
  let additions = 0;
  let deletions = 0;

  for (const call of group.calls) {
    const result = (call.result ?? {}) as Record<string, unknown>;
    if (typeof result.additions === "number") additions += result.additions;
    if (typeof result.deletions === "number") deletions += result.deletions;
  }

  return { count: group.calls.length, additions, deletions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/lib/__tests__/toolCallGroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/toolCallGroups.ts tracker/src/lib/__tests__/toolCallGroups.test.ts
git commit -m "feat(assistant): add pure tool-call grouping by consecutive kind"
```

---

### Task 4: i18n labels for tool-call groups (en + pt-BR)

**Files:**
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Add `toolGroup` under `assistant` in `en/tracker.json`**

Insert a new `"toolGroup"` block immediately before the existing `"working"` block (around line 1829):

```json
    "toolGroup": {
      "read": "Read {{count}} files",
      "edit": "Edited {{count}} files",
      "editStats": "Edited {{count}} files (+{{additions}} −{{deletions}})",
      "command": "Ran {{count}} commands",
      "query": "Looked up {{count}} items",
      "action": "{{count}} actions",
      "other": "{{count}} tool calls",
      "running": "running",
      "failed": "failed"
    },
```

- [ ] **Step 2: Add the matching block under `assistant` in `pt-BR/tracker.json`**

```json
    "toolGroup": {
      "read": "Leu {{count}} arquivos",
      "edit": "Editou {{count}} arquivos",
      "editStats": "Editou {{count}} arquivos (+{{additions}} −{{deletions}})",
      "command": "Executou {{count}} comandos",
      "query": "Consultou {{count}} itens",
      "action": "{{count}} ações",
      "other": "{{count}} chamadas de ferramenta",
      "running": "em execução",
      "failed": "falhou"
    },
```

- [ ] **Step 3: Verify JSON validity**

Run: `cd tracker && node -e "require('./locales/en/tracker.json'); require('./locales/pt-BR/tracker.json'); console.log('ok')"`
Expected: prints `ok` (no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "i18n(assistant): add tool-call group labels (en, pt-BR)"
```

---

### Task 5: `ToolActivityGroup` component (collapsible group card)

**Files:**
- Create: `tracker/src/components/assistant/ToolActivityGroup.tsx`
- Test: `tracker/src/components/assistant/__tests__/ToolActivityGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/ToolActivityGroup.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolActivityGroup } from "@/components/assistant/ToolActivityGroup";
import type { ToolCallGroup } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

function readGroup(status: ToolCallGroup["status"] = "complete"): ToolCallGroup {
  return {
    kind: "read",
    status,
    calls: [
      call({ id: "1", arguments: { path: "a.ex" } }),
      call({ id: "2", arguments: { path: "b.ex" } }),
      call({ id: "3", arguments: { path: "c.ex" } }),
    ],
  };
}

describe("ToolActivityGroup", () => {
  it("renders a count label and is collapsed by default for reads", () => {
    render(<ToolActivityGroup group={readGroup()} />);
    expect(screen.getByText("Read 3 files")).toBeInTheDocument();
    expect(screen.queryByText("a.ex")).not.toBeInTheDocument();
  });

  it("expands to show individual rows when clicked", () => {
    render(<ToolActivityGroup group={readGroup()} />);
    fireEvent.click(screen.getByTestId("tool-activity-group"));
    expect(screen.getByText("a.ex")).toBeInTheDocument();
    expect(screen.getByText("c.ex")).toBeInTheDocument();
  });

  it("is expanded by default and shows a failed badge when the group errored", () => {
    const group = readGroup("error");
    group.calls[1] = call({ id: "2", status: "error", arguments: { path: "b.ex" } });
    render(<ToolActivityGroup group={group} />);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("b.ex")).toBeInTheDocument();
  });
});
```

> The test relies on i18n being initialized in `tracker/vitest.setup.ts` (the existing setup loads real locales, so `Read 3 files` resolves). If a test needs an `I18nextProvider` wrapper, follow the pattern already used in `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ToolActivityGroup.test.tsx`
Expected: FAIL — module `@/components/assistant/ToolActivityGroup` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `tracker/src/components/assistant/ToolActivityGroup.tsx`:

```tsx
import { ChevronDown, FileText, type LucideIcon, Loader2, Pencil, Search, TerminalSquare, Wrench, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { summarizeGroup, type ToolCallGroup, type ToolGroupKind, type ToolGroupSummary } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<ToolGroupKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  command: TerminalSquare,
  query: Search,
  action: Zap,
  other: Wrench,
};

function defaultOpen(group: ToolCallGroup): boolean {
  if (group.status === "error") return true;
  return group.kind === "action";
}

function rowKey(call: AssistantToolCall, index: number): string {
  return call.id && call.id.trim() !== "" ? `tc-${call.id}` : `tc-${call.name}-${index}`;
}

function groupLabel(group: ToolCallGroup, summary: ToolGroupSummary, t: ReturnType<typeof useTranslation>["t"]): string {
  if (group.kind === "edit" && (summary.additions > 0 || summary.deletions > 0)) {
    return t("assistant.toolGroup.editStats", {
      count: summary.count,
      additions: summary.additions,
      deletions: summary.deletions,
    });
  }
  return t(`assistant.toolGroup.${group.kind}`, { count: summary.count });
}

export function ToolActivityGroup({ group }: { group: ToolCallGroup }) {
  const { t } = useTranslation();
  const summary = summarizeGroup(group);
  const [open, setOpen] = useState(() => defaultOpen(group));
  const running = group.status === "running";
  const failed = group.status === "error";
  const Icon = KIND_ICON[group.kind];

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-busy={running}
        data-testid="tool-activity-group"
      >
        <span className="shrink-0 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {groupLabel(group, summary, t)}
        </span>
        {failed ? (
          <span className="shrink-0 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
            {t("assistant.toolGroup.failed")}
          </span>
        ) : running ? (
          <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("assistant.toolGroup.running")}
          </span>
        ) : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          {group.calls.map((call, index) => {
            const activity = fileActivityFromToolCall(call);
            return activity ? (
              <FileActivityCard view={activity} key={rowKey(call, index)} />
            ) : (
              <ToolCallBlock view={assistantToolCallToView(call)} key={rowKey(call, index)} />
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ToolActivityGroup.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/ToolActivityGroup.tsx \
        tracker/src/components/assistant/__tests__/ToolActivityGroup.test.tsx
git commit -m "feat(assistant): add collapsible ToolActivityGroup card"
```

---

### Task 6: `ToolActivityTimeline` + wire into `AssistantBubble`

**Files:**
- Create: `tracker/src/components/assistant/ToolActivityTimeline.tsx`
- Test: `tracker/src/components/assistant/__tests__/ToolActivityTimeline.test.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`AssistantBubble` body + imports)

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/ToolActivityTimeline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

describe("ToolActivityTimeline", () => {
  it("renders a single call without a group header", () => {
    render(<ToolActivityTimeline toolCalls={[call({ id: "1", arguments: { path: "only.ex" } })]} />);
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();
    expect(screen.getByText("only.ex")).toBeInTheDocument();
  });

  it("groups 3 consecutive reads into one group header", () => {
    render(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", arguments: { path: "a.ex" } }),
          call({ id: "2", arguments: { path: "b.ex" } }),
          call({ id: "3", arguments: { path: "c.ex" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(1);
    expect(screen.getByText("Read 3 files")).toBeInTheDocument();
  });

  it("renders separate groups when kinds alternate", () => {
    render(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", name: "read_file", arguments: { path: "a.ex" } }),
          call({ id: "2", name: "read_file", arguments: { path: "b.ex" } }),
          call({ id: "3", name: "shell", arguments: { command: "ls" } }),
          call({ id: "4", name: "shell", arguments: { command: "pwd" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(2);
    expect(screen.getByText("Read 2 files")).toBeInTheDocument();
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ToolActivityTimeline.test.tsx`
Expected: FAIL — module `@/components/assistant/ToolActivityTimeline` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `tracker/src/components/assistant/ToolActivityTimeline.tsx`:

```tsx
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import { ToolActivityGroup } from "@/components/assistant/ToolActivityGroup";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { groupToolCalls } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

export function ToolActivityTimeline({ toolCalls }: { toolCalls: AssistantToolCall[] }) {
  if (toolCalls.length === 0) return null;

  const groups = groupToolCalls(toolCalls);

  return (
    <div className="space-y-2">
      {groups.map((group, groupIndex) => {
        if (group.calls.length > 1) {
          return <ToolActivityGroup group={group} key={`group-${group.kind}-${groupIndex}`} />;
        }

        const call = group.calls[0];
        const key = call.id && call.id.trim() !== "" ? `single-${call.id}` : `single-${call.name}-${groupIndex}`;
        const activity = fileActivityFromToolCall(call);

        return activity ? (
          <FileActivityCard view={activity} key={key} />
        ) : (
          <ToolCallBlock view={assistantToolCallToView(call)} key={key} />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ToolActivityTimeline.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `AssistantBubble`**

In `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, add the import:

```ts
import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
```

Replace the flat tool-call block (current lines 1289-1300):

```tsx
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => {
              const activity = fileActivityFromToolCall(toolCall);
              return activity ? (
                <FileActivityCard view={activity} key={`fa-${toolCall.name}-${index}`} />
              ) : (
                <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
              );
            })}
          </div>
        ) : null}
```

with:

```tsx
        {message.toolCalls.length ? (
          <div className={cn("mt-3 border-t pt-2", isUser && "border-white/20")}>
            <ToolActivityTimeline toolCalls={message.toolCalls} />
          </div>
        ) : null}
```

- [ ] **Step 6: Remove now-unused imports in `ProjectAssistantPanel.tsx`**

`fileActivityFromToolCall`, `assistantToolCallToView`, `FileActivityCard`, and `ToolCallBlock` may now be unused inside `ProjectAssistantPanel.tsx` (they moved into the timeline). Remove any that ESLint flags.

Run: `cd tracker && npx eslint src/components/assistant/ProjectAssistantPanel.tsx`
Expected: no `no-unused-vars` / `unused-imports` errors. Remove flagged imports and rerun until clean.

- [ ] **Step 7: Verify the panel still renders + typecheck**

Run: `cd tracker && npx tsc --noEmit && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: PASS, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add tracker/src/components/assistant/ToolActivityTimeline.tsx \
        tracker/src/components/assistant/__tests__/ToolActivityTimeline.test.tsx \
        tracker/src/components/assistant/ProjectAssistantPanel.tsx
git commit -m "feat(assistant): render grouped real-time tool-call activity timeline"
```

---

### Task 7: Final gates + docs

**Files:**
- Modify: `elixir/README.md` (or the tracker README if the assistant chat is documented there — search first)

- [ ] **Step 1: Run the full tracker unit gate for touched areas**

Run:
```bash
cd tracker && npx vitest run \
  src/services/__tests__/assistant.test.ts \
  src/components/assistant/__tests__/assistantStream.test.ts \
  src/lib/__tests__/toolCallGroups.test.ts \
  src/components/assistant/__tests__/ToolActivityGroup.test.tsx \
  src/components/assistant/__tests__/ToolActivityTimeline.test.tsx \
  src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
```
Expected: all PASS.

- [ ] **Step 2: Lint + typecheck the touched files**

Run:
```bash
cd tracker && npx tsc --noEmit && npx eslint \
  src/services/assistant.ts \
  src/components/assistant/assistantStream.ts \
  src/lib/toolCallGroups.ts \
  src/components/assistant/ToolActivityGroup.tsx \
  src/components/assistant/ToolActivityTimeline.tsx \
  src/components/assistant/ProjectAssistantPanel.tsx
```
Expected: no new errors. (The repo has known pre-existing build breakage in `ProjectImportDialog`-related files unrelated to this work; do not let those block — only the files above must be clean.)

- [ ] **Step 3: Manual QA (real-data scenario)**

Start the assistant on a project and prompt something that triggers several reads and a couple of commands (e.g. "summarize how dispatch works"). Verify:
- Multiple `read_file` calls show as a single "Read N files" group that increments live and shows a spinner while running.
- Two separate read bursts split by a command render as separate groups (read group, command group, read group).
- A failing tool surfaces an expanded group with a red "failed" badge.
- A single tool call still renders as a single row (no group chrome), matching prior behavior.
- History reload (refresh the page) shows the same grouped layout (parity between live and persisted).

- [ ] **Step 4: Document**

Search for where the assistant chat UI is documented (`rg -n "ToolCallBlock|FileActivityCard|assistant chat" elixir/README.md tracker/README.md` — use Grep). Add a short note under the assistant/chat section describing the grouped activity timeline: consecutive same-kind tool calls collapse into one expandable group ("Read N files", "Ran N commands"), tool calls are keyed by stable id so repeats no longer overwrite, and groups update live during streaming.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(assistant): document grouped real-time tool-call timeline"
```

---

## Self-Review

**1. Spec coverage**
- "More friendly / real-time interaction" → Tasks 1-2 fix the id/ordering bug so the live stream is faithful (no vanishing repeats, stable order); the group header shows a live spinner + `running` badge and an incrementing count (Tasks 5-6). Transport was already streaming, so no channel work needed. ✅
- "Groups similar tool calls" → Task 3 (`groupToolCalls` by consecutive kind), Task 5 (`ToolActivityGroup`), Task 6 (`ToolActivityTimeline` wired into `AssistantBubble`). ✅

**2. Placeholder scan** — No TBD/TODO; every code step has complete code; every command has expected output. ✅

**3. Type consistency**
- `AssistantToolCall.id: string | null` defined in Task 1; used by `toolCallIdentity` (Task 2), `classifyToolCall`/`summarizeGroup` (Task 3), `rowKey` (Task 5), timeline keys (Task 6). ✅
- `ToolCallGroup { kind, status, calls }` and `ToolGroupSummary { count, additions, deletions }` defined in Task 3; consumed identically in Tasks 5-6. ✅
- `groupToolCalls` / `summarizeGroup` / `classifyToolCall` names consistent across tasks. ✅
- i18n keys `assistant.toolGroup.{read,edit,editStats,command,query,action,other,running,failed}` defined in Task 4; consumed by `groupLabel` and the badges in Task 5. ✅

**Decisions locked (reasonable defaults, noted not asked):**
- Default-collapsed for read/command/query/other; default-open for `action` and any errored group (errors must be visible).
- Single-call groups render as plain rows (preserves current UX); only ≥2 same-kind consecutive calls get group chrome.
- No backend changes: the tool-call `id` already reaches the wire; we only stop discarding it.
- True text↔tool interleaving deliberately excluded (history can't reconstruct it → inconsistent UX).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-dev-friendly-assistant-messages-plan.md`.

Documents:
- Plan: `docs/superpowers/plans/2026-06-27-dev-friendly-assistant-messages-plan.md`
