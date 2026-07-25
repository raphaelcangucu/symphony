import { Socket } from "phoenix";

import type {
  AssistantMessage,
  AssistantMessageRole,
  AssistantApprovalRequest,
  AssistantQuestion,
  AssistantTurnStatus,
  AssistantUserInputRequest,
  AssistantToolCall,
  AssistantToolStatus,
  SessionTimelineAction,
} from "@/features/sessions/session-reducer";
import { diagnosticLog, type DiagnosticLog } from "@/diagnostics/diagnostic-log";

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
  onClose(callback: () => void): unknown;
  onError(callback: () => void): unknown;
};

export type CreateAssistantSessionOptions = {
  threadId: number;
  origin: string;
  token: string;
  locale?: string;
  seed?: string | null;
  socketFactory?: (endpoint: string, params: Record<string, string>) => AssistantSocketLike;
  diagnostics?: DiagnosticLog;
  onAction(action: SessionTimelineAction): void;
  onSeedAccepted?(): void;
};

export type AssistantSession = {
  connect(): void;
  disconnect(): void;
  sendMessage(message: string): Promise<void>;
  retrySeed(): Promise<void>;
  submitApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void>;
  submitUserInput(requestId: string | number, answers: Record<string, string>): Promise<void>;
  stopTurn(): Promise<void>;
  resumeTurn(): Promise<void>;
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
  diagnostics = diagnosticLog,
  onAction,
  onSeedAccepted,
}: CreateAssistantSessionOptions): AssistantSession {
  const topic = assistantThreadTopic(threadId);
  let socket: AssistantSocketLike | null = null;
  let channel: AssistantChannelLike | null = null;
  let started = false;
  let joined = false;
  let seedState: "idle" | "sending" | "uncertain" | "accepted" = "idle";
  let seedReconcile: ((messages: AssistantMessage[]) => void) | null = null;
  let seedRetryPromise: Promise<void> | null = null;
  const seedMessageId = `mobile-seed-${threadId}`;
  const recordSocket = (event: string, details: Record<string, unknown> = {}) =>
    diagnostics.record(
      {
        scope: "socket",
        event: `assistant socket ${event}`,
        details: { topic, ...details },
      },
      [token],
    );

  function acceptSeed() {
    if (seedState === "accepted") return;
    seedState = "accepted";
    onSeedAccepted?.();
  }

  function sendSeed(): Promise<void> {
    const normalized = seed?.trim();
    if (!normalized || seedState === "accepted") return Promise.resolve();
    if (seedState === "sending") return Promise.reject(new Error("First message is sending"));
    if (!channel || !joined) return Promise.reject(new Error("Session is not connected"));
    seedState = "sending";
    return pushMessage(channel, normalized, seedMessageId).then(
      () => {
        acceptSeed();
      },
      (error: unknown) => {
        seedState = "uncertain";
        throw error;
      },
    );
  }

  function connect() {
    if (started) return;
    started = true;
    recordSocket("connecting");
    socket = socketFactory(socketEndpoint(origin), { token, locale });
    const nextChannel = socket.channel(topic, {});
    channel = nextChannel;
    bindEvents(nextChannel, onAction, (messages) => {
      if (historyContainsSeed(messages, seed)) acceptSeed();
      seedReconcile?.(messages);
    });
    socket.onOpen(() => {
      recordSocket("open");
      onAction({ type: "connection_changed", state: "reconnecting" });
      if (joined && channel) channel.push("sync_history", {});
    });
    socket.onError(() => {
      recordSocket("error");
      joined = false;
      if (started) onAction({ type: "connection_changed", state: "reconnecting" });
    });
    socket.onClose(() => {
      recordSocket("closed");
      joined = false;
      if (started) onAction({ type: "connection_changed", state: "offline" });
    });
    onAction({ type: "connection_changed", state: "connecting" });
    nextChannel
      .join()
      .receive("ok", () => {
        joined = true;
        recordSocket("live");
        onAction({ type: "connection_changed", state: "live" });
        if (seed?.trim() && seedState === "idle") {
          sendSeed().catch((error: unknown) =>
            onAction({ type: "error", message: errorMessage(error) }),
          );
        }
      })
      .receive("error", (reason) => {
        recordSocket("join failed", { reason });
        onAction({ type: "connection_changed", state: "offline" });
        onAction({ type: "error", message: receiveError(reason, "Could not join session") });
      })
      .receive("timeout", () => {
        recordSocket("join timeout");
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
    recordSocket("disconnected");
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

  function retrySeed(): Promise<void> {
    if (seedRetryPromise) return seedRetryPromise;
    const operation =
      seedState === "uncertain"
        ? reconcileSeed()
        : seedState === "accepted"
          ? Promise.resolve()
          : sendSeed();
    seedRetryPromise = operation
      .catch((error: unknown) => {
        onAction({ type: "error", message: errorMessage(error) });
        throw error;
      })
      .finally(() => {
        seedRetryPromise = null;
      });
    return seedRetryPromise;
  }

  function pushCommand(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!channel || !joined) return Promise.reject(new Error("Session is not connected"));
    return pushWithAck(channel, event, payload);
  }

  function submitApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void> {
    return pushCommand("submit_approval", { request_id: requestId, action }).then(() => {
      onAction({ type: "approval_resolved", requestId });
    });
  }

  function submitUserInput(
    requestId: string | number,
    answers: Record<string, string>,
  ): Promise<void> {
    return pushCommand("submit_user_input", { request_id: requestId, answers }).then(() => {
      onAction({ type: "user_input_resolved", requestId });
    });
  }

  function stopTurn(): Promise<void> {
    return pushCommand("stop_turn", {});
  }

  function resumeTurn(): Promise<void> {
    return pushCommand("resume_turn", {});
  }

  function reconcileSeed(): Promise<void> {
    if (!channel || !joined) return Promise.reject(new Error("Session is not connected"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        seedReconcile = null;
        operation();
      };
      seedReconcile = (messages) => {
        if (historyContainsSeed(messages, seed)) {
          finish(resolve);
          return;
        }
        seedState = "idle";
        finish(() => {
          sendSeed().then(resolve, reject);
        });
      };
      channel
        ?.push("sync_history", {})
        .receive("error", (reason) =>
          finish(() => reject(new Error(receiveError(reason, "Could not verify first message")))),
        )
        .receive("timeout", () =>
          finish(() => reject(new Error("First message verification timed out"))),
        );
    });
  }

  return {
    connect,
    disconnect,
    retrySeed,
    resumeTurn,
    sendMessage,
    stopTurn,
    submitApproval,
    submitUserInput,
  };
}

function bindEvents(
  channel: AssistantChannelLike,
  onAction: (action: SessionTimelineAction) => void,
  onHistory: (messages: AssistantMessage[]) => void,
) {
  channel.on("history_loaded", (payload) => {
    const messages = readMessages(payload);
    onAction({ type: "history_loaded", messages });
    onHistory(messages);
  });
  channel.on("history_synced", (payload) => {
    const messages = readMessages(payload);
    onAction({ type: "history_synced", messages });
    onHistory(messages);
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
  channel.on("approval_required", (payload) => {
    const request = readApproval(payload);
    if (request) onAction({ type: "approval_required", request });
  });
  channel.on("user_input_required", (payload) => {
    const request = readUserInput(payload);
    if (request) onAction({ type: "user_input_required", request });
  });
  channel.on("turn_status", (payload) => {
    const status = readTurnStatus(payload);
    if (status) onAction({ type: "turn_status", status });
  });
}

function historyContainsSeed(messages: AssistantMessage[], seed: string | null | undefined) {
  const normalized = seed?.trim();
  return Boolean(
    normalized &&
    messages.some((message) => message.role === "user" && message.content.trim() === normalized),
  );
}

function pushMessage(
  channel: AssistantChannelLike,
  message: string,
  clientMessageId?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel
      .push("send_message", {
        message,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      })
      .receive("ok", () => resolve())
      .receive("error", (reason) =>
        reject(new Error(receiveError(reason, "Could not send message"))),
      )
      .receive("timeout", () => reject(new Error("Message send timed out")));
  });
}

function pushWithAck(
  channel: AssistantChannelLike,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel
      .push(event, payload)
      .receive("ok", () => resolve())
      .receive("error", (reason) =>
        reject(new Error(receiveError(reason, `Could not ${event.replaceAll("_", " ")}`))),
      )
      .receive("timeout", () => reject(new Error(`${event.replaceAll("_", " ")} timed out`)));
  });
}

