import type { ToolBlockLanguage, ToolCallView } from "@/components/shared/ToolCallBlock";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";
import {
  enrichCursorToolPresentation,
  formatToolOutput,
  resolveToolDisplayName,
} from "@/lib/toolCallDisplay";
import type { ToolPresentation } from "@/lib/toolCallPresentation";
import { classifyToolName, type ToolGroupKind, type ToolGroupStatus } from "@/lib/toolCallGroups";
import type { SessionLogEntry, SessionLogEntryLanguage } from "@/types/session-log";

export type SessionLogRenderItem =
  | { type: "entry"; entry: SessionLogEntry }
  | { type: "toolCall"; call: SessionLogEntry; result: SessionLogEntry | null };

export interface SessionToolPair {
  call: SessionLogEntry;
  result: SessionLogEntry | null;
}

export type SessionLogGroupedItem =
  | { type: "entry"; entry: SessionLogEntry }
  | { type: "toolCall"; call: SessionLogEntry; result: SessionLogEntry | null }
  | { type: "toolGroup"; kind: ToolGroupKind; status: ToolGroupStatus; pairs: SessionToolPair[] }
  | { type: "eventGroup"; entries: SessionLogEntry[] };

type PendingGroup =
  | { type: "tool"; kind: ToolGroupKind; pairs: SessionToolPair[] }
  | { type: "event"; entries: SessionLogEntry[] };

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

/**
 * Collapses the paired session-log stream into a transcript-friendly shape,
 * grouping runs of consecutive same-kind tool calls and runs of consecutive
 * `event` entries (mirroring the assistant chat). A lone tool call, event, or
 * message stays standalone; a group is only emitted for two or more consecutive
 * items of the same kind.
 */
export function groupSessionLogItems(entries: SessionLogEntry[]): SessionLogGroupedItem[] {
  const items = pairSessionLogItems(entries);
  const grouped: SessionLogGroupedItem[] = [];
  let pending: PendingGroup | null = null;

  const flush = () => {
    if (!pending) return;

    if (pending.type === "tool") {
      if (pending.pairs.length === 1) {
        const [pair] = pending.pairs;
        grouped.push({ type: "toolCall", call: pair.call, result: pair.result });
      } else {
        grouped.push({
          type: "toolGroup",
          kind: pending.kind,
          status: sessionGroupStatus(pending.pairs),
          pairs: pending.pairs,
        });
      }
    } else if (pending.entries.length === 1) {
      grouped.push({ type: "entry", entry: pending.entries[0] });
    } else {
      grouped.push({ type: "eventGroup", entries: pending.entries });
    }

    pending = null;
  };

  for (const item of items) {
    if (item.type === "toolCall") {
      const kind = classifyToolName(item.call.title);
      if (pending?.type === "tool" && pending.kind === kind) {
        pending.pairs.push({ call: item.call, result: item.result });
        continue;
      }
      flush();
      pending = { type: "tool", kind, pairs: [{ call: item.call, result: item.result }] };
      continue;
    }

    if (item.entry.kind === "event") {
      if (pending?.type === "event") {
        pending.entries.push(item.entry);
        continue;
      }
      flush();
      pending = { type: "event", entries: [item.entry] };
      continue;
    }

    flush();
    grouped.push(item);
  }

  flush();
  return grouped;
}

export function sessionGroupStatus(pairs: SessionToolPair[]): ToolGroupStatus {
  const statuses = pairs.map((pair) => pairStatus(pair.call, pair.result));
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.some((status) => status === "failed")) return "error";
  return "complete";
}

export function sessionPairToTyped(pair: SessionToolPair): {
  view: ToolCallView;
  presentation: ToolPresentation;
} {
  const view = sessionPairToView(pair.call, pair.result);
  const args = parseBodyArgs(pair.call.body);
  const name = pair.call.title || "unknown";
  const presentation = canonicalizeToolCall({
    name,
    arguments: args,
    output: pair.result?.body ?? null,
    status: sessionPairPresentationStatus(pair.call, pair.result),
  });
  return { view, presentation };
}

export function sessionPairToView(call: SessionLogEntry, result: SessionLogEntry | null): ToolCallView {
  const outputBody = result?.body ? formatToolOutput(result.body) : null;
  const parsedArgs = parseJsonBody(call.body);
  const presentation = enrichCursorToolPresentation(call.title, parsedArgs ?? call.body);
  const useCursorCard = presentation.kind !== "other";

  return {
    toolType: useCursorCard
      ? presentation.toolType
      : toolTypeLabel(call.title, call.body, outputBody),
    description: useCursorCard ? presentation.description : deriveDescription(call.body),
    status: pairStatus(call, result),
    input: presentation.detailMarkdown
      ? { value: presentation.detailMarkdown, language: "markdown" }
      : call.body
        ? { value: call.body, language: toBlockLanguage(call.language) }
        : null,
    output: outputBody ? { value: outputBody, language: toBlockLanguage(result?.language ?? "text") } : null,
    defaultCollapsed: false,
    kbPath: presentation.kbPath,
    kind: presentation.kind,
  };
}

function parseBodyArgs(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // body is not JSON
  }
  return {};
}

function sessionPairPresentationStatus(
  call: SessionLogEntry,
  result: SessionLogEntry | null,
): string | null {
  if (result) {
    return result.status === "failed" ? "failed" : "completed";
  }
  if (call.status === "running") return "running";
  return "completed";
}

function parseJsonBody(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function toolTypeLabel(title: string, input: string | null, output: string | null): string {
  if (title === "exec_command" || title === "shell") return "Bash";
  return resolveToolDisplayName(title, input, output);
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

