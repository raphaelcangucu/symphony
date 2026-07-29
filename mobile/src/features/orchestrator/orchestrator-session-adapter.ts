import type {
  AssistantMessage,
  AssistantToolCall,
  SessionTimelineState,
} from "@/features/sessions/session-reducer";

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

export type SessionLogEntry = {
  kind: SessionLogEntryKind;
  title: string;
  body: string | null;
  language: "markdown" | "bash" | "json" | "diff" | "text";
  status: "running" | "completed" | "failed" | null;
  collapsed: boolean;
  callId: string | null;
  steerId: string | null;
  steerState: "queued" | "accepted" | "failed" | null;
};

export function payloadSessionLogEntries(payload: unknown): SessionLogEntry[] {
  if (!isRecord(payload)) return [];
  const entries = payload.entries ?? payload.lines;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) =>
      typeof entry === "string"
        ? legacyEntry(entry)
        : normalizeSessionLogEntry(entry),
    )
    .filter((entry): entry is SessionLogEntry => entry !== null);
}

export function appendSessionLogEntries(
  current: SessionLogEntry[],
  payload: unknown,
): SessionLogEntry[] {
  const seen = new Set(current.map(entryKey));
  const appended = payloadSessionLogEntries(payload).filter((entry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...appended];
}

export function buildOrchestratorTimeline(
  entries: SessionLogEntry[],
  connectionState: SessionTimelineState["connectionState"],
  error: string | null = null,
  agentKind: string | null = null,
): SessionTimelineState {
  const queuedMessages = queuedSteerMessages(entries, agentKind);
  return {
    messages: messagesFromEntries(entries),
    streamingText: "",
    activeTools: [],
    connectionState,
    pendingApproval: null,
    pendingUserInput: null,
    turnStatus:
      queuedMessages.length > 0
        ? { status: "queued", canResume: false, queuedMessages }
        : null,
    turnPreferences: {
      executionMode: null,
      skillProfile: null,
      model: null,
      effort: null,
    },
    metadata: {
      projectSlug: null,
      agentKind: null,
      requestedModel: null,
      requestedEffort: null,
      resolvedModel: null,
      resolvedEffort: null,
    },
    goal: null,
    error,
  };
}

function messagesFromEntries(entries: SessionLogEntry[]): AssistantMessage[] {
  const pairedResults = new Set<number>();
  const messages: AssistantMessage[] = [];

  entries.forEach((entry, index) => {
    if (entry.kind === "tool_result" && pairedResults.has(index)) return;

    if (entry.kind === "tool_call") {
      const resultIndex = entry.callId
        ? entries.findIndex(
            (candidate, candidateIndex) =>
              candidateIndex > index &&
              candidate.kind === "tool_result" &&
              candidate.callId === entry.callId,
          )
        : -1;
      const result = resultIndex >= 0 ? entries[resultIndex] : undefined;
      if (resultIndex >= 0) pairedResults.add(resultIndex);
      const tool = toolCall(entry, result);
      messages.push(message(`tool:${tool.id}`, "assistant", "", [tool]));
      return;
    }

    if (entry.kind === "tool_result") {
      const tool = toolCall(entry);
      messages.push(
        message(`tool-result:${tool.id}:${index}`, "assistant", "", [tool]),
      );
      return;
    }

    if (entry.kind === "user") {
      if (entry.collapsed || entry.title === "Initial prompt") {
        const body = [entry.title, entry.body].filter(Boolean).join("\n\n");
        messages.push(message(`entry:${index}`, "system", body));
      } else {
        messages.push(
          message(`entry:${index}`, "user", entry.body ?? entry.title),
        );
      }
      return;
    }

    if (entry.kind === "assistant" || entry.kind === "message") {
      messages.push(
        message(`entry:${index}`, "assistant", entry.body ?? entry.title),
      );
      return;
    }

    const body = [entry.title, entry.body].filter(Boolean).join("\n\n");
    messages.push(
      message(
        `entry:${index}`,
        entry.kind === "system" ||
          entry.kind === "meta" ||
          entry.kind === "event" ||
          entry.kind === "reasoning"
          ? "system"
          : "assistant",
        body,
      ),
    );
  });

  return messages;
}

function toolCall(
  call: SessionLogEntry,
  result?: SessionLogEntry,
): AssistantToolCall {
  const failed = result?.status === "failed" || call.status === "failed";
  return {
    id: call.callId ?? `session-log-tool:${call.title}`,
    name: call.title || "tool",
    status: failed
      ? "error"
      : result || call.status === "completed"
        ? "complete"
        : "running",
    output: result?.body ?? (call.kind === "tool_result" ? call.body : null),
  };
}

function message(
  id: string,
  role: AssistantMessage["role"],
  content: string,
  toolCalls: AssistantToolCall[] = [],
): AssistantMessage {
  return {
    id: `orchestrator:${id}`,
    role,
    content,
    toolCalls,
    insertedAt: null,
  };
}

function normalizeSessionLogEntry(value: unknown): SessionLogEntry | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.title !== "string"
  ) {
    return null;
  }
  return {
    kind: value.kind as SessionLogEntryKind,
    title: value.title,
    body: typeof value.body === "string" ? value.body : null,
    language: normalizeLanguage(value.language),
    status: normalizeStatus(value.status),
    collapsed: value.collapsed === true,
    callId:
      typeof value.call_id === "string"
        ? value.call_id
        : typeof value.callId === "string"
          ? value.callId
          : null,
    steerId: typeof value.steer_id === "string" ? value.steer_id : null,
    steerState:
      value.steer_state === "queued" ||
      value.steer_state === "accepted" ||
      value.steer_state === "failed"
        ? value.steer_state
        : null,
  };
}

