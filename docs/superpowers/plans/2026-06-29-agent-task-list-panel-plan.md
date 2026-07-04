# Live Agent Task/Plan List Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Run the exact test commands shown. Commit after every task.

**Goal:** Mirror Jean's `TodoWidget`/`TaskWidget` — surface the coding agent's live task/plan checklist (the plan it maintains while working) in the issue's Agent → Execution session-log view, as a pinned collapsible "Tasks" panel plus a compact inline marker in the transcript.

**Architecture:** Frontend-only. The plan/todo JSON already reaches the client inside `tool_call` session-log entries' `body` (Codex `update_plan` and Claude `TodoWrite`/`TaskCreate`/`TaskUpdate` are recorded as tool calls whose pretty-printed JSON arguments land in `SessionLogEntry.body`). A pure module `agentTasks.ts` parses the entry stream into one normalized `AgentTaskSnapshot` (snapshot-replace for `update_plan`/`TodoWrite`; accumulate-by-id for the Claude Tasks API), and `IssueSessionLog` renders it as a pinned panel + inline markers. The only backend change is a regression test guaranteeing the JSON keeps flowing through the session-log parsers.

**Tech Stack:** React 19 + Vite + TypeScript + `react-i18next` + lucide-react + vitest; Elixir/ExUnit (regression-only). No new dependencies. This repo has **no TanStack Query** — the panel derives purely from the `entries` prop already passed to `IssueSessionLog` (live via `useSessionLogChannel`).

---

**Depends on / relates to:**
- Session-log stack (the data source + mount point): `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx`, `tracker/src/components/issues/issue-detail/sessionToolCall.ts` (`pairSessionLogItems`), `tracker/src/types/session-log.ts` (`SessionLogEntry`), `tracker/src/hooks/useSessionLogChannel.ts`, and the parent `tracker/src/components/issues/issue-detail/AgentTab.tsx`.
- Backend session-log parsers that already put the tool args JSON into `body`: `elixir/lib/symphony_elixir/codex/session_log.ex`, `elixir/lib/symphony_elixir/claude/session_log.ex`.

**Jean references (inspiration — not in this repo):**
- `src/components/chat/TodoWidget.tsx` — Claude `TodoWrite` items `{content, status, activeForm}`, header "Todos".
- `src/components/chat/TaskWidget.tsx` — Claude Tasks API items `{subject, status}` (header "Tasks"); tasks persisted at `~/.claude/tasks/<session>/<id>.json`.
- `src/components/chat/tool-call-utils.ts` — `isSpecialTool` detection → our `isAgentTaskTool`.
- `src/components/chat/ChatWindow.tsx` — detects Task/Todo tool calls and shows the widget(s); both can coexist.
- `src/types/chat.ts` — `ClaudeTask` interface + type guards.
- Reference commit: `coollabsio/jean@0116ed4` "add support for new Claude Code tasks format with separate TaskWidget and TodoWidget".
- Codex `update_plan` parity (snapshot, "replace whole list", source badge "plan"): `utensils/claudette` issue #867.

**Verified Symphony anchors (read before coding):**
- `elixir/lib/symphony_elixir/codex/session_log.ex:192-201` — `function_call` → `entry("tool_call", name, format_tool_input(args), call_id:)`; `format_tool_input/1` (`:280-292`) pretty-prints JSON. So Codex `update_plan` → `tool_call` entry, `title == "update_plan"`, `body == "{\n  \"plan\": [ ... ],\n  \"explanation\": ... \n}"`.
- `elixir/lib/symphony_elixir/claude/session_log.ex:193-213` — `tool_use` → `entry("tool_call", name, format_tool_input(input), call_id: id)`; `tool_result` → `entry("tool_result", "Tool output", output, call_id: tool_use_id)`. So Claude `TodoWrite`/`TaskCreate`/`TaskUpdate` → `tool_call` entries with `body` = pretty JSON of the input; the `TaskCreate` assigned id (`{task:{id,subject}}`) is in the **paired** `tool_result` body text.
- `tracker/src/types/session-log.ts:16-24` — `SessionLogEntry { kind, title, body: string|null, language, status, collapsed, callId }`.
- `tracker/src/components/issues/issue-detail/sessionToolCall.ts:9-31` — `pairSessionLogItems(entries)` pairs `tool_call`+`tool_result` by `callId`.
- `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx:27-105` — receives `entries: SessionLogEntry[]`, computes `items = pairSessionLogItems(entries)`, renders inside a `<section>` with a scroll `<div ref={containerRef}>`. The pinned panel mounts in the `<section>` above the scroll div; the inline marker replaces `<ToolCallBlock>` for task tool calls inside `items.map`.
- i18n: `tracker/locales/en/tracker.json` has an `issue.sessionLog` block (`:792`); add a sibling `issue.tasks` block. Mirror into `tracker/locales/pt-BR/tracker.json`.

