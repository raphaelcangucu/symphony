import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Channel } from "phoenix";
import { AudioLines, Bot, Clock, FileText, ImageIcon, SendHorizontal, Target, X } from "lucide-react";
import type { TFunction } from "i18next";
import { i18n } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssistantComposer, type AssistantComposerSubmit } from "@/components/assistant/AssistantComposer";
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { BtwOverlay, type BtwStatus } from "@/components/assistant/BtwOverlay";
import { WorkingIndicator } from "@/components/assistant/WorkingIndicator";
import { AttachmentFileChip } from "@/components/shared/AttachmentFileChip";
import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { normalizeAssistantDocumentHref } from "@/services/threadDocuments";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  catalogFor,
  defaultComposerSettings,
  fallbackCatalogBundle,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import {
  fetchAssistantCatalogBundle,
  type AssistantChatMessage,
  type AssistantToolCall,
  type UserQuestion,
  type UserQuestionsRequest,
} from "@/services/assistant";
import { UserQuestionsCard } from "@/components/assistant/UserQuestionsCard";
import {
  assistantExploreTopic,
  assistantIssueTopic,
  assistantThreadTopic,
  assistantTopic,
  bindAssistantEvents,
  dispatchCodingAgent,
  submitUserInput,
  type AssistantDocumentChangedPayload,
  type AssistantIssueCreatedPayload,
} from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { isVideoAttachmentSource, isVideoMediaType, projectAttachmentUrl } from "@/services/attachments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { AgentKind } from "@/types/issue";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";

export type IssueAssistantMode = "triage" | "simple" | "complex";

export interface DraftIssueCreated {
  identifier: string;
}

export type ProjectAssistantMode = "project" | "explore" | "freeform";

interface ProjectAssistantPanelProps {
  projectSlug?: string;
  threadId?: number;
  issueIdentifier?: string;
  view: WorkspaceView;
  assistantMode?: ProjectAssistantMode;
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
  onEffectiveAgentResolved?: (agent: AgentKind) => void;
  onComposerAgentResolved?: (agent: AgentKind) => void;
  onOpenDocumentPath?: (path: string) => void;
  composerSeedMessage?: string | null;
}

const STREAMING_ASSISTANT_ID = "assistant-streaming";

