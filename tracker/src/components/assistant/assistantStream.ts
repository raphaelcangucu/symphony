import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

import { appendTextBlock, pushToolBlock } from "./contentBlocks";

export const STREAMING_ASSISTANT_ID = "assistant-streaming";

export function assistantMessage(id: string, content: string): AssistantChatMessage {
  return { id, role: "assistant", content, toolCalls: [], metadata: {} };
}

export function appendMessage(
  messages: AssistantChatMessage[],
  message: AssistantChatMessage,
): AssistantChatMessage[] {
  if (messages.some((current) => current.id === message.id)) return messages;
  return [...messages, message];
}

export function appendAssistantDelta(messages: AssistantChatMessage[], delta: string): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  if (!existing) {
    const streamingMessage = assistantMessage(STREAMING_ASSISTANT_ID, delta);
    return [...messages, { ...streamingMessage, contentBlocks: appendTextBlock(undefined, delta) }];
  }

  return messages.map((message) =>
    message.id === STREAMING_ASSISTANT_ID
      ? {
          ...message,
          content: `${message.content}${delta}`,
          contentBlocks: appendTextBlock(message.contentBlocks ?? appendTextBlock(undefined, message.content), delta),
        }
      : message,
  );
}

export function toolCallIdentity(call: AssistantToolCall): string {
  if (typeof call.id === "string" && call.id.trim() !== "") return `id:${call.id}`;
  return `name:${call.name}`;
}

export function upsertToolCall(calls: AssistantToolCall[], next: AssistantToolCall): AssistantToolCall[] {
  const key = toolCallIdentity(next);
  const index = calls.findIndex((current) => toolCallIdentity(current) === key);
  if (index === -1) return [...calls, next];
  return calls.map((current, position) => (position === index ? next : current));
}

export function updateStreamingToolCall(
  messages: AssistantChatMessage[],
  toolCall: AssistantToolCall,
): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  const target = existing ?? assistantMessage(STREAMING_ASSISTANT_ID, "");
  const toolCalls = upsertToolCall(target.toolCalls, toolCall);
  const nextTarget =
    typeof toolCall.id === "string" && toolCall.id.trim() !== ""
      ? { ...target, toolCalls, contentBlocks: pushToolBlock(target.contentBlocks, toolCall.id) }
      : { ...target, toolCalls };

  if (!existing) return [...messages, nextTarget];
  return messages.map((message) => (message.id === STREAMING_ASSISTANT_ID ? nextTarget : message));
}

export function replaceStreamingMessage(
  messages: AssistantChatMessage[],
  message: AssistantChatMessage,
): AssistantChatMessage[] {
  if (messages.some((current) => current.id === STREAMING_ASSISTANT_ID)) {
    return messages.map((current) => (current.id === STREAMING_ASSISTANT_ID ? message : current));
  }

  return appendMessage(messages, message);
}