**Decisions (justified):**
1. **Frontend-only** — the JSON is already in `body`; deriving on the client avoids backend coupling and works identically for Codex and Claude. A backend regression test prevents silent breakage if the parsers change.
2. **One normalized `AgentTask`** (`{id, text, status, source}`) — source-agnostic so the panel/inline card are written once; `source` only drives a small badge/label.
3. **Active list = most-recent task-tool source** — a single run rarely mixes sources; if it does, the latest task-tool update wins (deterministic, tested), exactly like Jean shows the freshest widget.
4. **Tasks-API id resolution from the paired `tool_result`** with a **subject fallback** — if the result text lacks `{task:{id}}`, key by `subject` (both `TaskCreate` and `TaskUpdate` carry it). Documented + tested, never left ambiguous.

---

## File Structure

**Create (tracker):**
- `tracker/src/types/agentTasks.ts` — `AgentTaskStatus`, `AgentTaskSource`, `AgentTask`, `AgentTaskSnapshot`.
- `tracker/src/lib/agentTasks.ts` — `isAgentTaskTool`, `deriveAgentTasks`, `taskToolLabel`.
- `tracker/src/lib/__tests__/agentTasks.test.ts`
- `tracker/src/components/issues/issue-detail/AgentTaskList.tsx` — pinned, collapsible panel.
- `tracker/src/components/issues/issue-detail/AgentTaskInlineCard.tsx` — compact inline transcript marker.
- `tracker/src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx`
- `tracker/src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx`

**Modify (tracker):**
- `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx` — derive the snapshot from `entries`; render `<AgentTaskList>` above the scroll container; render `<AgentTaskInlineCard>` for task-tool items.
- `tracker/src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx` — add panel + inline assertions (create the test file if it does not exist).
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — add `issue.tasks` block.

**Modify (elixir, regression only):**
- `elixir/test/symphony_elixir/codex/session_log_test.exs` — assert `update_plan` tool_call `body` carries the plan JSON.
- `elixir/test/symphony_elixir/claude/session_log_test.exs` — assert `TodoWrite` + `TaskCreate` tool_call `body` carry their JSON.

---

## Task 1: Types + pure parser (`agentTasks.ts`)