interface QueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
}

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
  assistantMode,
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
  onEffectiveAgentResolved,
  onComposerAgentResolved,
  onOpenDocumentPath,
  composerSeedMessage = null,
}: ProjectAssistantPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runningStartedAt, setRunningStartedAt] = useState<number | null>(null);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [btw, setBtw] = useState<{ id: string | null; question: string; answer: string; status: BtwStatus } | null>(
    null,
  );
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  // Tab-scoped Authoring goal: a Codex goal running directly in this chat (no orchestrator).
  // It is independent from the issue's Execution goal owned by the Execution tab.
  const [authoringGoal, setAuthoringGoal] = useState<{ active: boolean; objective: string | null }>({
    active: false,
    objective: null,
  });
  const [pendingQuestions, setPendingQuestions] = useState<UserQuestionsRequest | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AssistantCatalogBundle | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const channelRef = useRef<Channel | null>(null);
  const bundleRef = useRef<AssistantCatalogBundle | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastConfirmedIssueModeRef = useRef<IssueAssistantMode | null>(null);
  const pendingIssueModeRef = useRef<{ mode: IssueAssistantMode; requestId: number } | null>(null);
  const lastConfirmedGoalModeRef = useRef<boolean | null>(null);
  const pendingGoalModeRef = useRef<{ enabled: boolean; requestId: number } | null>(null);
  const lastDispatchRequestRef = useRef(0);
  // The composer owns agent selection; mirror it here so dispatch + the parent
  // panel can follow the live choice. A ref keeps the dispatch effect stable.
  const composerAgentRef = useRef<AgentKind | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const isPageMode = mode === "page";
  const isEmbeddedMode = mode === "embedded";
  const isPanelMode = isPageMode || isEmbeddedMode;
  const isFullPageProjectAssistant = isPageMode && Boolean(projectSlug) && !issueIdentifier;
  const active = isPanelMode || open;
  const resolvedAssistantMode: ProjectAssistantMode =
    assistantMode ?? (projectSlug ? (issueIdentifier ? "project" : "project") : "freeform");
  const isExploreMode = resolvedAssistantMode === "explore";

  bundleRef.current = bundle;

  useEffect(() => {
    setRunningStartedAt((current) => {
      if (isRunning) return current ?? Date.now();
      return null;
    });
  }, [isRunning]);

  useEffect(() => {
    if (!active) return;

    if (!projectSlug) {
      setBundle(fallbackCatalogBundle());
      setCatalogError(null);
      return;
    }

    let cancelled = false;
    setBundle(null);
    setCatalogError(null);

    void fetchAssistantCatalogBundle(projectSlug)
      .then((nextBundle) => {
        if (!cancelled) {
          setBundle(nextBundle);
          setCatalogError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setCatalogError(cause instanceof Error ? cause.message : t("assistant.panel.catalogLoadFailed"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, projectSlug]);

  useEffect(() => {
    if (!active) return;
    if (threadId == null && !projectSlug) {
      setConnectionError(t("assistant.panel.noConnectionTarget"));
      return;
    }

    setChannelReady(false);
    lastConfirmedIssueModeRef.current = null;
    pendingIssueModeRef.current = null;
    lastConfirmedGoalModeRef.current = null;
    pendingGoalModeRef.current = null;
    setAuthoringGoal({ active: false, objective: null });

    const socket = createTrackerSocket();
    socket.connect();

    const topic =
      threadId != null
        ? assistantThreadTopic(threadId)
        : issueIdentifier
          ? assistantIssueTopic(projectSlug ?? "", issueIdentifier)
          : isExploreMode
            ? assistantExploreTopic(projectSlug ?? "")
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
        setPendingQuestions(null);
        const createdIssue = draftIssueCreatedFromMessage(message);
        if (createdIssue) onDraftIssueCreated?.(createdIssue);
      },
      onAssistantError: (message) => {
        setMessages((current) => appendMessage(current, assistantMessage("assistant-error", message)));
        setConnectionError(message);
        setIsRunning(false);
        setPendingQuestions(null);
      },
      onUserInputRequired: (request) => setPendingQuestions(request),
      onAssistantDocumentChanged: onDocumentChanged,
      onAssistantIssueCreated: onIssueCreated,
      onSteerFailed: ({ message }) => {
        if (!message) return;
        const activeBundle = bundleRef.current ?? fallbackCatalogBundle();
        const activeCatalog = catalogFor(activeBundle, activeBundle.defaultAgent);
        setQueued((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            payload: {
              kind: "message",
              message,
              agent: activeBundle.defaultAgent,
              settings: defaultComposerSettings(activeCatalog),
              attachments: [],
            },
          },
        ]);
      },
      onBtwDelta: ({ btwId, delta }) =>
        setBtw((current) =>
          current && (current.id === btwId || current.id === null)
            ? { ...current, id: btwId, answer: current.answer + delta }
            : current,
        ),
      onBtwCompleted: ({ btwId, message }) =>
        setBtw((current) => (current && current.id === btwId ? { ...current, answer: message, status: "complete" } : current)),
      onBtwError: ({ btwId, message }) =>
        setBtw((current) => (current && current.id === btwId ? { ...current, answer: message, status: "error" } : current)),
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
        setAuthoringGoal({
          active: hydratedGoalMode,
          objective: hydratedGoalMode ? goalObjectiveFromResponse(response) : null,
        });
      }

      const agent = effectiveAgentFromResponse(response);
      if (agent) onEffectiveAgentResolved?.(agent);
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
  }, [active, isExploreMode, issueIdentifier, onDocumentChanged, onDraftIssueCreated, onEffectiveAgentResolved, onIssueCreated, onIssueGoalModeChanged, onIssueModeChanged, projectSlug, threadId]);

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
      onIssueModeError?.(t("assistant.panel.modeUpdateTimeout"));
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
      onIssueGoalModeError?.(t("assistant.panel.goalModeUpdateTimeout"));
    });
  }, [active, channelReady, issueIdentifier, issueGoalMode, issueGoalModeRequestId, onIssueGoalModeChanged, onIssueGoalModeError]);

  useEffect(() => {
    if (!active || !channelReady || !issueIdentifier) return;
    if (dispatchRequestId <= 0 || dispatchRequestId === lastDispatchRequestRef.current) return;

    const channel = channelRef.current;
    if (!channel) return;

    lastDispatchRequestRef.current = dispatchRequestId;
    // Follow the composer's live agent choice; when unset the server still
    // resolves task > project > user at dispatch.
    const agent = composerAgentRef.current;
    const agentName = agentDisplayName(agent);
    const pushResult = dispatchCodingAgent(channel, { goalMode: issueGoalMode === true, agent });
    pushResult.receive("ok", (response) => {
      onDispatchSucceeded?.(messageFromResponse(response) ?? t("assistant.panel.dispatchedTo", { agent: agentName }));
    });
    pushResult.receive("error", (reason) => {
      onDispatchError?.(errorMessage(reason));
    });
    pushResult.receive("timeout", () => {
      onDispatchError?.(t("assistant.panel.dispatchTimeout", { agent: agentName }));
    });
  }, [active, channelReady, issueIdentifier, dispatchRequestId, issueGoalMode, onDispatchSucceeded, onDispatchError]);

  const dispatchSend = useCallback(
    (submit: AssistantComposerSubmit) => {
      const trimmed = submit.message.trim();
      const hasAttachments = submit.attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError(t("assistant.panel.channelNotConnected"));
        return;
      }

      const payload = {
        message: trimmed || fallbackAttachmentMessage(submit.attachments, t),
        context: {
          view,
          agent: submit.agent,
          model: submit.settings.model,
          effort: submit.settings.effort,
        },
        attachments: submit.attachments,
      };

      setConnectionError(null);
      setIsRunning(true);
      channel.push("send_message", payload).receive("error", (reason) => {
        setConnectionError(errorMessage(reason));
        setIsRunning(false);
      });
    },
    [view, t],
  );

  const steerTurn = useCallback((submit: AssistantComposerSubmit) => {
    const channel = channelRef.current;
    const text = submit.message.trim();
    if (!channel || !text) return;
    channel.push("steer_turn", { message: text });
  }, []);

  const enableGoalCommand = useCallback(
    (submit: AssistantComposerSubmit) => {
      const channel = channelRef.current;
      if (!channel) {
        setConnectionError(t("assistant.panel.channelNotConnected"));
        return;
      }

      if (!issueIdentifier) {
        setMessages((current) =>
          appendMessage(current, assistantMessage(`goal-help-${crypto.randomUUID()}`, t("assistant.panel.goalRequiresIssue"))),
        );
        return;
      }

      const objective = submit.message.trim();

      // Authoring goal: persist the chat goal + objective so this turn (and the next ones) run
      // Codex native goal mode directly in the conversation. This never dispatches the orchestrator
      // and never changes the issue's status or Execution goal.
      const goalPush = channel.push("set_goal_mode", {
        goal_mode: true,
        ...(objective.length > 0 ? { objective } : {}),
      });
      goalPush.receive("ok", (response) => {
        const enabled = goalModeFromResponse(response) ?? true;
        lastConfirmedGoalModeRef.current = enabled;
        onIssueGoalModeChanged?.(enabled);
        setAuthoringGoal({
          active: enabled,
          objective: goalObjectiveFromResponse(response) ?? (objective.length > 0 ? objective : null),
        });
      });
      goalPush.receive("error", (reason) => onIssueGoalModeError?.(errorMessage(reason, t)));
      goalPush.receive("timeout", () => onIssueGoalModeError?.(t("assistant.panel.goalModeUpdateTimeout")));

      const framed =
        objective.length > 0
          ? t("assistant.panel.goalCommandWithObjective", { objective })
          : t("assistant.panel.goalCommandDefault");
      const framedSubmit: AssistantComposerSubmit = { ...submit, kind: "message", message: framed };

      if (isRunning) {
        setQueued((current) => [...current, { id: crypto.randomUUID(), payload: framedSubmit }]);
      } else {
        dispatchSend(framedSubmit);
      }
    },
    [dispatchSend, isRunning, issueIdentifier, onIssueGoalModeChanged, onIssueGoalModeError, t],
  );

  const sendMessage = useCallback(
    (submit: AssistantComposerSubmit) => {
      if (submit.kind === "goal") {
        enableGoalCommand(submit);
        return;
      }

      const trimmed = submit.message.trim();
      const hasAttachments = submit.attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      if (submit.kind === "infer") {
        if (isRunning) {
          steerTurn(submit);
        } else {
          dispatchSend({ ...submit, kind: "message" });
        }
        return;
      }

      if (submit.kind === "btw") {
        const channel = channelRef.current;
        const question = submit.message.trim();
        if (!channel || !question) return;

        setBtw({ id: null, question, answer: "", status: "streaming" });
        channel
          .push("btw", { message: question })
          .receive("ok", (response) => {
            const id = (response as { btw_id?: string }).btw_id ?? null;
            setBtw((current) => (current ? { ...current, id } : current));
          })
          .receive("error", () => {
            setBtw((current) =>
              current ? { ...current, status: "error", answer: t("assistant.panel.btwFailed") } : current,
            );
          });
        return;
      }

      if (isRunning) {
        setQueued((current) => [...current, { id: crypto.randomUUID(), payload: { ...submit, kind: "message" } }]);
        return;
      }

      dispatchSend(submit);
    },
    [dispatchSend, enableGoalCommand, isRunning, steerTurn, t],
  );

  const wasRunningRef = useRef(false);
  useEffect(() => {
    const justFinished = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    if (!justFinished || queued.length === 0) return;

    const [next, ...rest] = queued;
    setQueued(rest);
    dispatchSend(next.payload);
  }, [isRunning, queued, dispatchSend]);

  const forceSendQueued = useCallback(
    (id: string) => {
      const item = queued.find((entry) => entry.id === id);
      if (!item) return;

      setQueued((current) => current.filter((entry) => entry.id !== id));

      if (isRunning) {
        steerTurn(item.payload);
      } else {
        dispatchSend(item.payload);
      }
    },
    [queued, isRunning, steerTurn, dispatchSend],
  );

  const forceSendOldestQueued = useCallback(() => {
    const [oldest] = queued;
    if (oldest) forceSendQueued(oldest.id);
  }, [queued, forceSendQueued]);

  const handleComposerAgentChange = useCallback(
    (agent: AgentKind) => {
      composerAgentRef.current = agent;
      onComposerAgentResolved?.(agent);
    },
    [onComposerAgentResolved],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const firstPart = message.content[0];
      if (firstPart?.type !== "text") throw new Error(i18n.t("assistant.errors.textOnlyMessages"));
      const activeBundle = bundleRef.current;
      if (!activeBundle) return;

      const activeCatalog = catalogFor(activeBundle, activeBundle.defaultAgent);
      sendMessage({
        kind: "message",
        message: firstPart.text,
        agent: activeBundle.defaultAgent,
        settings: defaultComposerSettings(activeCatalog),
        attachments: [],
      });
    },
    [sendMessage],
  );

  const visibleMessages = useMemo(() => displayMessages(messages, t), [messages, t]);

  useEffect(() => {
    if (!isFullPageProjectAssistant) return;
    const dock = composerDockRef.current;
    if (!dock) return;

    const updateHeight = () => setComposerHeight(dock.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isFullPageProjectAssistant, bundle, catalogError]);

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
        <AssistantBubble
          key={message.id}
          message={message}
          projectSlug={projectSlug}
          onOpenDocumentPath={onOpenDocumentPath}
        />
      ))}
      {connectionError ? <p className="text-sm text-destructive">{connectionError}</p> : null}
      {isRunning && runningStartedAt != null ? (
        <WorkingIndicator startedAt={runningStartedAt} activeTool={activeTool} />
      ) : null}
    </>
  );

  const queuedChips =
    queued.length > 0 ? (
      <div className="flex flex-col gap-1.5 px-4 pb-2">
        {queued.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.payload.message.trim()}</span>
            <button
              type="button"
              aria-label={t("assistant.panel.sendQueuedNow")}
              title={t("assistant.panel.sendNow")}
              onClick={() => forceSendQueued(item.id)}
              className="rounded p-0.5 hover:text-foreground"
            >
              <SendHorizontal className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={t("assistant.panel.removeQueued")}
              title={t("assistant.panel.remove")}
              onClick={() => setQueued((current) => current.filter((entry) => entry.id !== item.id))}
              className="rounded p-0.5 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    ) : null;

  const submitQuestions = useCallback(
    (requestId: string | number, answers: Record<string, string>) => {
      const channel = channelRef.current;
      if (!channel) return;
      submitUserInput(channel, requestId, answers);
      setPendingQuestions(null);
    },
    [],
  );

  const questionsNode = pendingQuestions ? (
    <div className="px-4 pb-2">
      <UserQuestionsCard request={pendingQuestions} onSubmit={submitQuestions} disabled={!channelReady} />
    </div>
  ) : null;

  const composerNode =
    bundle || catalogError ? (
      <AssistantComposer
        projectSlug={projectSlug ?? ""}
        bundle={bundle ?? fallbackCatalogBundle()}
        disabled={isRunning}
        floating={isFullPageProjectAssistant}
        hasQueued={queued.length > 0}
        seedMessage={composerSeedMessage}
        onForceQueued={forceSendOldestQueued}
        onSubmit={sendMessage}
        onAgentChange={handleComposerAgentChange}
        dropTargetRef={panelRef}
      />
    ) : null;

  const authoringGoalBanner =
    issueIdentifier && authoringGoal.active ? (
      <AuthoringGoalBanner objective={authoringGoal.objective} running={isRunning} />
    ) : null;

  if (isPanelMode) {
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <section
          ref={panelRef}
          className={cn(
            "relative flex flex-col",
            isPageMode && (isFullPageProjectAssistant ? "h-[calc(100vh-4rem)]" : "h-full min-h-0"),
            isEmbeddedMode && "h-full min-h-0",
          )}
          aria-label={t("assistant.panel.ariaLabel")}
        >
          <div
            className={cn("border-b", isPageMode ? "px-6 py-3.5" : isEmbeddedMode ? "px-4 py-2" : "px-4 py-3")}
          >
            <h2 className={cn("font-semibold leading-tight", isEmbeddedMode ? "text-sm" : "text-base")}>
              {isExploreMode
                ? t("assistant.panel.exploreTitle")
                : projectSlug
                  ? t("assistant.panel.projectTitle")
                  : t("assistant.panel.freeformTitle")}
            </h2>
            {isEmbeddedMode ? null : (
              <p className="text-xs text-muted-foreground">
                {isExploreMode
                  ? t("assistant.panel.exploreDescription", { slug: projectSlug })
                  : projectSlug
                    ? t("assistant.panel.projectDescription", { slug: projectSlug })
                    : t("assistant.panel.freeformDescription")}
                {bundle
                  ? t("assistant.panel.modelsFrom", { command: catalogFor(bundle, bundle.defaultAgent).command })
                  : null}
              </p>
            )}
          </div>

          {authoringGoalBanner}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={cn(
                "flex w-full flex-col",
                isPageMode ? "mx-auto max-w-4xl gap-6 px-4 pt-8" : "gap-4 px-4 py-4",
              )}
              style={isFullPageProjectAssistant ? { paddingBottom: composerHeight + 16 } : undefined}
            >
              {messageItems}
            </div>
          </div>

          {isFullPageProjectAssistant ? (
            <div ref={composerDockRef} className="pointer-events-none absolute inset-x-0 bottom-0">
              <div className="pointer-events-none h-10 bg-gradient-to-t from-background to-transparent" />
              <div className="pointer-events-auto bg-background">
                <div className="mx-auto w-full max-w-4xl px-4 pb-2 pt-1">
                  {queuedChips}
                  {questionsNode}
                  {composerNode ?? (
                    <div className="rounded-2xl border bg-card px-4 py-6 text-sm text-muted-foreground shadow-lg">
                      {t("assistant.panel.loadingModels")}
                    </div>
                  )}
                  {catalogError ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : isPageMode ? (
            <div ref={composerDockRef} className="shrink-0 border-t bg-background">
              <div className="mx-auto w-full max-w-4xl px-4 py-2">
                {queuedChips}
                {questionsNode}
                {composerNode ?? (
                  <div className="rounded-2xl border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">
                    {t("assistant.panel.loadingModels")}
                  </div>
                )}
                {catalogError ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="shrink-0 bg-background">
              {queuedChips}
              {questionsNode}
              {composerNode ?? (
                <div className="border-t px-4 py-6 text-sm text-muted-foreground">{t("assistant.panel.loadingModels")}</div>
              )}
              {catalogError ? (
                <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
              ) : null}
            </div>
          )}
        </section>
        {btw ? (
          <BtwOverlay question={btw.question} answer={btw.answer} status={btw.status} onClose={() => setBtw(null)} />
        ) : null}
      </AssistantRuntimeProvider>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label={t("assistant.panel.openAria")}>
            <Bot className="h-4 w-4" />
            {t("assistant.panel.openButton")}
          </Button>
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-xl lg:max-w-2xl">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>
              {projectSlug ? t("assistant.panel.projectTitle") : t("assistant.panel.freeformTitle")}
            </SheetTitle>
            <SheetDescription>
              {projectSlug
                ? t("assistant.panel.projectDescription", { slug: projectSlug })
                : t("assistant.panel.freeformDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">{messageItems}</div>
            {queuedChips}
            {questionsNode}
            {composerNode ?? (
              <div className="border-t px-4 py-6 text-sm text-muted-foreground">{t("assistant.panel.loadingModels")}</div>
            )}
            {catalogError ? (
              <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
      {btw ? (
        <BtwOverlay question={btw.question} answer={btw.answer} status={btw.status} onClose={() => setBtw(null)} />
      ) : null}
    </AssistantRuntimeProvider>
  );
}

function AuthoringGoalBanner({ objective, running }: { objective: string | null; running: boolean }) {
  const { t } = useTranslation();
  const label = running
    ? t("assistant.authoring.goalRunning")
    : t("assistant.authoring.goalActive");
  const trimmed = objective?.trim();

  return (
    <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 pb-3 pt-3">
      <div
        role="status"
        aria-live="polite"
        aria-label={t("assistant.authoring.goalBannerAria")}
        title={trimmed || label}
        className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-50 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.9)]"
      >
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-violet-200">
            <Target className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{label}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-white/95">
          {trimmed || t("assistant.authoring.goalNoObjective")}
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  projectSlug,
  onOpenDocumentPath,
}: {
  message: AssistantChatMessage;
  projectSlug?: string;
  onOpenDocumentPath?: (path: string) => void;
}) {
  const isUser = message.role === "user";
  const attachments = Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];

  if (isUserQuestionsMessage(message)) {
    return <UserQuestionsReceipt message={message} />;
  }

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
              <AttachmentPreview
                key={`${message.id}-attachment-${index}`}
                attachment={attachment}
                isUser={isUser}
                projectSlug={projectSlug}
              />
            ))}
          </div>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        ) : (
          <AssistantMarkdown content={message.content} onOpenDocumentPath={onOpenDocumentPath} />
        )}
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function isUserQuestionsMessage(message: AssistantChatMessage): boolean {
  return message.metadata.kind === "user_questions";
}

