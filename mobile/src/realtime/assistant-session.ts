import { Socket } from "phoenix";

import type {
  AssistantMessage,
  AssistantMessageRole,
  AssistantToolCall,
  AssistantToolStatus,
  SessionTimelineAction,
} from "@/features/sessions/session-reducer";

export type AssistantPushLike = {
  receive(status: string, callback: (payload: unknown) => void): AssistantPushLike;
};

export type AssistantChannelLike = {
  on(event: string, callback: (payload: unknown) => void): unknown;
  join(): AssistantPushLike;
  leave(): unknown;
  push(event: string, payload: Record<string, unknown>): AssistantPushLike;
};

export type AssistantSocketLike = {
  connect(): void;
  disconnect(): void;
  channel(topic: string, params: Record<string, unknown>): AssistantChannelLike;
  onOpen(callback: () => void): unknown;
};

type CreateAssistantSessionOptions = {
  threadId: number;
  origin: string;
  token: string;
  locale?: string;
  seed?: string | null;
  socketFactory?: (endpoint: string, params: Record<string, string>) => AssistantSocketLike;
  onAction(action: SessionTimelineAction): void;
  onSeedAccepted?(): void;
};

export type AssistantSession = {
  connect(): void;
  disconnect(): void;
  sendMessage(message: string): Promise<void>;
};

export function assistantThreadTopic(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return `assistant:thread:${threadId}`;
}

export function createAssistantSession({
  threadId,
  origin,
  token,
  locale = "en",
  seed,
  socketFactory = createSocket,
  onAction,
  onSeedAccepted,
}: CreateAssistantSessionOptions): AssistantSession {
  const topic = assistantThreadTopic(threadId);
  let socket: AssistantSocketLike | null = null;
  let channel: AssistantChannelLike | null = null;
  let started = false;
  let joined = false;
  let seedDispatched = false;

  function connect() {
    if (started) return;
    started = true;
    socket = socketFactory(socketEndpoint(origin), { token, locale });
    const nextChannel = socket.channel(topic, {});
    channel = nextChannel;
    bindEvents(nextChannel, onAction);
    socket.onOpen(() => {
      if (!joined || !channel) return;
      onAction({ type: "connection_changed", state: "reconnecting" });
      channel.push("sync_history", {});
    });
    onAction({ type: "connection_changed", state: "connecting" });
    nextChannel
      .join()
      .receive("ok", () => {
        joined = true;
        onAction({ type: "connection_changed", state: "live" });
        if (!seedDispatched && seed?.trim()) {
          seedDispatched = true;
          pushMessage(nextChannel, seed.trim())
            .then(() => onSeedAccepted?.())
            .catch((error: unknown) => onAction({ type: "error", message: errorMessage(error) }));
        }
      })
      .receive("error", (reason) => {
        onAction({ type: "connection_changed", state: "offline" });
        onAction({ type: "error", message: receiveError(reason, "Could not join session") });
      })
      .receive("timeout", () => {
        onAction({ type: "connection_changed", state: "offline" });
        onAction({ type: "error", message: "Session connection timed out" });
      });
    socket.connect();
  }

  function disconnect() {
    if (!started) return;
    started = false;
    joined = false;
    channel?.leave();
    socket?.disconnect();
    channel = null;
    socket = null;
  }

  function sendMessage(message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized) return Promise.reject(new Error("Message is required"));
    if (!channel || !joined) {
      return Promise.reject(new Error("Session is not connected"));
    }
    return pushMessage(channel, normalized);
  }

  return { connect, disconnect, sendMessage };
}

function bindEvents(
  channel: AssistantChannelLike,
  onAction: (action: SessionTimelineAction) => void,
) {
  channel.on("history_loaded", (payload) => {
    onAction({ type: "history_loaded", messages: readMessages(payload) });
  });
  channel.on("history_synced", (payload) => {
    onAction({ type: "history_synced", messages: readMessages(payload) });
  });
  channel.on("message_created", (payload) => {
    const message = readMessageField(payload);
    if (message) onAction({ type: "message_created", message });
  });
  channel.on("assistant_delta", (payload) => {
    const delta = readStringField(payload, "delta");
    if (delta) onAction({ type: "assistant_delta", delta });
  });
  channel.on("tool_call_started", (payload) => {
    const toolCall = readToolField(payload);
    if (toolCall) onAction({ type: "tool_call_started", toolCall });
  });
  channel.on("tool_call_completed", (payload) => {
    const toolCall = readToolField(payload);
    if (toolCall) onAction({ type: "tool_call_completed", toolCall });
  });
  channel.on("assistant_completed", (payload) => {
    const message = readMessageField(payload);
    if (message) onAction({ type: "assistant_completed", message });
  });
  channel.on("assistant_error", (payload) => {
    onAction({
      type: "error",
      message: readStringField(payload, "message") ?? "Assistant request failed",
    });
  });
}

function pushMessage(channel: AssistantChannelLike, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    channel
      .push("send_message", { message })
      .receive("ok", () => resolve())
      .receive("error", (reason) =>
        reject(new Error(receiveError(reason, "Could not send message"))),
      )
      .receive("timeout", () => reject(new Error("Message send timed out")));
  });
}

function readMessages(payload: unknown): AssistantMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return [];
  return payload.messages.flatMap((item) => {
    const message = normalizeMessage(item);
    return message ? [message] : [];
  });
}

function readMessageField(payload: unknown): AssistantMessage | null {
  return isRecord(payload) ? normalizeMessage(payload.message) : null;
}

function normalizeMessage(value: unknown): AssistantMessage | null {
  if (!isRecord(value)) return null;
  const role = readRole(value.role);
  const content = typeof value.content === "string" ? value.content : "";
  const sequence = typeof value.sequence === "number" ? value.sequence : null;
  const insertedAt = typeof value.inserted_at === "string" ? value.inserted_at : null;
  const rawId = value.id;
  const id =
    typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : `${role}:${sequence ?? insertedAt ?? content}`;
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls.flatMap((item) => {
        const tool = normalizeTool(item);
        return tool ? [tool] : [];
      })
    : [];
  return { id, role, content, toolCalls, insertedAt };
}

function readToolField(payload: unknown): AssistantToolCall | null {
  return isRecord(payload) ? normalizeTool(payload.tool_call) : null;
}

function normalizeTool(value: unknown): AssistantToolCall | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const rawId = value.id ?? value.call_id ?? value.tool_use_id ?? name;
  return {
    id: String(rawId),
    name,
    status: readToolStatus(value.status),
    output: typeof value.output === "string" ? value.output : null,
  };
}

function readRole(value: unknown): AssistantMessageRole {
  return value === "assistant" || value === "tool" || value === "system" ? value : "user";
}

function readToolStatus(value: unknown): AssistantToolStatus {
  return value === "complete" || value === "completed"
    ? "complete"
    : value === "error" || value === "failed"
      ? "error"
      : "running";
}

function readStringField(payload: unknown, key: string): string | null {
  if (!isRecord(payload)) return null;
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function receiveError(payload: unknown, fallback: string): string {
  return readStringField(payload, "reason") ?? readStringField(payload, "message") ?? fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Assistant request failed";
}

function socketEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/socket`;
}

function createSocket(endpoint: string, params: Record<string, string>): AssistantSocketLike {
  return new Socket(endpoint, { params }) as unknown as AssistantSocketLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
