import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Channel } from "phoenix";
import { Bot, Send } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type AssistantChatMessage, type AssistantToolCall } from "@/services/assistant";
import { assistantTopic, bindAssistantEvents } from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

interface ProjectAssistantPanelProps {
  projectSlug: string;
  view: WorkspaceView;
  mode?: "sheet" | "page";
}

const STREAMING_ASSISTANT_ID = "assistant-streaming";

const convertMessage = (message: AssistantChatMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role === "user" ? "user" : "assistant",
  content: [{ type: "text", text: message.content }],
});

export function ProjectAssistantPanel({ projectSlug, view, mode = "sheet" }: ProjectAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const active = mode === "page" || open;

  useEffect(() => {
    if (!active) return;

    const socket = createTrackerSocket();
    socket.connect();

    const channel = socket.channel(assistantTopic(projectSlug));
    channelRef.current = channel;

    bindAssistantEvents(channel, {
      onHistoryLoaded: (history) => setMessages(history),
      onMessageCreated: (message) => setMessages((current) => appendMessage(current, message)),
      onAssistantDelta: (delta) => {
        setIsRunning(true);
        setMessages((current) => appendAssistantDelta(current, delta));
      },
      onToolCallStarted: (toolCall) => setMessages((current) => updateStreamingToolCall(current, toolCall)),
      onToolCallCompleted: (toolCall) => setMessages((current) => updateStreamingToolCall(current, toolCall)),
      onAssistantCompleted: (message) => {
        setMessages((current) => replaceStreamingMessage(current, message));
        setIsRunning(false);
      },
      onAssistantError: (message) => {
        setMessages((current) => appendMessage(current, assistantMessage("assistant-error", message)));
        setConnectionError(message);
        setIsRunning(false);
      },
    });

    channel.join().receive("error", (reason) => setConnectionError(errorMessage(reason)));

    return () => {
      channelRef.current = null;
      channel.leave();
      socket.disconnect();
    };
  }, [active, projectSlug]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isRunning) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError("Assistant channel is not connected yet.");
        return;
      }

      setConnectionError(null);
      setIsRunning(true);
      channel.push("send_message", { message: trimmed, context: { view } }).receive("error", (reason) => {
        setConnectionError(errorMessage(reason));
        setIsRunning(false);
      });
    },
    [isRunning, view],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const firstPart = message.content[0];
      if (firstPart?.type !== "text") throw new Error("Only text assistant messages are supported");
      sendText(firstPart.text);
    },
    [sendText],
  );

  const visibleMessages = displayMessages(messages);

  const runtime = useExternalStoreRuntime<AssistantChatMessage>(
    useMemo(
      () => ({
        isRunning,
        messages: visibleMessages,
        convertMessage,
        onNew,
      }),
      [isRunning, visibleMessages, onNew],
    ),
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextMessage = input;
    setInput("");
    void sendText(nextMessage);
  };

  const content = (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">
          {visibleMessages.map((message) => (
            <AssistantBubble key={message.id} message={message} />
          ))}
          {connectionError ? <p className="text-sm text-destructive">{connectionError}</p> : null}
          {isRunning ? <p className="text-sm text-muted-foreground">Assistant is working...</p> : null}
        </div>
        <form className="border-t p-4" onSubmit={handleSubmit}>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about this project or request tracker changes..."
            className="min-h-24 resize-none"
            disabled={isRunning}
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" size="sm" disabled={isRunning || input.trim() === ""} aria-label="Send assistant message">
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </form>
      </div>
    </AssistantRuntimeProvider>
  );

  if (mode === "page") {
    return (
      <section className="flex h-[calc(100vh-4rem)] flex-col" aria-label="Project assistant">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Project assistant</h2>
          <p className="text-sm text-muted-foreground">Chat with the tracker assistant for `{projectSlug}`.</p>
        </div>
        {content}
      </section>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Open project assistant">
          <Bot className="h-4 w-4" />
          Assistant
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-xl lg:max-w-2xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Project assistant</SheetTitle>
          <SheetDescription>Chat with the tracker assistant for `{projectSlug}`.</SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}

function AssistantBubble({ message }: { message: AssistantChatMessage }) {
  const isUser = message.role === "user";

  return (
    <article className={isUser ? "ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[90%] rounded-xl border bg-card px-3 py-2 text-sm"}>
      <p className="whitespace-pre-wrap leading-6">{message.content}</p>
      {message.toolCalls.length ? (
        <div className="mt-3 space-y-2 border-t pt-2">
          {message.toolCalls.map((toolCall, index) => (
            <ToolCallSummary key={`${toolCall.name}-${index}`} toolCall={toolCall} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ToolCallSummary({ toolCall }: { toolCall: AssistantToolCall }) {
  const issue = toolCall.result.issue;

  return (
    <div className="rounded-lg bg-muted/60 p-2 text-xs">
      <div className="font-mono font-semibold">{toolCall.name}</div>
      {issue ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono">{issue.identifier}</span>
          <span className="truncate">{issue.title}</span>
        </div>
      ) : null}
    </div>
  );
}

function displayMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  if (messages.length > 0) return messages;

  return [
    assistantMessage(
      "assistant-welcome",
      "Ask naturally about this project, or request tracker actions. I can chat, create tasks, comment on issues, move statuses, list issues, and request Codex work when you ask for it.",
    ),
  ];
}

function assistantMessage(id: string, content: string): AssistantChatMessage {
  return { id, role: "assistant", content, toolCalls: [], metadata: {} };
}

function appendMessage(messages: AssistantChatMessage[], message: AssistantChatMessage): AssistantChatMessage[] {
  if (messages.some((current) => current.id === message.id)) return messages;
  return [...messages, message];
}

function appendAssistantDelta(messages: AssistantChatMessage[], delta: string): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  if (!existing) return [...messages, assistantMessage(STREAMING_ASSISTANT_ID, delta)];

  return messages.map((message) =>
    message.id === STREAMING_ASSISTANT_ID ? { ...message, content: `${message.content}${delta}` } : message,
  );
}

function updateStreamingToolCall(messages: AssistantChatMessage[], toolCall: AssistantToolCall): AssistantChatMessage[] {
  const existing = messages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  const target = existing ?? assistantMessage(STREAMING_ASSISTANT_ID, "");
  const nextToolCalls = [...target.toolCalls.filter((current) => current.name !== toolCall.name), toolCall];
  const nextTarget = { ...target, toolCalls: nextToolCalls };

  if (!existing) return [...messages, nextTarget];
  return messages.map((message) => (message.id === STREAMING_ASSISTANT_ID ? nextTarget : message));
}

function replaceStreamingMessage(messages: AssistantChatMessage[], message: AssistantChatMessage): AssistantChatMessage[] {
  if (messages.some((current) => current.id === STREAMING_ASSISTANT_ID)) {
    return messages.map((current) => (current.id === STREAMING_ASSISTANT_ID ? message : current));
  }

  return appendMessage(messages, message);
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === "object" && "reason" in reason && typeof reason.reason === "string") return reason.reason;
  if (reason instanceof Error) return reason.message;
  return "Assistant request failed";
}