function UserQuestionsReceipt({ message }: { message: AssistantChatMessage }) {
  const { t } = useTranslation();
  const rawQuestions = Array.isArray(message.metadata.questions)
    ? (message.metadata.questions as UserQuestion[])
    : [];
  const answers =
    message.metadata.answers && typeof message.metadata.answers === "object"
      ? (message.metadata.answers as Record<string, string>)
      : {};

  if (rawQuestions.length === 0) return null;

  return (
    <div className="flex w-full justify-start">
      <article className="w-full max-w-none rounded-2xl border bg-muted/30 p-3 text-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("assistant.panel.clarifyingQuestions")}
        </p>
        <dl className="space-y-2">
          {rawQuestions.map((question) => (
            <div key={question.id}>
              <dt className="font-medium">{question.question || question.header}</dt>
              <dd className="text-muted-foreground">{answers[question.id] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}

function AttachmentPreview({
  attachment,
  isUser,
  projectSlug,
}: {
  attachment: unknown;
  isUser: boolean;
  projectSlug?: string;
}) {
  const { t } = useTranslation();
  if (!attachment || typeof attachment !== "object") return null;

  const record = attachment as Record<string, unknown>;
  const type = record.type;
  const name = typeof record.name === "string" ? record.name : t("assistant.panel.attachmentLabel.default");
  const mediaType = typeof record.media_type === "string" ? record.media_type : "";
  const data = typeof record.data === "string" ? record.data : "";
  const path = typeof record.path === "string" ? record.path : "";

  if (type === "image" && (data || path)) {
    if (path && projectSlug?.trim()) {
      return (
        <AttachmentImage
          src={projectAttachmentUrl(projectSlug, path)}
          alt={name}
          className="max-h-40 max-w-full object-cover"
        />
      );
    }

    if (data) {
      const src = data.startsWith("data:") ? data : `data:${mediaType || "image/png"};base64,${data}`;
      return <AttachmentImage src={src} alt={name} className="max-h-40 max-w-full object-cover" />;
    }

    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("assistant.panel.attachmentLabel.image", { name })}</span>
      </span>
    );
  }

  if (type === "file" && path) {
    if (projectSlug?.trim()) {
      const src = projectAttachmentUrl(projectSlug, path);
      if (isVideoMediaType(mediaType) || isVideoAttachmentSource(name) || isVideoAttachmentSource(path)) {
        return (
          <figure className="max-w-full space-y-1">
            <AttachmentVideo src={src} label={name} className="max-h-40 max-w-full rounded-lg border object-contain" />
            <figcaption className="truncate text-[11px] text-muted-foreground">{name}</figcaption>
          </figure>
        );
      }

      return <AttachmentFileChip src={src} name={name} />;
    }

    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
          isUser ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50",
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{name}</span>
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
        <span className="truncate">{t("assistant.panel.attachmentLabel.audio", { name })}</span>
      </span>
    );
  }

  return null;
}

function AssistantMarkdown({
  content,
  onOpenDocumentPath,
}: {
  content: string;
  onOpenDocumentPath?: (path: string) => void;
}) {
  return (
    <Markdown
      className="max-w-none text-sm leading-7 text-inherit"
      linkRenderer={({ href, children }) => {
        const documentPath = normalizeAssistantDocumentHref(href);
        if (documentPath && onOpenDocumentPath) {
          return (
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              onClick={() => onOpenDocumentPath(documentPath)}
            >
              {children}
            </button>
          );
        }

        return undefined;
      }}
    >
      {content}
    </Markdown>
  );
}

function displayMessages(messages: AssistantChatMessage[], t: TFunction): AssistantChatMessage[] {
  if (messages.length > 0) return messages;

  return [assistantMessage("assistant-welcome", t("assistant.panel.welcome"))];
}

function fallbackAttachmentMessage(
  attachments: AssistantComposerSubmit["attachments"],
  t: TFunction,
): string {
  if (attachments.some((attachment) => attachment.type === "audio")) {
    return t("assistant.panel.attachmentFallback.audio");
  }
  if (attachments.some((attachment) => attachment.type === "image")) {
    return t("assistant.panel.attachmentFallback.image");
  }
  return t("assistant.panel.attachmentFallback.files");
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

function goalObjectiveFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).goal_objective;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function effectiveAgentFromResponse(response: unknown): AgentKind | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).effective_agent;
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  return null;
}

function agentDisplayName(agent: AgentKind | null): string {
  if (agent === "claude") return "Claude";
  if (agent === "cursor") return "Cursor";
  return "Codex";
}

function messageFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  return stringFromRecord(response as Record<string, unknown>, "message");
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function errorMessage(reason: unknown, t: TFunction = i18n.t.bind(i18n) as TFunction): string {
  if (reason && typeof reason === "object" && "reason" in reason && typeof reason.reason === "string") return reason.reason;
  if (reason instanceof Error) return reason.message;
  return t("assistant.panel.requestFailed");
}