**Files:**
- Create: `tracker/src/types/agentTasks.ts`
- Create: `tracker/src/lib/agentTasks.ts`
- Test: `tracker/src/lib/__tests__/agentTasks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tracker/src/lib/__tests__/agentTasks.test.ts
import { describe, expect, it } from "vitest";

import { deriveAgentTasks, isAgentTaskTool } from "@/lib/agentTasks";
import type { SessionLogEntry } from "@/types/session-log";

function toolCall(title: string, body: unknown, callId: string): SessionLogEntry {
  return {
    kind: "tool_call",
    title,
    body: typeof body === "string" ? body : JSON.stringify(body),
    language: "json",
    status: "running",
    collapsed: false,
    callId,
  };
}

function toolResult(body: unknown, callId: string): SessionLogEntry {
  return {
    kind: "tool_result",
    title: "Tool output",
    body: typeof body === "string" ? body : JSON.stringify(body),
    language: "text",
    status: "completed",
    collapsed: false,
    callId,
  };
}

describe("isAgentTaskTool", () => {
  it("matches the four task tools case-insensitively", () => {
    expect(isAgentTaskTool("update_plan")).toBe(true);
    expect(isAgentTaskTool("TodoWrite")).toBe(true);
    expect(isAgentTaskTool("taskcreate")).toBe(true);
    expect(isAgentTaskTool("TaskUpdate")).toBe(true);
    expect(isAgentTaskTool("Bash")).toBe(false);
    expect(isAgentTaskTool("apply_patch")).toBe(false);
  });
});

describe("deriveAgentTasks", () => {
  it("returns null when there are no task tools", () => {
    expect(deriveAgentTasks([toolCall("Bash", { cmd: "ls" }, "c0")])).toBeNull();
  });

  it("parses a Codex update_plan snapshot with explanation", () => {
    const snap = deriveAgentTasks([
      toolCall(
        "update_plan",
        {
          explanation: "Kicking off",
          plan: [
            { step: "Write tests", status: "completed" },
            { step: "Implement", status: "in_progress" },
            { step: "Docs", status: "pending" },
          ],
        },
        "c1",
      ),
    ]);
    expect(snap).not.toBeNull();
    expect(snap?.source).toBe("plan");
    expect(snap?.explanation).toBe("Kicking off");
    expect(snap?.tasks.map((task) => [task.text, task.status])).toEqual([
      ["Write tests", "completed"],
      ["Implement", "in_progress"],
      ["Docs", "pending"],
    ]);
  });

  it("replaces the whole list on a later update_plan snapshot", () => {
    const snap = deriveAgentTasks([
      toolCall("update_plan", { plan: [{ step: "Old", status: "pending" }] }, "c1"),
      toolCall("update_plan", { plan: [{ step: "New", status: "in_progress" }] }, "c2"),
    ]);
    expect(snap?.tasks).toHaveLength(1);
    expect(snap?.tasks[0]).toMatchObject({ text: "New", status: "in_progress" });
  });

  it("parses Claude TodoWrite, preferring activeForm while in_progress", () => {
    const snap = deriveAgentTasks([
      toolCall(
        "TodoWrite",
        {
          todos: [
            { content: "Set up DB", status: "completed", activeForm: "Setting up DB" },
            { content: "Wire API", status: "in_progress", activeForm: "Wiring API" },
          ],
        },
        "t1",
      ),
    ]);
    expect(snap?.source).toBe("todo");
    expect(snap?.tasks.map((task) => task.text)).toEqual(["Set up DB", "Wiring API"]);
  });

  it("accumulates the Claude Tasks API by id from the paired tool_result", () => {
    const snap = deriveAgentTasks([
      toolCall("TaskCreate", { subject: "Set up DB" }, "c1"),
      toolResult({ task: { id: "task_42", subject: "Set up DB" } }, "c1"),
      toolCall("TaskCreate", { subject: "Wire API" }, "c2"),
      toolResult({ task: { id: "task_43", subject: "Wire API" } }, "c2"),
      toolCall("TaskUpdate", { taskId: "task_42", status: "completed" }, "c3"),
      toolCall("TaskUpdate", { taskId: "task_43", status: "in_progress" }, "c4"),
    ]);
    expect(snap?.source).toBe("task");
    expect(snap?.tasks.map((task) => [task.id, task.text, task.status])).toEqual([
      ["task_42", "Set up DB", "completed"],
      ["task_43", "Wire API", "in_progress"],
    ]);
  });

  it("falls back to subject as id when the result lacks a task id", () => {
    const snap = deriveAgentTasks([
      toolCall("TaskCreate", { subject: "Lonely task" }, "c1"),
      toolCall("TaskUpdate", { subject: "Lonely task", status: "completed" }, "c2"),
    ]);
    expect(snap?.tasks).toEqual([
      { id: "Lonely task", text: "Lonely task", status: "completed", source: "task" },
    ]);
  });

  it("removes a task on TaskUpdate status deleted", () => {
    const snap = deriveAgentTasks([
      toolCall("TaskCreate", { subject: "A" }, "c1"),
      toolResult({ task: { id: "t_a", subject: "A" } }, "c1"),
      toolCall("TaskCreate", { subject: "B" }, "c2"),
      toolResult({ task: { id: "t_b", subject: "B" } }, "c2"),
      toolCall("TaskUpdate", { taskId: "t_a", status: "deleted" }, "c3"),
    ]);
    expect(snap?.tasks.map((task) => task.id)).toEqual(["t_b"]);
  });

  it("uses the most recent task-tool source when sources are mixed", () => {
    const snap = deriveAgentTasks([
      toolCall("update_plan", { plan: [{ step: "P", status: "pending" }] }, "c1"),
      toolCall("TodoWrite", { todos: [{ content: "T", status: "in_progress" }] }, "c2"),
    ]);
    expect(snap?.source).toBe("todo");
    expect(snap?.tasks[0].text).toBe("T");
  });

  it("skips malformed JSON bodies without throwing", () => {
    const snap = deriveAgentTasks([
      toolCall("update_plan", "{ not json", "c1"),
      toolCall("TodoWrite", { todos: [{ content: "Valid", status: "pending" }] }, "c2"),
    ]);
    expect(snap?.source).toBe("todo");
    expect(snap?.tasks[0].text).toBe("Valid");
  });

  it("returns null when the active snapshot ends up empty", () => {
    expect(deriveAgentTasks([toolCall("update_plan", { plan: [] }, "c1")])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tracker && npx vitest run src/lib/__tests__/agentTasks.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/agentTasks"`.

- [ ] **Step 3: Write the types**

