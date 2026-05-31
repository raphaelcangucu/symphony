import type { Channel } from "phoenix";

import {
  normalizeAssistantChatMessage,
  normalizeToolCall,
  type AssistantChatMessage,
  type AssistantToolCall,
  type BackendAssistantChatMessageDto,
} from "@/services/assistant";

export interface AssistantChannelHandlers {
  onHistoryLoaded: (messages: AssistantChatMessage[]) => void;
  onMessageCreated: (message: AssistantChatMessage) => void;
  onAssistantDelta: (delta: string) => void;
  onToolCallStarted: (toolCall: AssistantToolCall) => void;
  onToolCallCompleted: (toolCall: AssistantToolCall) => void;
  onAssistantCompleted: (message: AssistantChatMessage) => void;
  onAssistantError: (message: string) => void;
  onAssistantDocumentChanged?: (payload: AssistantDocumentChangedPayload) => void;
}

export interface AssistantDocumentChangedPayload {
  identifier: string;
}

interface HistoryLoadedPayload {
  messages?: BackendAssistantChatMessageDto[] | null;
}

interface MessagePayload {
  message?: BackendAssistantChatMessageDto | null;
}

interface DeltaPayload {
  delta?: string | null;
}

interface ToolCallPayload {
  tool_call?: Parameters<typeof normalizeToolCall>[0] | null;
  toolCall?: Parameters<typeof normalizeToolCall>[0] | null;
}

interface ErrorPayload {
  message?: string | null;
}

interface DocumentChangedPayload {
  identifier?: string | null;
}

export function assistantTopic(projectSlug: string): string {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");
  return `assistant:${slug}`;
}

export function assistantThreadTopic(threadId: number | string): string {
  const id = String(threadId).trim();
  if (!id) throw new Error("threadId is required");
  return `assistant:thread:${id}`;
}

export function assistantIssueTopic(projectSlug: string, identifier: string): string {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");

  const issueIdentifier = identifier.trim();
  if (!issueIdentifier) throw new Error("identifier is required");

  return `assistant:issue:${encodeURIComponent(slug)}:${encodeURIComponent(issueIdentifier)}`;
}

export function bindAssistantEvents(channel: Channel, handlers: AssistantChannelHandlers): void {
  channel.on("history_loaded", (payload) => {
    const messages = ((payload as HistoryLoadedPayload).messages ?? []).map(normalizeAssistantChatMessage);
    handlers.onHistoryLoaded(messages);
  });

  channel.on("message_created", (payload) => {
    const message = (payload as MessagePayload).message;
    if (message) handlers.onMessageCreated(normalizeAssistantChatMessage(message));
  });

  channel.on("assistant_delta", (payload) => {
    const delta = (payload as DeltaPayload).delta;
    if (typeof delta === "string" && delta.length > 0) handlers.onAssistantDelta(delta);
  });

  channel.on("tool_call_started", (payload) => {
    const toolCall = (payload as ToolCallPayload).toolCall ?? (payload as ToolCallPayload).tool_call;
    if (toolCall) handlers.onToolCallStarted(normalizeToolCall(toolCall));
  });

  channel.on("tool_call_completed", (payload) => {
    const toolCall = (payload as ToolCallPayload).toolCall ?? (payload as ToolCallPayload).tool_call;
    if (toolCall) handlers.onToolCallCompleted(normalizeToolCall(toolCall));
  });

  channel.on("assistant_completed", (payload) => {
    const message = (payload as MessagePayload).message;
    if (message) handlers.onAssistantCompleted(normalizeAssistantChatMessage(message));
  });

  channel.on("assistant_error", (payload) => {
    handlers.onAssistantError((payload as ErrorPayload).message ?? "Assistant request failed");
  });

  channel.on("assistant_document_changed", (payload) => {
    const identifier = (payload as DocumentChangedPayload).identifier?.trim();
    if (!identifier) return;

    handlers.onAssistantDocumentChanged?.({ identifier });
  });
}
