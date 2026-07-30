import type { ThreadMessageLike } from "@assistant-ui/react-native";

import type {
  AssistantMessage,
  AssistantToolCall,
  SessionTimelineState,
} from "./session-reducer";

type ComposerMessage = {
  content?: readonly unknown[];
};

type AssistantUiMessagePart = Exclude<
  ThreadMessageLike["content"],
  string
>[number];

export function buildAssistantUiMessages(
  timeline: SessionTimelineState,
): ThreadMessageLike[] {
  // Tool results are transport records, not chat messages. They are already
  // attached to the assistant turn that produced them, where the UI can group
  // and disclose them as an activity summary. Rendering those records as a
  // second assistant message is what produced the noisy "Custom Tool Call
  // Output" transcript for orchestrated sessions.
  const history = compactActivityMessages(
    timeline.messages.filter(isVisibleChatMessage).map(historyMessage),
  );
  if (!timeline.streamingText && timeline.activeTools.length === 0)
    return history;

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

function isVisibleChatMessage(message: AssistantMessage): boolean {
  if (message.role === "tool") return false;
  // Provider bridges sometimes persist their transport envelopes as an
  // assistant message and sometimes as a system message. Neither is
  // conversation: the useful tool information is already rendered from the
  // tool call attached to the real assistant turn. Filter these regardless of
  // role so an orchestrator transcript cannot regress into a RPC console.
  if (isProtocolEnvelope(message.content)) return false;

  // A number of provider events are persisted as a placeholder message after
  // their payload has been folded into the real assistant turn. Keeping an
  // empty placeholder makes the timeline feel like a sparse RPC log, even
  // though it carries no information an operator can act on.
  if (!message.content.trim() && message.toolCalls.length === 0) return false;

  if (message.role !== "system") return true;

  // The initial provider prompt is durable implementation context, but showing
  // it to an operator makes every execution chat begin with a huge opaque
  // block. The task card and the first user message already expose the useful
  // intent, so keep the mobile transcript focused on the actual exchange.
  return !isInitialProviderPrompt(message.content);
}

function isProtocolEnvelope(content: string): boolean {
  const title = protocolTitle(content);
  return [
    "custom tool call output",
    "tool call output",
    "function call output",
    "agent message",
    "agent message streaming",
    "agent message content streaming",
    "agent message delta",
    "tool result",
    "tool result output",
    "command output streaming",
    "file change output streaming",
  ].some((envelope) => title === envelope || title.startsWith(`${envelope} `));
}

function isInitialProviderPrompt(content: string): boolean {
  const title = protocolTitle(content);
  return (
    title === "initial prompt" ||
    title.startsWith("initial prompt ") ||
    title === "provider prompt" ||
    title.startsWith("provider prompt ")
  );
}

function protocolTitle(content: string): string {
  // Some bridges use a blank line after the event title and others write
  // `Title: payload` on one line. Normalize both forms so internal provider
  // envelopes never leak back into the product transcript after a reconnect.
  return (content.split(/\r?\n|:/, 1)[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_:-]+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
}

export function messageText(message: ComposerMessage): string {
  return (message.content ?? [])
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? [part.text]
        : [],
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
  const role =
    message.role === "user" || message.role === "system"
      ? message.role
      : "assistant";
  const content = [
    ...(message.content
      ? [
          {
            type: "text" as const,
            text:
              role === "assistant"
                ? readableAssistantText(message.content)
                : message.content,
          },
        ]
      : []),
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

  return role === "assistant"
    ? { ...base, status: { type: "complete", reason: "stop" } }
    : base;
}

/**
 * Some app-server providers send distinct progress paragraphs through the
 * same transcript turn without their leading whitespace.  Keep source code
 * and inline Markdown intact, but make a clearly missing sentence boundary
 * readable in the mobile presentation.  The durable transcript remains
 * untouched and future executions also get the separator at ingestion time.
 */
function readableAssistantText(content: string): string {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/([.!?…][”"')\]]?)(?=[A-ZÀ-ÖØ-Þ])/g, "$1\n\n"),
    )
    .join("");
}

/**
 * A few provider transcripts emit every command as an empty assistant message.
 * assistant-ui can only make one disclosure group per message, so leaving that
 * shape intact produces a long stack of one-command cards. Merge adjacent
 * tool-only records without crossing real prose, user input, or system notices;
 * the expanded state still exposes every command and its result.
 */
function compactActivityMessages(
  messages: ThreadMessageLike[],
): ThreadMessageLike[] {
  return messages.reduce<ThreadMessageLike[]>((compact, message) => {
    const previous = compact.at(-1);
    if (
      previous &&
      isToolOnlyAssistant(previous) &&
      isToolOnlyAssistant(message)
    ) {
      compact[compact.length - 1] = {
        ...previous,
        content: [...messageParts(previous), ...messageParts(message)],
        createdAt: message.createdAt,
      };
    } else {
      compact.push(message);
    }
    return compact;
  }, []);
}

function isToolOnlyAssistant(message: ThreadMessageLike): boolean {
  const content = messageParts(message);
  return (
    message.role === "assistant" &&
    content.length > 0 &&
    content.every((part) => isRecord(part) && part.type === "tool-call")
  );
}

function messageParts(
  message: ThreadMessageLike,
): readonly AssistantUiMessagePart[] {
  return Array.isArray(message.content)
    ? (message.content as readonly AssistantUiMessagePart[])
    : [];
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
