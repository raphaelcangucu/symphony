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
import { WorkingIndicator } from "@/components/assistant/WorkingIndicator";
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
import {
  assistantIssueTopic,
  assistantThreadTopic,
  assistantTopic,
  bindAssistantEvents,
  type AssistantDocumentChangedPayload,
  type AssistantIssueCreatedPayload,
} from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";

export type IssueAssistantMode = "triage" | "simple" | "complex";

export interface DraftIssueCreated {
  identifier: string;
}

interface ProjectAssistantPanelProps {
  projectSlug?: string;
  threadId?: number;
  issueIdentifier?: string;
  view: WorkspaceView;
  mode?: "sheet" | "page" | "embedded";
  issueMode?: IssueAssistantMode;
  issueModeRequestId?: number;
  issueGoalMode?: boolean;
  issueGoalModeRequestId?: number;
  dispatchRequestId?: number;
  onDocumentChanged?: (payload: AssistantDocumentChangedPayload) => void;
  onDraftIssueCreated?: (issue: DraftIssueCreated) => void;
  onIssueCreated?: (issue: AssistantIssueCreatedPayload) => void;
  onIssueModeChanged?: (mode: IssueAssistantMode) => void;
  onIssueModeError?: (message: string) => void;
  onIssueGoalModeChanged?: (enabled: boolean) => void;
  onIssueGoalModeError?: (message: string) => void;
  onDispatchSucceeded?: (message: string) => void;
  onDispatchError?: (message: string) => void;
}

const STREAMING_ASSISTANT_ID = "assistant-streaming";

const convertMessage = (message: AssistantChatMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role === "user" ? "user" : "assistant",
  content: [{ type: "text", text: message.content }],
});

