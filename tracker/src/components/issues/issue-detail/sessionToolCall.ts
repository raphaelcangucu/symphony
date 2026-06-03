import type { ToolBlockLanguage, ToolCallView } from "@/components/shared/ToolCallBlock";
import type { SessionLogEntry, SessionLogEntryLanguage } from "@/types/session-log";

export type SessionLogRenderItem =
  | { type: "entry"; entry: SessionLogEntry }
  | { type: "toolCall"; call: SessionLogEntry; result: SessionLogEntry | null };

export function pairSessionLogItems(entries: SessionLogEntry[]): SessionLogRenderItem[] {
  const consumedResultIndexes = new Set<number>();
  const items: SessionLogRenderItem[] = [];

  entries.forEach((entry, index) => {
    if (consumedResultIndexes.has(index)) return;

    if (entry.kind === "tool_call" && entry.callId) {
      const resultIndex = entries.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.kind === "tool_result" && candidate.callId === entry.callId,
      );
      const result = resultIndex === -1 ? null : entries[resultIndex];
      if (resultIndex !== -1) consumedResultIndexes.add(resultIndex);
      items.push({ type: "toolCall", call: entry, result });
      return;
    }

    items.push({ type: "entry", entry });
  });

  return items;
}

export function sessionPairToView(call: SessionLogEntry, result: SessionLogEntry | null): ToolCallView {
  return {
    toolType: toolTypeLabel(call.title),
    description: deriveDescription(call.body),
    status: pairStatus(call, result),
    input: call.body ? { value: call.body, language: toBlockLanguage(call.language) } : null,
    output: result?.body ? { value: result.body, language: toBlockLanguage(result.language) } : null,
    defaultCollapsed: false,
  };
}

function toolTypeLabel(title: string): string {
  if (title === "exec_command" || title === "shell") return "Bash";
  return humanize(title);
}

function deriveDescription(body: string | null): string | null {
  if (!body) return null;
  const decoded = decodeCommand(body);
  const firstLine = decoded
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

function decodeCommand(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.cmd === "string") return parsed.cmd;
  } catch {
    // body is not JSON; use as-is
  }
  return body;
}

function pairStatus(call: SessionLogEntry, result: SessionLogEntry | null): ToolCallView["status"] {
  if (result?.status === "failed") return "failed";
  if (result) return "completed";
  if (call.status === "failed") return "failed";
  return "running";
}

function toBlockLanguage(language: SessionLogEntryLanguage): ToolBlockLanguage {
  if (language === "bash" || language === "json" || language === "diff" || language === "markdown") return language;
  return "text";
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
