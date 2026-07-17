/**
 * Adapts orchestrator `SessionLogEntry[]` into the unified assistant chat feed
 * item model so execution transcripts can render through the same body as
 * interactive assistant history (`AssistantMessageList` / bubbles / tool cards).
 *
 * Agent tasks: keep calling `deriveAgentTasks(rawEntries)` (or the re-export
 * `deriveAgentTasksFromSessionLog` below) on the **raw** session-log stream.
 * Do not derive tasks from the adapted feed — pairing/grouping may collapse
 * tool_result rows that `deriveAgentTasks` still needs by `callId`.
 */

import {
  groupSessionLogItems,
  type SessionToolPair,
} from "@/components/issues/issue-detail/sessionToolCall";
import { deriveAgentTasks } from "@/lib/agentTasks";
import type {
  AssistantChatMessage,
  AssistantContentBlock,
  AssistantToolCall,
  AssistantToolStatus,
} from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type {
  SessionLogEntry,
  SessionLogEntryLanguage,
  SessionLogEntryStatus,
} from "@/types/session-log";

/** Disclosure kinds rendered via ActivityDisclosure in the unified feed. */
export type SessionLogFeedDisclosureKind = "reasoning" | "system" | "meta" | "event";

export interface SessionLogFeedDisclosureItem {
  type: "disclosure";
  id: string;
  kind: SessionLogFeedDisclosureKind;
  title: string;
  body: string | null;
  language: SessionLogEntryLanguage;
  collapsed: boolean;
  status: SessionLogEntryStatus | null;
}

export interface SessionLogFeedEventGroupEntry {
  id: string;
  title: string;
  body: string | null;
  language: SessionLogEntryLanguage;
  collapsed: boolean;
  status: SessionLogEntryStatus | null;
}

export interface SessionLogFeedEventGroupItem {
  type: "event_group";
  id: string;
  /** Collapsed "N eventos" group for the unified feed chrome. */
  entries: SessionLogFeedEventGroupEntry[];
}

export interface SessionLogFeedMessageItem {
  type: "message";
  id: string;
  message: AssistantChatMessage;
}

/**
 * Item model for the unified chat body.
 *
 * - `message` → `AssistantChatMessageBubble` (text + `toolCalls` → ToolActivityItem / typed cards)
 * - `disclosure` → ActivityDisclosure chrome (reasoning / system / meta / lone event)
 * - `event_group` → collapsed consecutive events ("N eventos")
 *
 * `AssistantMessageList` currently accepts `AssistantChatMessage[]` only; the next
 * wiring task should accept this union (or `messagesFromSessionLogFeed` for the
 * message subset) and render disclosure / event_group variants with the existing
 * ActivityDisclosure chrome — no parallel transcript stack.
 */
export type SessionLogFeedItem =
  | SessionLogFeedMessageItem
  | SessionLogFeedDisclosureItem
  | SessionLogFeedEventGroupItem;

const SHELL_TOOL_NAMES = new Set(["shell", "exec_command", "bash", "Bash", "Shell"]);

export function adaptSessionLogEntries(entries: SessionLogEntry[]): SessionLogFeedItem[] {
  if (!Array.isArray(entries)) {
    throw new TypeError("adaptSessionLogEntries: entries must be an array");
  }

  const grouped = groupSessionLogItems(entries);
  const items: SessionLogFeedItem[] = [];

  grouped.forEach((item, index) => {
    if (item.type === "toolGroup") {
      items.push(toolPairsToMessageItem(item.pairs, index));
      return;
    }

    if (item.type === "toolCall") {
      items.push(toolPairsToMessageItem([{ call: item.call, result: item.result }], index));
      return;
    }

    if (item.type === "eventGroup") {
      items.push(eventGroupToFeedItem(item.entries, index));
      return;
    }

    items.push(entryToFeedItem(item.entry, index));
  });

  return items;
}

/** Prefer this (or `deriveAgentTasks`) on raw entries — see module doc. */
export function deriveAgentTasksFromSessionLog(entries: SessionLogEntry[]): AgentTaskSnapshot | null {
  return deriveAgentTasks(entries);
}

