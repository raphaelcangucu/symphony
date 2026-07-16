import type { ToolCallView } from "@/components/shared/ToolCallBlock";
import { i18n } from "@/i18n";
import { enrichCursorToolPresentation, formatToolOutput, resolveToolDisplayName } from "@/lib/toolCallDisplay";
import type { AssistantToolCall, AssistantToolStatus } from "@/services/assistant";

const ACTION_TOOLS = new Set<string>([
  "create_issue",
  "create_draft_issue",
  "update_issue",
  "move_issue",
  "dispatch_coding_agent",
  "dispatch_codex",
  "add_comment",
  "delete_comment",
]);

const ACTION_PREFIXES = ["create_", "update_", "move_", "dispatch_", "provision_", "add_", "delete_"];
const SHELL_TOOLS = new Set(["Bash", "bash", "shell", "Shell"]);

export function isActionTool(name: string): boolean {
  if (ACTION_TOOLS.has(name)) return true;
  return ACTION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.has(name);
}

// `assistantToolCallToView` runs `JSON.parse`/`JSON.stringify` over potentially
// large tool payloads. Streaming + normalization always produce a NEW
// `AssistantToolCall` object whenever a call changes, so caching by object
// identity is safe: an unchanged call returns the cached view (skipping the
// per-render parse), while a changed call is a distinct object and recomputes.
const toolCallViewCache = new WeakMap<AssistantToolCall, ToolCallView>();

export function assistantToolCallToView(toolCall: AssistantToolCall): ToolCallView {
  const cached = toolCallViewCache.get(toolCall);
  if (cached) return cached;

  const view = buildToolCallView(toolCall);
  toolCallViewCache.set(toolCall, view);
  return view;
}

function buildToolCallView(toolCall: AssistantToolCall): ToolCallView {
  const presentation = enrichCursorToolPresentation(toolCall.name, toolCall.arguments);
  const inputJson = serializeArguments(toolCall.arguments);
  const output = toolCall.output ? formatToolOutput(toolCall.output) : null;
  const inputSection =
    presentation.detailMarkdown != null
      ? { value: presentation.detailMarkdown, language: "markdown" as const }
      : inputJson
        ? {
            value: inputJson,
            language: (isShellTool(toolCall.name) ? "bash" : "json") as "bash" | "json",
          }
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
