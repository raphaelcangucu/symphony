import type { ToolCallView } from "@/components/shared/ToolCallBlock";
import { i18n } from "@/i18n";
import type { AssistantToolCall, AssistantToolStatus } from "@/services/assistant";

const ACTION_TOOLS = new Set<string>([
  "create_issue",
  "create_draft_issue",
  "update_issue",
  "move_issue",
  "dispatch_coding_agent",
  "dispatch_codex",
  "add_comment",
]);

const ACTION_PREFIXES = ["create_", "update_", "move_", "dispatch_", "provision_", "add_"];

export function isActionTool(name: string): boolean {
  if (ACTION_TOOLS.has(name)) return true;
  return ACTION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function assistantToolCallToView(toolCall: AssistantToolCall): ToolCallView {
  const action = isActionTool(toolCall.name);
  const input = serializeArguments(toolCall.arguments);

  return {
    toolType: localizeToolName(toolCall.name),
    description: null,
    status: mapStatus(toolCall.status),
    input: input ? { value: input, language: "json" } : null,
    output: toolCall.output ? { value: toolCall.output, language: "text" } : null,
    defaultCollapsed: true,
  };
}

function serializeArguments(args: AssistantToolCall["arguments"]): string | null {
  if (!args || typeof args !== "object" || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function mapStatus(status: AssistantToolStatus): ToolCallView["status"] {
  if (status === "running") return "running";
  if (status === "error") return "failed";
  return "completed";
}

function localizeToolName(name: string): string {
  return i18n.t(`issue.toolCall.tools.${name}`, { defaultValue: humanize(name) });
}

function humanize(value: string): string {
  const words = value.replace(/_/g, " ").split(" ").filter(Boolean).join(" ");
  if (words.length === 0) return value;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