function legacyEntry(line: string): SessionLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const splitIndex = trimmed.indexOf(": ");
  return {
    kind: "event",
    title: splitIndex < 0 ? trimmed : trimmed.slice(0, splitIndex),
    body: splitIndex < 0 ? null : trimmed.slice(splitIndex + 2),
    language: "text",
    status: null,
    collapsed: false,
    callId: null,
    steerId: null,
    steerState: null,
  };
}

function queuedSteerMessages(
  entries: SessionLogEntry[],
  agentKind: string | null,
): NonNullable<SessionTimelineState["turnStatus"]>["queuedMessages"] {
  const queued = new Map<
    string,
    { id: string; message: string; provider: string | null; index: number }
  >();

  entries.forEach((entry, index) => {
    if (entry.steerState === "failed" && entry.steerId) {
      queued.delete(entry.steerId);
      return;
    }

    if (
      entry.kind === "user" &&
      entry.steerState === "queued" &&
      entry.steerId &&
      entry.body
    ) {
      queued.set(entry.steerId, {
        id: entry.steerId,
        message: entry.body,
        provider: supportedProvider(agentKind),
        index,
      });
      return;
    }

    if (
      (entry.kind === "assistant" || entry.kind === "message") &&
      queued.size > 0
    ) {
      for (const [id, queuedEntry] of queued) {
        if (queuedEntry.index < index) queued.delete(id);
      }
    }
  });

  return [...queued.values()].map(({ id, message, provider }) => ({
    id,
    message,
    provider,
  }));
}

function supportedProvider(value: string | null): string | null {
  return value === "codex" ||
    value === "claude" ||
    value === "cursor" ||
    value === "opencode"
    ? value
    : null;
}

function normalizeLanguage(value: unknown): SessionLogEntry["language"] {
  return value === "markdown" ||
    value === "bash" ||
    value === "json" ||
    value === "diff" ||
    value === "text"
    ? value
    : "text";
}

function normalizeStatus(value: unknown): SessionLogEntry["status"] {
  return value === "running" || value === "completed" || value === "failed"
    ? value
    : null;
}

function entryKey(entry: SessionLogEntry): string {
  return JSON.stringify(entry);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
