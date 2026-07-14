import type { ToolCallView } from "@/components/shared/ToolCallBlock";
import { i18n } from "@/i18n";
import { formatToolOutput, resolveToolDisplayName } from "@/lib/toolCallDisplay";
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
const SHELL_TOOLS = new Set(["Bash", "bash", "shell", "Shell"]);

export function isActionTool(name: string): boolean {
  if (ACTION_TOOLS.has(name)) return true;
  return ACTION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.has(name);
}

export function assistantToolCallToView(toolCall: AssistantToolCall): ToolCallView {
  const input = serializeArguments(toolCall.arguments);
  const output = toolCall.output ? formatToolOutput(toolCall.output) : null;

  return {
    toolType: localizeToolName(toolCall.name, input, output),
    description: null,
    status: mapStatus(toolCall.status),
    input: input ? { value: input, language: isShellTool(toolCall.name) ? "bash" : "json" } : null,
    output: output ? { value: output, language: "text" } : null,
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

function localizeToolName(name: string, input: string | null, output: string | null): string {
  const symphonyLabel = i18n.t(`issue.toolCall.tools.${name}`, { defaultValue: "" });
  if (symphonyLabel) return symphonyLabel;
  return resolveToolDisplayName(name, input, output);
}