/** Extracts chat messages from an adapted feed (ignores disclosure / event_group). */
export function messagesFromSessionLogFeed(items: SessionLogFeedItem[]): AssistantChatMessage[] {
  if (!Array.isArray(items)) {
    throw new TypeError("messagesFromSessionLogFeed: items must be an array");
  }

  return items
    .filter((item): item is SessionLogFeedMessageItem => item.type === "message")
    .map((item) => item.message);
}

function entryToFeedItem(entry: SessionLogEntry, index: number): SessionLogFeedItem {
  if (entry.kind === "assistant" || entry.kind === "user" || entry.kind === "message") {
    const message = chatMessageFromSessionEntry(entry, index);
    return { type: "message", id: message.id, message };
  }

  if (
    entry.kind === "reasoning" ||
    entry.kind === "system" ||
    entry.kind === "meta" ||
    entry.kind === "event"
  ) {
    return {
      type: "disclosure",
      id: stableId("disclosure", index, entry.kind, entry.callId ?? entry.title),
      kind: entry.kind,
      title: entry.title,
      body: entry.body,
      language: entry.language,
      collapsed: entry.collapsed,
      status: entry.status,
    };
  }

  // Unpaired tool_call (no callId) / tool_result leftovers — keep visible.
  return {
    type: "disclosure",
    id: stableId("disclosure", index, entry.kind, entry.callId ?? entry.title),
    kind: "event",
    title: entry.title,
    body: entry.body,
    language: entry.language,
    collapsed: entry.collapsed,
    status: entry.status,
  };
}

function eventGroupToFeedItem(entries: SessionLogEntry[], index: number): SessionLogFeedEventGroupItem {
  const mapped = entries.map((event, eventIndex) => ({
    id: stableId("event", index, eventIndex, event.callId ?? event.title),
    title: event.title,
    body: event.body,
    language: event.language,
    collapsed: event.collapsed,
    status: event.status,
  }));

  return {
    type: "event_group",
    id: stableId("event-group", index, mapped[0]?.title ?? "events", String(mapped.length)),
    entries: mapped,
  };
}

function toolPairsToMessageItem(pairs: SessionToolPair[], index: number): SessionLogFeedMessageItem {
  const toolCalls = pairs.map((pair) => sessionPairToAssistantToolCall(pair));
  const firstId = toolCalls[0]?.id ?? `tool-${index}`;
  const id = stableId("tool-message", index, firstId, String(toolCalls.length));

  const contentBlocks: AssistantContentBlock[] = toolCalls
    .map((call) => call.id)
    .filter((toolCallId): toolCallId is string => typeof toolCallId === "string" && toolCallId.length > 0)
    .map((toolCallId) => ({ type: "tool" as const, toolCallId }));

  const message: AssistantChatMessage = {
    id,
    role: "assistant",
    content: "",
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    toolCalls,
    metadata: { source: "session_log", feedKind: "tool_activity" },
  };

  return { type: "message", id, message };
}

function chatMessageFromSessionEntry(entry: SessionLogEntry, index: number): AssistantChatMessage {
  const role = entry.kind === "user" ? "user" : "assistant";
  return {
    id: stableId("message", index, entry.kind, entry.callId ?? entry.title),
    role,
    content: entry.body ?? "",
    toolCalls: [],
    metadata: {
      source: "session_log",
      feedKind: entry.kind,
      language: entry.language,
      title: entry.title,
    },
  };
}

function sessionPairToAssistantToolCall(pair: SessionToolPair): AssistantToolCall {
  const { call, result } = pair;
  return {
    id: call.callId,
    name: call.title || "unknown",
    status: mapToolStatus(call, result),
    arguments: parseToolArguments(call.body, call.title),
    output: result?.body ?? null,
    result: {},
  };
}

function mapToolStatus(call: SessionLogEntry, result: SessionLogEntry | null): AssistantToolStatus {
  if (result?.status === "failed") return "error";
  if (result) return "complete";
  if (call.status === "failed") return "error";
  if (call.status === "completed") return "complete";
  return "running";
}

function parseToolArguments(body: string | null, toolName: string): Record<string, unknown> | null {
  if (body == null) return null;
  if (body === "") return {};

  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON body — preserve so typed/shell cards still show input.
  }

  if (SHELL_TOOL_NAMES.has(toolName)) {
    return { cmd: body };
  }

  return { input: body };
}

function stableId(...parts: Array<string | number>): string {
  return ["session-log", ...parts.map((part) => String(part))].join(":");
}