```ts
// tracker/src/types/agentTasks.ts
export type AgentTaskStatus = "pending" | "in_progress" | "completed";

export type AgentTaskSource = "plan" | "todo" | "task";

export interface AgentTask {
  id: string;
  text: string;
  status: AgentTaskStatus;
  source: AgentTaskSource;
}

export interface AgentTaskSnapshot {
  source: AgentTaskSource;
  tasks: AgentTask[];
  explanation?: string;
}
```

- [ ] **Step 4: Write the parser**

```ts
// tracker/src/lib/agentTasks.ts
import type { AgentTask, AgentTaskSnapshot, AgentTaskSource, AgentTaskStatus } from "@/types/agentTasks";
import type { SessionLogEntry } from "@/types/session-log";

const TASK_TOOLS = new Set(["update_plan", "todowrite", "taskcreate", "taskupdate"]);

export function isAgentTaskTool(title: string | null | undefined): boolean {
  if (!title) return false;
  return TASK_TOOLS.has(title.trim().toLowerCase());
}

export function taskToolLabel(source: AgentTaskSource): string {
  if (source === "plan") return "Plan";
  if (source === "todo") return "Todos";
  return "Tasks";
}

function normalizeStatus(value: unknown): AgentTaskStatus {
  if (value === "in_progress" || value === "completed") return value;
  return "pending";
}

function parseBody(body: string | null): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function planTasks(parsed: Record<string, unknown>): AgentTask[] {
  const plan = parsed.plan;
  if (!Array.isArray(plan)) return [];
  return plan
    .map((raw, index): AgentTask | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const item = raw as Record<string, unknown>;
      const text = typeof item.step === "string" ? item.step : typeof item.text === "string" ? item.text : null;
      if (!text) return null;
      return { id: `plan-${index}`, text, status: normalizeStatus(item.status), source: "plan" };
    })
    .filter((task): task is AgentTask => task !== null);
}

function todoTasks(parsed: Record<string, unknown>): AgentTask[] {
  const todos = parsed.todos;
  if (!Array.isArray(todos)) return [];
  return todos
    .map((raw, index): AgentTask | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const item = raw as Record<string, unknown>;
      const status = normalizeStatus(item.status);
      const activeForm = typeof item.activeForm === "string" ? item.activeForm : null;
      const content = typeof item.content === "string" ? item.content : null;
      const text = status === "in_progress" && activeForm ? activeForm : content ?? activeForm;
      if (!text) return null;
      return { id: `todo-${index}`, text, status, source: "todo" };
    })
    .filter((task): task is AgentTask => task !== null);
}

function resultsByCallId(entries: SessionLogEntry[]): Map<string, SessionLogEntry> {
  const map = new Map<string, SessionLogEntry>();
  for (const entry of entries) {
    if (entry.kind === "tool_result" && entry.callId) map.set(entry.callId, entry);
  }
  return map;
}

function createdTaskId(call: SessionLogEntry, results: Map<string, SessionLogEntry>, subject: string): string {
  if (!call.callId) return subject;
  const result = results.get(call.callId);
  const parsed = result ? parseBody(result.body) : null;
  const task = parsed?.task;
  if (typeof task === "object" && task !== null) {
    const id = (task as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return subject;
}

/**
 * Builds the agent's current task snapshot from the session-log stream.
 *
 * `update_plan` (Codex) and `TodoWrite` (Claude) are whole-list snapshots —
 * each occurrence replaces the prior list. The Claude Tasks API
 * (`TaskCreate`/`TaskUpdate`) is accumulated by task id (resolved from the
 * paired `tool_result`, falling back to the subject). When more than one source
 * appears in a run, the most recent task-tool activity wins.
 */
export function deriveAgentTasks(entries: SessionLogEntry[]): AgentTaskSnapshot | null {
  const results = resultsByCallId(entries);

  let planSnapshot: AgentTask[] | null = null;
  let planExplanation: string | undefined;
  let todoSnapshot: AgentTask[] | null = null;
  const taskMap = new Map<string, AgentTask>();
  let activeSource: AgentTaskSource | null = null;

  for (const entry of entries) {
    if (entry.kind !== "tool_call" || !isAgentTaskTool(entry.title)) continue;
    const parsed = parseBody(entry.body);
    if (!parsed) continue;
    const tool = entry.title.trim().toLowerCase();

    if (tool === "update_plan") {
      planSnapshot = planTasks(parsed);
      planExplanation = typeof parsed.explanation === "string" ? parsed.explanation : undefined;
      activeSource = "plan";
    } else if (tool === "todowrite") {
      todoSnapshot = todoTasks(parsed);
      activeSource = "todo";
    } else if (tool === "taskcreate") {
      const subject = typeof parsed.subject === "string" ? parsed.subject : null;
      if (subject) {
        const id = createdTaskId(entry, results, subject);
        taskMap.set(id, { id, text: subject, status: "pending", source: "task" });
        activeSource = "task";
      }
    } else if (tool === "taskupdate") {
      const id =
        typeof parsed.taskId === "string"
          ? parsed.taskId
          : typeof parsed.subject === "string"
            ? parsed.subject
            : null;
      if (id) {
        if (parsed.status === "deleted") {
          taskMap.delete(id);
        } else {
          const existing = taskMap.get(id);
          const subject = typeof parsed.subject === "string" ? parsed.subject : existing?.text ?? id;
          taskMap.set(id, {
            id,
            text: subject,
            status: parsed.status === undefined ? existing?.status ?? "pending" : normalizeStatus(parsed.status),
            source: "task",
          });
        }
        activeSource = "task";
      }
    }
  }

  if (activeSource === "plan" && planSnapshot && planSnapshot.length > 0) {
    return { source: "plan", tasks: planSnapshot, explanation: planExplanation };
  }
  if (activeSource === "todo" && todoSnapshot && todoSnapshot.length > 0) {
    return { source: "todo", tasks: todoSnapshot };
  }
  if (activeSource === "task" && taskMap.size > 0) {
    return { source: "task", tasks: Array.from(taskMap.values()) };
  }
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tracker && npx vitest run src/lib/__tests__/agentTasks.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/agentTasks.ts tracker/src/lib/agentTasks.ts tracker/src/lib/__tests__/agentTasks.test.ts
git commit -m "feat(agent-tasks): derive normalized task snapshot from session log"
```