export function ProjectAssistantPanel({
  projectSlug,
  threadId,
  issueIdentifier,
  view,
  mode = "sheet",
  issueMode,
  issueModeRequestId = 0,
  issueGoalMode,
  issueGoalModeRequestId = 0,
  dispatchRequestId = 0,
  onDocumentChanged,
  onDraftIssueCreated,
  onIssueCreated,
  onIssueModeChanged,
  onIssueModeError,
  onIssueGoalModeChanged,
  onIssueGoalModeError,
  onDispatchSucceeded,
  onDispatchError,
}: ProjectAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runningStartedAt, setRunningStartedAt] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AssistantCodexCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const channelRef = useRef<Channel | null>(null);
  const catalogRef = useRef<AssistantCodexCatalog | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastConfirmedIssueModeRef = useRef<IssueAssistantMode | null>(null);
  const pendingIssueModeRef = useRef<{ mode: IssueAssistantMode; requestId: number } | null>(null);
  const lastConfirmedGoalModeRef = useRef<boolean | null>(null);
  const pendingGoalModeRef = useRef<{ enabled: boolean; requestId: number } | null>(null);
  const lastDispatchRequestRef = useRef(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const isPageMode = mode === "page";
  const isEmbeddedMode = mode === "embedded";
  const isPanelMode = isPageMode || isEmbeddedMode;
  const active = isPanelMode || open;

  catalogRef.current = catalog;

  useEffect(() => {
    setRunningStartedAt((current) => {
      if (isRunning) return current ?? Date.now();
      return null;
    });
  }, [isRunning]);

  useEffect(() => {
    if (!active) return;

    if (!projectSlug) {
      setCatalog(fallbackCodexCatalog());
      setCatalogError(null);
      return;
    }

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
    if (threadId == null && !projectSlug) {
      setConnectionError("Assistant has no thread or project to connect to.");
      return;
    }

    setChannelReady(false);
    lastConfirmedIssueModeRef.current = null;
    pendingIssueModeRef.current = null;
    lastConfirmedGoalModeRef.current = null;
    pendingGoalModeRef.current = null;

    const socket = createTrackerSocket();
    socket.connect();

    const topic =
      threadId != null
        ? assistantThreadTopic(threadId)
        : issueIdentifier
          ? assistantIssueTopic(projectSlug ?? "", issueIdentifier)
          : assistantTopic(projectSlug ?? "");
    const channel = socket.channel(topic);
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
        const createdIssue = draftIssueCreatedFromMessage(message);
        if (createdIssue) onDraftIssueCreated?.(createdIssue);
      },
      onAssistantError: (message) => {
        setMessages((current) => appendMessage(current, assistantMessage("assistant-error", message)));
        setConnectionError(message);
        setIsRunning(false);
      },
      onAssistantDocumentChanged: onDocumentChanged,
      onAssistantIssueCreated: onIssueCreated,
    });

    const joinPush = channel.join();
    joinPush.receive("ok", (response) => {
      setConnectionError(null);
      setChannelReady(true);

      const hydratedMode = modeFromResponse(response);
      if (issueIdentifier && hydratedMode && hydratedMode !== "triage") {
        lastConfirmedIssueModeRef.current = hydratedMode;
        onIssueModeChanged?.(hydratedMode);
      }

      if (issueIdentifier) {
        const hydratedGoalMode = goalModeFromResponse(response) ?? false;
        lastConfirmedGoalModeRef.current = hydratedGoalMode;
        if (hydratedGoalMode) onIssueGoalModeChanged?.(true);
      }
    });
    joinPush.receive("error", (reason) => {
      setConnectionError(errorMessage(reason));
      setChannelReady(false);
    });

    return () => {
      setChannelReady(false);
      channelRef.current = null;
      channel.leave();
      socket.disconnect();
    };
  }, [active, issueIdentifier, onDocumentChanged, onDraftIssueCreated, onIssueCreated, onIssueGoalModeChanged, onIssueModeChanged, projectSlug, threadId]);

  useEffect(() => {
    if (!active || !channelReady || !issueIdentifier || !isIssueAssistantMode(issueMode)) return;
    if (issueMode === "triage" || lastConfirmedIssueModeRef.current === issueMode) return;

    const requestId = issueModeRequestId;
    const pending = pendingIssueModeRef.current;
    if (pending?.mode === issueMode && pending.requestId === requestId) return;

    const channel = channelRef.current;
    if (!channel) return;

    pendingIssueModeRef.current = { mode: issueMode, requestId };
    const pushResult = channel.push("set_mode", { mode: issueMode });
    pushResult.receive("ok", (response) => {
      const mode = modeFromResponse(response) ?? issueMode;
      lastConfirmedIssueModeRef.current = mode;
      pendingIssueModeRef.current = null;
      onIssueModeChanged?.(mode);
    });
    pushResult.receive("error", (reason) => {
      pendingIssueModeRef.current = null;
      onIssueModeError?.(errorMessage(reason));
    });
    pushResult.receive("timeout", () => {
      pendingIssueModeRef.current = null;
      onIssueModeError?.("Assistant mode update timed out");
    });
  }, [active, channelReady, issueIdentifier, issueMode, issueModeRequestId, onIssueModeChanged, onIssueModeError]);

  useEffect(() => {
    if (!active || !channelReady || !issueIdentifier || typeof issueGoalMode !== "boolean") return;
    if (lastConfirmedGoalModeRef.current === issueGoalMode) return;

    const requestId = issueGoalModeRequestId;
    const pending = pendingGoalModeRef.current;
    if (pending?.enabled === issueGoalMode && pending.requestId === requestId) return;

    const channel = channelRef.current;
    if (!channel) return;

    pendingGoalModeRef.current = { enabled: issueGoalMode, requestId };
    const pushResult = channel.push("set_goal_mode", { goal_mode: issueGoalMode });
    pushResult.receive("ok", (response) => {
      const enabled = goalModeFromResponse(response) ?? issueGoalMode;
      lastConfirmedGoalModeRef.current = enabled;
      pendingGoalModeRef.current = null;
      onIssueGoalModeChanged?.(enabled);
    });
    pushResult.receive("error", (reason) => {
      pendingGoalModeRef.current = null;
      onIssueGoalModeError?.(errorMessage(reason));
    });
    pushResult.receive("timeout", () => {
      pendingGoalModeRef.current = null;
      onIssueGoalModeError?.("Assistant goal mode update timed out");
    });
  }, [active, channelReady, issueIdentifier, issueGoalMode, issueGoalModeRequestId, onIssueGoalModeChanged, onIssueGoalModeError]);

  useEffect(() => {
    if (!active || !channelReady || !issueIdentifier) return;
    if (dispatchRequestId <= 0 || dispatchRequestId === lastDispatchRequestRef.current) return;

    const channel = channelRef.current;
    if (!channel) return;

    lastDispatchRequestRef.current = dispatchRequestId;
    const pushResult = channel.push("dispatch_codex", { goal_mode: issueGoalMode === true });
    pushResult.receive("ok", (response) => {
      onDispatchSucceeded?.(messageFromResponse(response) ?? "Dispatched to Codex.");
    });
    pushResult.receive("error", (reason) => {
      onDispatchError?.(errorMessage(reason));
    });
    pushResult.receive("timeout", () => {
      onDispatchError?.("Codex dispatch timed out");
    });
  }, [active, channelReady, issueIdentifier, dispatchRequestId, issueGoalMode, onDispatchSucceeded, onDispatchError]);

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

  useEffect(() => {
    if (!isPageMode) return;
    const dock = composerDockRef.current;
    if (!dock) return;

    const updateHeight = () => setComposerHeight(dock.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isPageMode, catalog, catalogError]);

  useEffect(() => {
    if (!isPanelMode) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [isPanelMode, visibleMessages, isRunning]);

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

  const activeTool =
    messages
      .find((message) => message.id === STREAMING_ASSISTANT_ID)
      ?.toolCalls.find((toolCall) => toolCall.status === "running")?.name ?? null;

  const messageItems = (
    <>
      {visibleMessages.map((message) => (
        <AssistantBubble key={message.id} message={message} />
      ))}
      {connectionError ? <p className="text-sm text-destructive">{connectionError}</p> : null}
      {isRunning && runningStartedAt != null ? (
        <WorkingIndicator startedAt={runningStartedAt} activeTool={activeTool} />
      ) : null}
    </>
  );

  const composerNode =
    catalog || catalogError ? (
      <AssistantComposer
        projectSlug={projectSlug ?? ""}
        catalog={catalog ?? fallbackCodexCatalog()}
        disabled={isRunning}
        floating={isPageMode}
        onSubmit={sendMessage}
      />
    ) : null;

  if (isPanelMode) {
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <section
          className={cn(
            "relative flex flex-col",
            isPageMode && (projectSlug ? "h-[calc(100vh-4rem)]" : "h-screen"),
            isEmbeddedMode && "h-full min-h-0",
          )}
          aria-label="Project assistant"
        >
          <div
            className={cn("border-b", isPageMode ? "px-6 py-3.5" : isEmbeddedMode ? "px-4 py-2" : "px-4 py-3")}
          >
            <h2 className={cn("font-semibold leading-tight", isEmbeddedMode ? "text-sm" : "text-base")}>
              {projectSlug ? "Project assistant" : "Freeform assistant"}
            </h2>
            {isEmbeddedMode ? null : (
              <p className="text-xs text-muted-foreground">
                {projectSlug ? `Codex CLI assistant for \`${projectSlug}\`.` : "Codex CLI assistant for freeform chat."}
                {catalog ? ` Models from \`${catalog.command}\`.` : null}
              </p>
            )}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={cn(
                "flex w-full flex-col",
                isPageMode ? "mx-auto max-w-4xl gap-6 px-4 pt-8" : "gap-4 px-4 py-4",
              )}
              style={isPageMode ? { paddingBottom: composerHeight + 16 } : undefined}
            >
              {messageItems}
            </div>
          </div>

          {isPageMode ? (
            <div ref={composerDockRef} className="pointer-events-none absolute inset-x-0 bottom-0">
              <div className="pointer-events-none h-10 bg-gradient-to-t from-background to-transparent" />
              <div className="pointer-events-auto bg-background">
                <div className="mx-auto w-full max-w-4xl px-4 pb-2 pt-1">
                  {composerNode ?? (
                    <div className="rounded-2xl border bg-card px-4 py-6 text-sm text-muted-foreground shadow-lg">
                      Loading Codex CLI models...
                    </div>
                  )}
                  {catalogError ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="shrink-0 bg-background">
              {composerNode ?? (
                <div className="border-t px-4 py-6 text-sm text-muted-foreground">Loading Codex CLI models...</div>
              )}
              {catalogError ? (
                <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
              ) : null}
            </div>
          )}
        </section>
      </AssistantRuntimeProvider>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label="Open project assistant">
            <Bot className="h-4 w-4" />
            Assistant
          </Button>
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-xl lg:max-w-2xl">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{projectSlug ? "Project assistant" : "Freeform assistant"}</SheetTitle>
            <SheetDescription>
              {projectSlug ? `Codex CLI assistant for \`${projectSlug}\`.` : "Codex CLI assistant for freeform chat."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">{messageItems}</div>
            {composerNode ?? (
              <div className="border-t px-4 py-6 text-sm text-muted-foreground">Loading Codex CLI models...</div>
            )}
            {catalogError ? (
              <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </AssistantRuntimeProvider>
  );
}

function AssistantBubble({ message }: { message: AssistantChatMessage }) {
  const isUser = message.role === "user";
  const attachments = Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <article
        className={cn(
          "text-sm",
          isUser
            ? "w-fit max-w-[85%] rounded-3xl bg-slate-950 px-4 py-2.5 text-white shadow-sm dark:bg-primary dark:text-primary-foreground"
            : "w-full max-w-none text-foreground",
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
          <Markdown className="max-w-none text-sm leading-7 text-inherit">{message.content}</Markdown>
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

function draftIssueCreatedFromMessage(message: AssistantChatMessage): DraftIssueCreated | null {
  for (const toolCall of message.toolCalls) {
    if (toolCall.status !== "complete") continue;
    if (!isCreateDraftIssueToolCall(toolCall)) continue;

    const identifier =
      extractIssueIdentifier(toolCall.result.issue) ??
      extractIssueIdentifier(toolCall.result.data) ??
      extractIssueIdentifier(toolCall.result);
    if (identifier) return { identifier };
  }

  return null;
}

function isCreateDraftIssueToolCall(toolCall: AssistantToolCall): boolean {
  return toolCall.name === "create_draft_issue" || stringFromRecord(toolCall.result, "tool") === "create_draft_issue";
}

function extractIssueIdentifier(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const identifier =
    stringFromRecord(record, "identifier") ??
    stringFromRecord(record, "issueIdentifier") ??
    stringFromRecord(record, "issue_identifier");
  const normalized = identifier ? normalizeIssueIdentifier(identifier) : "";
  if (normalized) return normalized;

  return extractIssueIdentifier(record.issue) ?? extractIssueIdentifier(record.data);
}

function isIssueAssistantMode(value: unknown): value is IssueAssistantMode {
  return value === "triage" || value === "simple" || value === "complex";
}

function modeFromResponse(response: unknown): IssueAssistantMode | null {
  if (!response || typeof response !== "object") return null;
  const mode = stringFromRecord(response as Record<string, unknown>, "mode");
  return isIssueAssistantMode(mode) ? mode : null;
}

function goalModeFromResponse(response: unknown): boolean | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).goal_mode;
  return typeof value === "boolean" ? value : null;
}

function messageFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  return stringFromRecord(response as Record<string, unknown>, "message");
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === "object" && "reason" in reason && typeof reason.reason === "string") return reason.reason;
  if (reason instanceof Error) return reason.message;
  return "Assistant request failed";
}