function readApproval(payload: unknown): AssistantApprovalRequest | null {
  if (!isRecord(payload)) return null;
  const requestId = payload.request_id;
  if (typeof requestId !== "string" && typeof requestId !== "number") return null;
  return {
    requestId,
    command: nullableString(payload.command),
    cwd: nullableString(payload.cwd),
    reason: nullableString(payload.reason),
    toolName: nullableString(payload.tool_name),
    agent: nullableString(payload.agent),
  };
}

function readUserInput(payload: unknown): AssistantUserInputRequest | null {
  if (!isRecord(payload)) return null;
  const requestId = payload.request_id;
  if (typeof requestId !== "string" && typeof requestId !== "number") return null;
  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((question) => {
        const normalized = readQuestion(question);
        return normalized ? [normalized] : [];
      })
    : [];
  return { requestId, questions };
}

function readQuestion(value: unknown): AssistantQuestion | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return {
    id: value.id,
    header: nullableString(value.header) ?? "",
    question: nullableString(value.question) ?? "",
    isOther: value.isOther === true || value.is_other === true,
    isSecret: value.isSecret === true || value.is_secret === true,
    options: Array.isArray(value.options)
      ? value.options.flatMap((option) => {
          if (!isRecord(option) || typeof option.label !== "string") return [];
          const normalized: { label: string; description?: string } = {
            label: option.label,
          };
          if (typeof option.description === "string") {
            normalized.description = option.description;
          }
          return [normalized];
        })
      : null,
  };
}

function readTurnStatus(payload: unknown): AssistantTurnStatus | null {
  if (!isRecord(payload)) return null;
  return {
    status: nullableString(payload.status) ?? "unknown",
    canResume: payload.can_resume === true,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
