import { describe, expect, it } from "vitest";

import {
  assistantToolCallsToSessionLogEntries,
  deriveAgentTasks,
  deriveAgentTasksFromAssistantMessages,
  deriveAgentTasksFromAssistantToolCalls,
  isAgentTaskTool,
} from "@/lib/agentTasks";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";
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
    expect(isAgentTaskTool(null)).toBe(false);
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

function assistantCall(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return {
    id: "c1",
    name: "update_plan",
    status: "complete",
    arguments: {},
    output: null,
    result: {},
    ...overrides,
  };
}

describe("assistant task adapters", () => {
  it("converts assistant tool calls into session-log entries", () => {
    const entries = assistantToolCallsToSessionLogEntries([
      assistantCall({
        id: "c1",
        arguments: { plan: [{ step: "Ship", status: "pending" }] },
        output: JSON.stringify({ ok: true }),
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "tool_call", title: "update_plan", callId: "c1" });
    expect(entries[1]).toMatchObject({ kind: "tool_result", callId: "c1" });
  });

  it("derives tasks from assistant tool calls", () => {
    const snap = deriveAgentTasksFromAssistantToolCalls([
      assistantCall({
        arguments: {
          plan: [
            { step: "Write tests", status: "completed" },
            { step: "Ship", status: "pending" },
          ],
        },
      }),
    ]);
    expect(snap?.tasks.map((task) => task.text)).toEqual(["Write tests", "Ship"]);
  });

  it("derives tasks from assistant messages across turns", () => {
    const messages: AssistantChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: "Planning",
        metadata: {},
        toolCalls: [
          assistantCall({
            id: "c1",
            arguments: { plan: [{ step: "Old", status: "pending" }] },
          }),
        ],
      },
      {
        id: "m2",
        role: "assistant",
        content: "Updated",
        metadata: {},
        toolCalls: [
          assistantCall({
            id: "c2",
            arguments: { plan: [{ step: "New", status: "in_progress" }] },
          }),
        ],
      },
    ];
    const snap = deriveAgentTasksFromAssistantMessages(messages);
    expect(snap?.tasks).toHaveLength(1);
    expect(snap?.tasks[0]).toMatchObject({ text: "New", status: "in_progress" });
  });
});