---

## Task 2: Pinned task panel (`AgentTaskList`)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/AgentTaskList.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx`

- [ ] **Step 1: Add i18n keys (used by the component test)**

In `tracker/locales/en/tracker.json`, inside the `issue` object, add a sibling of `sessionLog`:

```json
    "tasks": {
      "title": "Tasks",
      "progress": "{{done}}/{{total}} done",
      "collapse": "Collapse tasks",
      "expand": "Expand tasks",
      "status": {
        "pending": "Pending",
        "in_progress": "In progress",
        "completed": "Completed"
      },
      "inline": "{{label}} · {{done}}/{{total}} done"
    }
```

Mirror the same block into `tracker/locales/pt-BR/tracker.json`:

```json
    "tasks": {
      "title": "Tarefas",
      "progress": "{{done}}/{{total}} concluídas",
      "collapse": "Recolher tarefas",
      "expand": "Expandir tarefas",
      "status": {
        "pending": "Pendente",
        "in_progress": "Em progresso",
        "completed": "Concluída"
      },
      "inline": "{{label}} · {{done}}/{{total}} concluídas"
    }
```

- [ ] **Step 2: Write the failing test**

```tsx
// tracker/src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AgentTaskList } from "@/components/issues/issue-detail/AgentTaskList";
import { renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  explanation: "Working through the plan",
  tasks: [
    { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
    { id: "plan-1", text: "Implement", status: "in_progress", source: "plan" },
    { id: "plan-2", text: "Docs", status: "pending", source: "plan" },
  ],
};

describe("AgentTaskList", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the tasks with a progress count and explanation", () => {
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("1/3 done")).toBeInTheDocument();
    expect(screen.getByText("Working through the plan")).toBeInTheDocument();
  });

  it("marks completed tasks with a completed status label", () => {
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    const completed = screen.getByText("Write tests").closest("li");
    expect(completed).toHaveAttribute("data-status", "completed");
  });

  it("collapses and expands the list, persisting the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: "Collapse tasks" }));
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    unmount();
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand tasks" })).toBeInTheDocument();
  });
});
```

> If `@/i18n/testUtils` does not export `renderWithI18n`, read `tracker/src/i18n/testUtils.tsx` and use the helper it provides (e.g. wrap with the i18n provider via `render`). Match the import other issue-detail tests use.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx`
Expected: FAIL — cannot resolve `@/components/issues/issue-detail/AgentTaskList`.

- [ ] **Step 4: Write the component**

```tsx
// tracker/src/components/issues/issue-detail/AgentTaskList.tsx
import { CheckCircle2, ChevronDown, ChevronRight, Circle, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentTask, AgentTaskSnapshot, AgentTaskStatus } from "@/types/agentTasks";

const STORAGE_KEY = "symphony.agentTasks.collapsed";

interface AgentTaskListProps {
  snapshot: AgentTaskSnapshot;
}

