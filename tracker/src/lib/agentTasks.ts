import type { AgentTask, AgentTaskSnapshot, AgentTaskSource, AgentTaskStatus } from "@/types/agentTasks";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";
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
      const text = status === "in_progress" && activeForm ? activeForm : (content ?? activeForm);
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
 * `update_plan` (Codex) and `TodoWrite` (Claude) are whole-list snapshots — each
 * occurrence replaces the prior list. The Claude Tasks API
 * (`TaskCreate`/`TaskUpdate`) is accumulated by task id (resolved from the paired
 * `tool_result`, falling back to the subject). When more than one source appears
 * in a run, the most recent task-tool activity wins.
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
          const subject = typeof parsed.subject === "string" ? parsed.subject : (existing?.text ?? id);
          taskMap.set(id, {
            id,
            text: subject,
            status: parsed.status === undefined ? (existing?.status ?? "pending") : normalizeStatus(parsed.status),
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

function mapAssistantToolStatus(status: AssistantToolCall["status"]): SessionLogEntry["status"] {
  if (status === "running") return "running";
  if (status === "error") return "failed";
  return "completed";
}

function serializeAssistantToolArguments(args: AssistantToolCall["arguments"]): string | null {
  if (!args || typeof args !== "object" || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}

function resolveAssistantToolResultBody(call: AssistantToolCall): string | null {
  if (typeof call.output === "string" && call.output.trim() !== "") return call.output;

  const task = call.result?.task;
  if (typeof task === "object" && task !== null) {
    try {
      return JSON.stringify({ task }, null, 2);
    } catch {
      return null;
    }
  }

  return null;
}

export function assistantToolCallToSessionLogEntry(call: AssistantToolCall): SessionLogEntry {
  return {
    kind: "tool_call",
    title: call.name,
    body: serializeAssistantToolArguments(call.arguments),
    language: "json",
    status: mapAssistantToolStatus(call.status),
    collapsed: false,
    callId: call.id,
  };
}

export function assistantToolResultToSessionLogEntry(call: AssistantToolCall): SessionLogEntry | null {
  if (call.status === "running") return null;
  const body = resolveAssistantToolResultBody(call);
  if (!body) return null;

  return {
    kind: "tool_result",
    title: "Tool output",
    body,
    language: "text",
    status: call.status === "error" ? "failed" : "completed",
    collapsed: false,
    callId: call.id,
  };
}

/** Converts assistant tool calls into the session-log shape used by `deriveAgentTasks`. */
export function assistantToolCallsToSessionLogEntries(toolCalls: AssistantToolCall[]): SessionLogEntry[] {
  const entries: SessionLogEntry[] = [];
  for (const call of toolCalls) {
    entries.push(assistantToolCallToSessionLogEntry(call));
    const result = assistantToolResultToSessionLogEntry(call);
    if (result) entries.push(result);
  }
  return entries;
}

export function deriveAgentTasksFromAssistantToolCalls(toolCalls: AssistantToolCall[]): AgentTaskSnapshot | null {
  return deriveAgentTasks(assistantToolCallsToSessionLogEntries(toolCalls));
}

export function deriveAgentTasksFromAssistantMessages(messages: AssistantChatMessage[]): AgentTaskSnapshot | null {
  return deriveAgentTasksFromAssistantToolCalls(messages.flatMap((message) => message.toolCalls));
}
