export type SessionLogEntryKind =
  | "assistant"
  | "user"
  | "system"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "event"
  | "meta"
  | "message";

export type SessionLogEntryStatus = "running" | "completed" | "failed";

export type SessionLogEntryLanguage = "markdown" | "bash" | "json" | "diff" | "text";

export interface SessionLogEntry {
  kind: SessionLogEntryKind;
  title: string;
  body: string | null;
  language: SessionLogEntryLanguage;
  status: SessionLogEntryStatus | null;
  collapsed: boolean;
}

export function normalizeSessionLogEntry(value: unknown): SessionLogEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const title = record.title;

  if (typeof kind !== "string" || typeof title !== "string") return null;

  return {
    kind: kind as SessionLogEntryKind,
    title,
    body: typeof record.body === "string" ? record.body : null,
    language: normalizeLanguage(record.language),
    status: normalizeStatus(record.status),
    collapsed: record.collapsed === true,
  };
}

function normalizeLanguage(value: unknown): SessionLogEntryLanguage {
  if (value === "markdown" || value === "bash" || value === "json" || value === "diff" || value === "text") {
    return value;
  }
  return "text";
}

function normalizeStatus(value: unknown): SessionLogEntryStatus | null {
  if (value === "running" || value === "completed" || value === "failed") return value;
  return null;
}

export function payloadEntries(payload: unknown): SessionLogEntry[] {
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  const entries = record.entries ?? record.lines;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => (typeof entry === "string" ? legacyEntry(entry) : normalizeSessionLogEntry(entry)))
    .filter((entry): entry is SessionLogEntry => entry !== null);
}

function legacyEntry(line: string): SessionLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const splitIndex = trimmed.indexOf(": ");
  if (splitIndex === -1) {
    return {
      kind: "event",
      title: trimmed,
      body: null,
      language: "text",
      status: null,
      collapsed: false,
    };
  }

  const title = trimmed.slice(0, splitIndex);
  const body = trimmed.slice(splitIndex + 2);
  const kind = title.includes("/") ? "assistant" : title.includes("output") ? "tool_result" : "event";

  return {
    kind,
    title,
    body,
    language: "text",
    status: null,
    collapsed: body.length > 280,
  };
}
