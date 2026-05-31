import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Channel } from "phoenix";
import { AudioLines, Bot, ImageIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AssistantComposer, type AssistantComposerSubmit } from "@/components/assistant/AssistantComposer";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  defaultComposerSettings,
  fallbackCodexCatalog,
  type AssistantCodexCatalog,
} from "@/lib/assistantSettings";
import {
  fetchAssistantCodexCatalog,
  type AssistantChatMessage,
  type AssistantToolCall,
} from "@/services/assistant";
import { assistantTopic, bindAssistantEvents } from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";

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
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AssistantCodexCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const catalogRef = useRef<AssistantCodexCatalog | null>(null);
  const active = mode === "page" || open;

  catalogRef.current = catalog;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);

    void fetchAssistantCodexCatalog(projectSlug)
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
          setCatalogError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setCatalogError(cause instanceof Error ? cause.message : "Failed to load Codex CLI models.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, projectSlug]);

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

  const sendMessage = useCallback(
    ({ message, settings, attachments }: AssistantComposerSubmit) => {
      const trimmed = message.trim();
      const hasAttachments = attachments.length > 0;
      if ((!trimmed && !hasAttachments) || isRunning) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError("Assistant channel is not connected yet.");
        return;
      }

      const payload = {
        message: trimmed || fallbackAttachmentMessage(attachments),
        context: {
          view,
          agent: "codex",
          model: settings.model,
          effort: settings.effort,
        },
        attachments,
      };

      setConnectionError(null);
      setIsRunning(true);
      channel.push("send_message", payload).receive("error", (reason) => {
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
      const activeCatalog = catalogRef.current;
      if (!activeCatalog) return;

      sendMessage({
        message: firstPart.text,
        settings: defaultComposerSettings(activeCatalog),
        attachments: [],
      });
    },
    [sendMessage],
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
        {catalog || catalogError ? (
          <AssistantComposer
            projectSlug={projectSlug}
            catalog={catalog ?? fallbackCodexCatalog()}
            disabled={isRunning}
            onSubmit={sendMessage}
          />
        ) : (
          <div className="border-t px-4 py-6 text-sm text-muted-foreground">Loading Codex CLI models...</div>
        )}
        {catalogError ? (
          <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
        ) : null}
      </div>
    </AssistantRuntimeProvider>
  );

  if (mode === "page") {
    return (
      <section className="flex h-[calc(100vh-4rem)] flex-col" aria-label="Project assistant">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Project assistant</h2>
          <p className="text-sm text-muted-foreground">
            Codex CLI assistant for `{projectSlug}`.
            {catalog ? ` Models from \`${catalog.command}\`.` : null}
          </p>
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
          <SheetDescription>Codex CLI assistant for `{projectSlug}`.</SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}

function AssistantBubble({ message }: { message: AssistantChatMessage }) {
  const isUser = message.role === "user";
  const attachments = Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <article
        className={cn(
          "w-fit max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-sm",
          isUser
            ? "bg-slate-950 text-white dark:bg-primary dark:text-primary-foreground"
            : "border bg-card text-card-foreground",
        )}
      >
        {attachments.length > 0 ? (
          <div className={cn("mb-3 flex flex-wrap gap-2", isUser && "justify-end")}>
            {attachments.map((attachment, index) => (
              <AttachmentPreview key={`${message.id}-attachment-${index}`} attachment={attachment} isUser={isUser} />
            ))}
          </div>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        ) : (
          <Markdown className="max-w-none text-sm leading-6 text-inherit">{message.content}</Markdown>
        )}
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallSummary key={`${toolCall.name}-${index}`} toolCall={toolCall} />
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function AttachmentPreview({ attachment, isUser }: { attachment: unknown; isUser: boolean }) {
  if (!attachment || typeof attachment !== "object") return null;

  const record = attachment as Record<string, unknown>;
  const type = record.type;
  const name = typeof record.name === "string" ? record.name : "attachment";
  const mediaType = typeof record.media_type === "string" ? record.media_type : "";
  const data = typeof record.data === "string" ? record.data : "";
  const path = typeof record.path === "string" ? record.path : "";

  if (type === "image" && (data || path)) {
    if (data) {
      const src = data.startsWith("data:") ? data : `data:${mediaType || "image/png"};base64,${data}`;
      return <img src={src} alt={name} className="max-h-40 max-w-full rounded-lg border object-cover" />;
    }

    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Image: {name}</span>
      </span>
    );
  }

  if (type === "audio") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <AudioLines className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Audio: {name}</span>
      </span>
    );
  }

  return null;
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

function fallbackAttachmentMessage(attachments: AssistantComposerSubmit["attachments"]): string {
  if (attachments.some((attachment) => attachment.type === "audio")) return "See the attached audio.";
  if (attachments.some((attachment) => attachment.type === "image")) return "See the attached image.";
  return "See the attached files.";
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