function statusIcon(status: AgentTaskStatus) {
  if (status === "completed") return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "in_progress") return <Loader2 className="size-4 shrink-0 animate-spin text-amber-500" aria-hidden />;
  return <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function AgentTaskList({ snapshot }: AgentTaskListProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(() => window.localStorage.getItem(STORAGE_KEY) === "true");

  const done = snapshot.tasks.filter((task) => task.status === "completed").length;

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <section className="mb-3 rounded-lg border bg-muted/30 p-3" aria-label={t("issue.tasks.title")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("issue.tasks.expand") : t("issue.tasks.collapse")}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          <ListChecks className="size-3.5" aria-hidden />
          {t("issue.tasks.title")}
        </button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t("issue.tasks.progress", { done, total: snapshot.tasks.length })}
        </span>
      </div>
      {collapsed ? null : (
        <>
          {snapshot.explanation ? <p className="mt-2 text-xs text-muted-foreground">{snapshot.explanation}</p> : null}
          <ul className="mt-2 space-y-1">
            {snapshot.tasks.map((task: AgentTask) => (
              <li
                key={task.id}
                data-status={task.status}
                className="flex items-center gap-2 text-sm"
                title={t(`issue.tasks.status.${task.status}`)}
              >
                {statusIcon(task.status)}
                <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>{task.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/issues/issue-detail/AgentTaskList.tsx \
        tracker/src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx \
        tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(agent-tasks): pinned collapsible task panel"
```

---

## Task 3: Inline transcript marker (`AgentTaskInlineCard`)

**Files:**
- Create: `tracker/src/components/issues/issue-detail/AgentTaskInlineCard.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tracker/src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AgentTaskInlineCard } from "@/components/issues/issue-detail/AgentTaskInlineCard";
import { renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
    { id: "plan-1", text: "Implement", status: "in_progress", source: "plan" },
  ],
};

describe("AgentTaskInlineCard", () => {
  it("shows a one-line summary with the source label and progress", () => {
    renderWithI18n(<AgentTaskInlineCard snapshot={snapshot} />);
    expect(screen.getByText("Plan · 1/2 done")).toBeInTheDocument();
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
  });

  it("expands to reveal the task list", async () => {
    const user = userEvent.setup();
    renderWithI18n(<AgentTaskInlineCard snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: /Plan/ }));
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx`
Expected: FAIL — cannot resolve `AgentTaskInlineCard`.

- [ ] **Step 3: Write the component**

```tsx
// tracker/src/components/issues/issue-detail/AgentTaskInlineCard.tsx
import { CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { taskToolLabel } from "@/lib/agentTasks";
import { cn } from "@/lib/utils";
import type { AgentTaskSnapshot, AgentTaskStatus } from "@/types/agentTasks";

interface AgentTaskInlineCardProps {
  snapshot: AgentTaskSnapshot;
}

function statusIcon(status: AgentTaskStatus) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "in_progress") return <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" aria-hidden />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

export function AgentTaskInlineCard({ snapshot }: AgentTaskInlineCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const done = snapshot.tasks.filter((task) => task.status === "completed").length;
  const label = taskToolLabel(snapshot.source);

  return (
    <div className="rounded-lg border border-dashed bg-background/60 p-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 font-medium text-muted-foreground"
      >
        <ListChecks className="size-3.5" aria-hidden />
        {t("issue.tasks.inline", { label, done, total: snapshot.tasks.length })}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1">
          {snapshot.tasks.map((task) => (
            <li key={task.id} data-status={task.status} className="flex items-center gap-2">
              {statusIcon(task.status)}
              <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>{task.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/AgentTaskInlineCard.tsx \
        tracker/src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx
git commit -m "feat(agent-tasks): inline transcript task marker"
```

---

## Task 4: Wire the panel + inline marker into `IssueSessionLog`

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx` (create if missing)

- [ ] **Step 1: Write the failing integration test**

```tsx
// tracker/src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { renderWithI18n } from "@/i18n/testUtils";
import type { SessionLogEntry } from "@/types/session-log";

function entry(partial: Partial<SessionLogEntry> & Pick<SessionLogEntry, "kind" | "title">): SessionLogEntry {
  return {
    body: null,
    language: "text",
    status: null,
    collapsed: false,
    callId: null,
    ...partial,
  };
}

const entries: SessionLogEntry[] = [
  entry({ kind: "assistant", title: "Codex", body: "Starting", language: "markdown" }),
  entry({
    kind: "tool_call",
    title: "update_plan",
    body: JSON.stringify({ plan: [{ step: "Write tests", status: "in_progress" }, { step: "Ship", status: "pending" }] }),
    language: "json",
    callId: "call_1",
  }),
];

describe("IssueSessionLog tasks", () => {
  it("renders the pinned task panel above the transcript", () => {
    renderWithI18n(
      <IssueSessionLog issueIdentifier="ABC-1" connected entries={entries} error={null} />,
    );
    expect(screen.getByLabelText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("0/2 done")).toBeInTheDocument();
  });

  it("renders an inline task marker instead of a raw tool-call block", () => {
    renderWithI18n(
      <IssueSessionLog issueIdentifier="ABC-1" connected entries={entries} error={null} />,
    );
    expect(screen.getByText("Plan · 0/2 done")).toBeInTheDocument();
  });

  it("renders no panel when there are no task tools", () => {
    const plain = [entry({ kind: "tool_call", title: "Bash", body: JSON.stringify({ cmd: "ls" }), callId: "c" })];
    renderWithI18n(<IssueSessionLog issueIdentifier="ABC-1" connected entries={plain} error={null} />);
    expect(screen.queryByLabelText("Tasks")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx`
Expected: FAIL — no `Tasks` panel / no inline marker yet.

- [ ] **Step 3: Modify `IssueSessionLog.tsx`**

Add imports near the existing ones (top of file):

```tsx
import { AgentTaskInlineCard } from "@/components/issues/issue-detail/AgentTaskInlineCard";
import { AgentTaskList } from "@/components/issues/issue-detail/AgentTaskList";
import { deriveAgentTasks, isAgentTaskTool } from "@/lib/agentTasks";
```

After `const items = pairSessionLogItems(entries);` add:

```tsx
  const taskSnapshot = deriveAgentTasks(entries);
```

Render the pinned panel inside the `<section>` but **above** the scroll container — i.e. immediately before the `{error ? (...) : (...)}` block:

```tsx
      {taskSnapshot ? <AgentTaskList snapshot={taskSnapshot} /> : null}
```

In the transcript map, route task-tool calls to the inline marker. Replace the existing `item.type === "toolCall" ? (...)` branch with:

```tsx
              item.type === "toolCall" ? (
                isAgentTaskTool(item.call.title) && taskSnapshot ? (
                  <AgentTaskInlineCard snapshot={taskSnapshot} key={`task-${item.call.callId}-${index}`} />
                ) : (
                  <ToolCallBlock view={sessionPairToView(item.call, item.result)} key={`tool-${item.call.callId}-${index}`} />
                )
              ) : (
```

> The inline marker shows the current snapshot (latest state) at each task-tool point — matching Jean, where the in-chat widget reflects the live list. Keeping a single derived `taskSnapshot` avoids re-parsing per row.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/IssueSessionLog.tsx \
        tracker/src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx
git commit -m "feat(agent-tasks): show task panel and inline markers in the session log"
```

---

## Task 5: Backend regression tests (JSON keeps reaching the client)

**Files:**
- Modify: `elixir/test/symphony_elixir/codex/session_log_test.exs`
- Modify: `elixir/test/symphony_elixir/claude/session_log_test.exs`

- [ ] **Step 1: Add the Codex regression test**

Append inside the existing top-level `describe`/module (match the file's style; `parse_line/1` is the public entry):

```elixir
  test "update_plan tool call keeps the full plan JSON in the entry body" do
    line =
      Jason.encode!(%{
        "type" => "response_item",
        "payload" => %{
          "type" => "function_call",
          "name" => "update_plan",
          "call_id" => "call_1",
          "arguments" =>
            Jason.encode!(%{
              "explanation" => "Starting",
              "plan" => [
                %{"step" => "Write tests", "status" => "completed"},
                %{"step" => "Implement", "status" => "in_progress"}
              ]
            })
        }
      })

    entry = SymphonyElixir.Codex.SessionLog.parse_line(line)

    assert entry["kind"] == "tool_call"
    assert entry["title"] == "update_plan"
    assert entry["body"] =~ "\"plan\""
    assert entry["body"] =~ "Write tests"
    assert entry["body"] =~ "in_progress"
  end
```

- [ ] **Step 2: Add the Claude regression tests**

```elixir
  test "TodoWrite tool use keeps the todos JSON in the entry body" do
    line =
      Jason.encode!(%{
        "type" => "assistant",
        "message" => %{
          "content" => [
            %{
              "type" => "tool_use",
              "id" => "toolu_1",
              "name" => "TodoWrite",
              "input" => %{
                "todos" => [
                  %{"content" => "Set up DB", "status" => "completed", "activeForm" => "Setting up DB"},
                  %{"content" => "Wire API", "status" => "in_progress", "activeForm" => "Wiring API"}
                ]
              }
            }
          ]
        }
      })

    entry = SymphonyElixir.Claude.SessionLog.parse_line(line)

    assert entry["kind"] == "tool_call"
    assert entry["title"] == "TodoWrite"
    assert entry["body"] =~ "\"todos\""
    assert entry["body"] =~ "Wire API"
  end

  test "TaskCreate tool use keeps the subject JSON in the entry body" do
    line =
      Jason.encode!(%{
        "type" => "assistant",
        "message" => %{
          "content" => [
            %{"type" => "tool_use", "id" => "toolu_2", "name" => "TaskCreate", "input" => %{"subject" => "Set up DB"}}
          ]
        }
      })

    entry = SymphonyElixir.Claude.SessionLog.parse_line(line)

    assert entry["kind"] == "tool_call"
    assert entry["title"] == "TaskCreate"
    assert entry["body"] =~ "Set up DB"
  end
```

- [ ] **Step 3: Run the backend tests**

Run: `cd elixir && mix test test/symphony_elixir/codex/session_log_test.exs test/symphony_elixir/claude/session_log_test.exs`
Expected: PASS (existing tests + the 3 new ones).

- [ ] **Step 4: Commit**

```bash
git add elixir/test/symphony_elixir/codex/session_log_test.exs \
        elixir/test/symphony_elixir/claude/session_log_test.exs
git commit -m "test(session-log): guard that task tool JSON stays in the entry body"
```

---

## Task 6: Full gates

- [ ] **Step 1: Tracker lint + tests + build**

Run: `cd tracker && npm run lint && npx vitest run src/lib/__tests__/agentTasks.test.ts src/components/issues/issue-detail/__tests__/AgentTaskList.test.tsx src/components/issues/issue-detail/__tests__/AgentTaskInlineCard.test.tsx src/components/issues/issue-detail/__tests__/IssueSessionLog.test.tsx && npm run build`
Expected: lint clean, all task tests pass, `tsc`/`vite build` succeeds.

- [ ] **Step 2: Elixir gate**

Run: `cd elixir && mix format --check-formatted && mix test test/symphony_elixir/codex/session_log_test.exs test/symphony_elixir/claude/session_log_test.exs`
Expected: formatted; tests green.

- [ ] **Step 3: Commit any formatting fixups**

```bash
git add -A
git commit -m "chore(agent-tasks): formatting and gate fixups" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage**
- Codex `update_plan` snapshot → Task 1 (`planTasks`) + tests. ✓
- Claude `TodoWrite` snapshot (activeForm while in_progress) → Task 1 (`todoTasks`) + test. ✓
- Claude Tasks API `TaskCreate`/`TaskUpdate` accumulate-by-id, id from paired `tool_result`, subject fallback, `deleted` removal → Task 1 + tests. ✓
- Most-recent-source wins when mixed → Task 1 + test. ✓
- Pinned collapsible panel (counts, explanation, persistence, completed styling) → Task 2. ✓
- Inline transcript marker → Task 3 + Task 4 wiring. ✓
- Frontend-only + backend regression guard → Task 5. ✓
- i18n en + pt-BR → Task 2 Step 1. ✓

**2. Placeholder scan** — every code step contains complete code; the only soft note is the `renderWithI18n` import guard (a concrete read-and-match instruction, not a code blank).

**3. Type consistency** — `AgentTask { id, text, status, source }` and `AgentTaskSnapshot { source, tasks, explanation? }` are used identically across `types/agentTasks.ts`, `lib/agentTasks.ts`, `AgentTaskList.tsx`, `AgentTaskInlineCard.tsx`, and all tests. `AgentTaskStatus` values (`pending`/`in_progress`/`completed`) match the i18n `issue.tasks.status.*` keys.

## Open risks
- **Tasks-API id from `tool_result`**: depends on the result body text containing `{"task":{"id":...}}`. If Claude emits a non-JSON confirmation string, the subject fallback keeps the list correct as long as `TaskUpdate` carries `subject` (it may not). Mitigation shipped: subject-keyed fallback + a test; a follow-up could parse `~/.claude/tasks/<id>.json` server-side if needs prove it.
- **64KB tail window** (`SessionLog.tail`): a very long run could push the earliest `update_plan`/`TodoWrite` snapshot out of the tail. Acceptable for v1 because these tools emit a *full* snapshot on every change, so the latest (recent) entry carries the complete list; `read_from` streaming appends newer ones.
- **Multi-source runs**: "latest wins" is deterministic but, in the rare case an agent alternates sources, only one list shows. Documented; revisit only if real runs mix sources.
