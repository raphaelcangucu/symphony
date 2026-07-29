import type { ThreadMessageLike } from "@assistant-ui/react-native";

import type { AssistantMessage, AssistantToolCall, SessionTimelineState } from "./session-reducer";

type ComposerMessage = {
  content?: readonly unknown[];
};

export function buildAssistantUiMessages(timeline: SessionTimelineState): ThreadMessageLike[] {
  const history = timeline.messages.map(historyMessage);
  if (!timeline.streamingText && timeline.activeTools.length === 0) return history;

  const turnIsRunning = isTurnRunning(timeline.turnStatus?.status);

  return [
    ...history,
    {
      id: "dev10x-streaming-message",
      role: "assistant",
      content: [
        ...(timeline.streamingText
          ? [{ type: "text" as const, text: timeline.streamingText }]
          : []),
        ...timeline.activeTools.map((tool) => toolPart(tool)),
      ],
      createdAt: new Date(),
      status: turnIsRunning
        ? { type: "running" }
        : { type: "complete", reason: "stop" },
      metadata: { custom: { source: "symphony-rpc" } },
    },
  ];
}

export function messageText(message: ComposerMessage): string {
  return (message.content ?? [])
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("")
    .trim();
}

export async function submitAssistantUiMessage(
  message: ComposerMessage,
  onSend: (message: string) => Promise<void>,
): Promise<void> {
  const text = messageText(message);
  if (!text) throw new Error("Message is required");
  await onSend(text);
}

function historyMessage(message: AssistantMessage): ThreadMessageLike {
  const role = message.role === "user" || message.role === "system" ? message.role : "assistant";
  const content = [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    // History is durable. A provider can legitimately omit command output for
    // a successful call, which must still render as Done rather than Running.
    ...message.toolCalls.map((tool) => toolPart(tool, true)),
  ];
  const base = {
    id: message.id,
    role,
    content,
    createdAt: parsedDate(message.insertedAt),
    metadata: { custom: { source: "symphony-history" } },
  } satisfies ThreadMessageLike;

  return role === "assistant" ? { ...base, status: { type: "complete", reason: "stop" } } : base;
}

function toolPart(tool: AssistantToolCall, durable = false) {
  const terminal = durable || tool.status !== "running";
  return {
    type: "tool-call" as const,
    toolCallId: tool.id,
    toolName: tool.name,
    args: {},
    // assistant-ui uses the presence of `result` to distinguish a running
    // tool from a completed one. Preserve that distinction even when the host
    // has no printable output for the completed call.
    ...(terminal ? { result: tool.output ?? "" } : {}),
    ...(tool.status === "error" ? { isError: true } : {}),
  };
}

function isTurnRunning(status: string | undefined): boolean {
  return status === undefined || status === "running" || status === "queued";
}

function parsedDate(value: string | null): Date {
  if (!value) return new Date(0);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
