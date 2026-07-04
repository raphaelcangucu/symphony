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

export function classifyToolName(name: string): ToolGroupKind {
  if (EDIT_TOOLS.has(name)) return "edit";
  if (COMMAND_TOOLS.has(name)) return "command";
  if (READ_TOOLS.has(name)) return "read";
  if (isActionTool(name)) return "action";
  if (QUERY_PREFIXES.some((prefix) => name.startsWith(prefix))) return "query";
  return "other";
}

export function classifyToolCall(call: AssistantToolCall): ToolGroupKind {
  return classifyToolName(call.name);
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
