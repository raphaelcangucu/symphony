import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Channel } from "phoenix";
import { Bot, BookOpen, ChevronDown, ListChecks, Sparkles } from "lucide-react";
import { i18n } from "@/i18n";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import {
  AssistantComposer,
  type AssistantComposerSubmit,
  type ComposerContextInsertRequest,
} from "@/components/assistant/AssistantComposer";
import type { AssistantChatPlanApprovalAction } from "@/components/assistant/AssistantChatMessageBubble";
import { AssistantMessageList } from "@/components/assistant/AssistantMessageList";
import { AssistantPanelHeader } from "@/components/assistant/AssistantPanelHeader";
import { CommandApprovalCard } from "@/components/assistant/CommandApprovalCard";
import { QueuedMessageChips } from "@/components/assistant/QueuedMessageChips";
import { assistantCommandsToSlashDefs } from "@/components/assistant/assistantCommandDefs";
import { type ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { useComposerMentions } from "@/hooks/useComposerMentions";
import { useContextMentionData } from "@/components/assistant/useContextMentionData";
import { defaultSkillCommands } from "@/components/assistant/slashCommands";
import {
  STREAMING_ASSISTANT_ID,
  appendAssistantDelta,
  appendMessage,
  assistantMessage,
  replaceStreamingMessage,
  updateStreamingToolCall,
} from "@/components/assistant/assistantStream";
import type { WorkingActiveToolDetail } from "@/components/assistant/WorkingIndicator";
import { useNowTick } from "@/hooks/useNowTick";
import { toast } from "sonner";
import { BtwOverlay, type BtwStatus } from "@/components/assistant/BtwOverlay";
import {
  AssistantTasksDock,
  AssistantTasksSheet,
  completedTaskCount,
  type AssistantTasksDockControl,
} from "@/components/agent-activity";
import { useIsLgUp } from "@/hooks/useMediaQuery";
import {
  attachChatScrollStickiness,
  setMessagesPreservingScroll,
} from "@/components/assistant/chatScrollStickiness";
import {
  authoringGoalPhase,
  emptyAuthoringGoal,
  mergeGoalStatus,
  type AuthoringGoalState,
} from "@/components/assistant/authoringGoalState";
import {
  agentDisplayName,
  displayMessages,
  draftIssueCreatedFromMessage,
  effectiveAgentFromResponse,
  errorMessage,
  extractKbDocumentReferencesFromMessage,
  fallbackAttachmentMessage,
  goalModeFromResponse,
  goalObjectiveFromResponse,
  goalRunElapsedFromResponse,
  goalRunningFromResponse,
  isTextEntryTarget,
  latestPendingPlanMessageId,
  messageFromResponse,
  normalizeAgentSeed,
  type DraftIssueCreated,
} from "@/components/assistant/assistantPanelHelpers";
import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { GoalPill } from "@/components/shared/GoalPill";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { deriveAgentTasksFromAssistantMessages } from "@/lib/agentTasks";
import { catalogFor, defaultComposerSettings, fallbackCatalogBundle, type AssistantCatalogBundle } from "@/lib/assistantSettings";
import { DEFAULT_EXECUTION_MODE } from "@/lib/executionMode";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import {
  fetchAssistantCatalogBundle,
  type AssistantChatMessage,
  type UserQuestionsRequest,
} from "@/services/assistant";
import { WorkspaceDiffStatsChip } from "@/components/sessions/WorkspaceDiffStatsChip";
import { useIssueChangedDocPaths } from "@/hooks/useIssueChangedDocPaths";
import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { UserQuestionsCard } from "@/components/assistant/UserQuestionsCard";
import {
  assistantExploreTopic,
  assistantIssueTopic,
  assistantKbTopic,
  assistantThreadTopic,
  assistantTopic,
  bindAssistantEvents,
  clearAuthoringGoal,
  dispatchCodingAgent,
  normalizeGoalStatus,
  pauseAuthoringGoal,
  readLastTurn,
  requestGoalStatus,
  requestHistorySync,
  resumeAuthoringGoal,
  resumeTurn,
  isTerminalTurnStatus,
  killTool,
  setAuthoringGoalObjective,
  stopTurn,
  submitApproval,
  submitUserInput,
  type AssistantActiveTool,
  type AssistantApprovalRequest,
  type AssistantDocumentChangedPayload,
  type AssistantTurnStatus,
  type AssistantIssueCreatedPayload,
} from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import type { AgentKind, ExecutionMode } from "@/types/issue";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { useAssistantCommands } from "@/hooks/useAssistantCommands";

export type { DraftIssueCreated } from "@/components/assistant/assistantPanelHelpers";

const STALE_ACTIVITY_MS = 120_000;

function hydrateStreamingActiveTools(
  messages: AssistantChatMessage[],
  tools: AssistantActiveTool[],
): AssistantChatMessage[] {
  return tools.reduce(
    (current, tool) =>
      updateStreamingToolCall(current, {
        id: tool.id,
        name: tool.name,
        status: "running",
        arguments: tool.argumentsSummary ? { command: tool.argumentsSummary } : null,
        result: {},
      }),
    messages,
  );
}

function activeToolDetailFromMessages(
  chatMessages: AssistantChatMessage[],
  turn: AssistantTurnStatus | null,
): WorkingActiveToolDetail | null {
  const streaming = chatMessages.find((message) => message.id === STREAMING_ASSISTANT_ID);
  const running = streaming?.toolCalls.find((toolCall) => toolCall.status === "running");
  if (running) {
    const summary =
      typeof running.arguments?.command === "string"
        ? running.arguments.command
        : running.arguments
          ? JSON.stringify(running.arguments)
          : null;
    return {
      id: typeof running.id === "string" && running.id.trim() !== "" ? running.id : running.name,
      name: running.name,
      argumentsSummary: summary,
    };
  }

  const snapshot = turn?.activeTools?.[0];
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    name: snapshot.name,
    argumentsSummary: snapshot.argumentsSummary,
  };
}

export type ProjectAssistantMode = "project" | "explore" | "freeform" | "kb";
type ProjectAssistantContentMaxWidth = "default" | "wide";

interface ProjectAssistantPanelProps {
  projectSlug?: string;
  threadId?: number;
  issueIdentifier?: string;
  view: WorkspaceView;
  assistantMode?: ProjectAssistantMode;
  /** Knowledge base page the chat is bound to (drives the `assistant:kb:*` topic). */
  kbRepoSlug?: string;
  kbPagePath?: string;
  /**
   * Returns extra fields merged into every outgoing `send_message` context at
   * send time. Used by the KB chat to inject the live open-document snapshot
   * (body + selection) so the snapshot is always current, not captured on mount.
   */
  getExtraContext?: () => Record<string, unknown> | undefined;
  /** Notifies the parent whenever the assistant turn running state changes. */
  onRunningChange?: (running: boolean) => void;
  mode?: "sheet" | "page" | "embedded";
  /**
   * Hides the panel's own title header. Used by session tabs where the
   * surrounding layout already renders a working-tree header row, so the chat
   * gets the vertical space instead of two stacked headers.
   */
  hideHeader?: boolean;
  /** Incrementing counter that opens the workspace diff modal from outside (e.g. the session toolbar). */
  diffRequestId?: number;
  issueGoalMode?: boolean;
  issueGoalModeRequestId?: number;
  dispatchRequestId?: number;
  onDocumentChanged?: (payload: AssistantDocumentChangedPayload) => void;
  onDraftIssueCreated?: (issue: DraftIssueCreated) => void;
  onIssueCreated?: (issue: AssistantIssueCreatedPayload) => void;
  onIssueGoalModeChanged?: (enabled: boolean) => void;
  onIssueGoalModeError?: (message: string) => void;
  onDispatchSucceeded?: (message: string) => void;
  onDispatchError?: (message: string) => void;
  onEffectiveAgentResolved?: (agent: AgentKind) => void;
  onComposerAgentResolved?: (agent: AgentKind) => void;
  onOpenDocumentPath?: (path: string) => void;
  onKbDocumentReferencesChanged?: (paths: string[]) => void;
  /** Lets a parent toolbar open the same issue-scoped KB modal as the composer KB button. */
  onKnowledgeBaseControlChange?: (control: { open: () => void; changedDocCount: number } | null) => void;
  /**
   * Reports the tasks dock control (progress + open state + toggle) so an
   * external surface (e.g. the session top bar) can mirror the composer's
   * tasks toggle. Reports `null` when there are no tasks or the panel is not
   * in page mode. Only wired by consumers that render an external toggle.
   */
  onTasksDockControlChange?: (control: AssistantTasksDockControl | null) => void;
  composerSeedMessage?: string | null;
  contentMaxWidth?: ProjectAssistantContentMaxWidth;
}

interface QueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
}

type PlanApprovalMode = Parameters<AssistantChatPlanApprovalAction["onApprove"]>[1];

const TASKS_DOCK_STORAGE_KEY = "symphony.assistantTasksDock.open";

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
  kbRepoSlug,
  kbPagePath,
  getExtraContext,
  onRunningChange,
  mode = "sheet",
  hideHeader = false,
  diffRequestId = 0,
  issueGoalMode,
  issueGoalModeRequestId = 0,
  dispatchRequestId = 0,
  onDocumentChanged,
  onDraftIssueCreated,
  onIssueCreated,
  onIssueGoalModeChanged,
  onIssueGoalModeError,
  onDispatchSucceeded,
  onDispatchError,
  onEffectiveAgentResolved,
  onComposerAgentResolved,
  onOpenDocumentPath,
  onKbDocumentReferencesChanged,
  onKnowledgeBaseControlChange,
  onTasksDockControlChange,
  composerSeedMessage = null,
  contentMaxWidth = "default",
}: ProjectAssistantPanelProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runningStartedAt, setRunningStartedAt] = useState<number | null>(null);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [btw, setBtw] = useState<{ id: string | null; question: string; answer: string; status: BtwStatus } | null>(
    null,
  );
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [approvedPlanMessageIds, setApprovedPlanMessageIds] = useState<Set<string>>(() => new Set());
  // Tab-scoped Authoring goal: a native Codex goal running directly in this chat (no orchestrator).
  // It is independent from the issue's Execution goal owned by the Execution tab. `native` reflects
  // whether a native Codex goal exists yet (established by a turn); `status`/`timeUsedSeconds` come
  // from the native goal so the pill shows truthful state instead of just the enabled flag.
  const [authoringGoal, setAuthoringGoal] = useState<AuthoringGoalState>(emptyAuthoringGoal);
  // The thread's last turn lifecycle state; an interrupted turn surfaces a Resume affordance.
  const [lastTurn, setLastTurn] = useState<AssistantTurnStatus | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<UserQuestionsRequest | null>(null);
  const [pendingApproval, setPendingApproval] = useState<AssistantApprovalRequest | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AssistantCatalogBundle | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const channelRef = useRef<Channel | null>(null);
  const bundleRef = useRef<AssistantCatalogBundle | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollBehaviorRef = useRef<"initial" | "smooth">("initial");
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const scrollStickinessCleanupRef = useRef<(() => void) | null>(null);
  const onDocumentChangedRef = useRef(onDocumentChanged);
  const onDraftIssueCreatedRef = useRef(onDraftIssueCreated);
  const onEffectiveAgentResolvedRef = useRef(onEffectiveAgentResolved);
  const onIssueCreatedRef = useRef(onIssueCreated);
  const onIssueGoalModeChangedRef = useRef(onIssueGoalModeChanged);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastConfirmedGoalModeRef = useRef<boolean | null>(null);
  const pendingGoalModeRef = useRef<{ enabled: boolean; requestId: number } | null>(null);
  const lastDispatchRequestRef = useRef(0);
  // The composer owns agent selection; mirror it here so dispatch + the parent
  // panel can follow the live choice. A ref keeps the dispatch effect stable.
  const composerAgentRef = useRef<AgentKind | null>(null);
  const [composerAgent, setComposerAgent] = useState<AgentKind>("codex");
  const routeAgentSeed = useMemo(
    () => normalizeAgentSeed(new URLSearchParams(location.search).get("assistant_agent")),
    [location.search],
  );
  const [serverAgentSeed, setServerAgentSeed] = useState<AgentKind | null>(routeAgentSeed);
  const contextInsertRequestIdRef = useRef(0);
  const [contextInsertRequest, setContextInsertRequest] = useState<ComposerContextInsertRequest | null>(null);
  const [magicPaletteRequestId, setMagicPaletteRequestId] = useState(0);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
  const [changedDocsRefreshKey, setChangedDocsRefreshKey] = useState(0);
  const changedDocs = useIssueChangedDocPaths({
    projectSlug,
    issueIdentifier: issueIdentifier ?? null,
    refreshKey: changedDocsRefreshKey,
  });

  useEffect(() => {
    if (!routeAgentSeed) return;
    composerAgentRef.current = routeAgentSeed;
    setComposerAgent(routeAgentSeed);
    setServerAgentSeed(routeAgentSeed);
  }, [routeAgentSeed]);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const executionModeRef = useRef<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Mentions work anywhere with a project context: issues are always searchable,
  // while file/PR sources self-disable when there is no bound issue identifier.
  const mentionsEnabled = Boolean(projectSlug);
  const hasExecutableContext = Boolean(issueIdentifier || threadId);
  const slashContext = hasExecutableContext ? "execution" : "authoring";
  const mentionOptions = useContextMentionData(
    projectSlug ?? "",
    issueIdentifier ?? "",
    mentionsEnabled ? mentionQuery : null,
  );
  const {
    commands: authoringCommands,
    isLoading: authoringCommandsLoading,
    error: authoringCommandsError,
  } = useAssistantCommands({ projectSlug, context: slashContext });
  const authoringSlashCommandExtras = useMemo(() => {
    if (authoringCommandsLoading || authoringCommandsError || authoringCommands.length === 0) {
      return defaultSkillCommands(t, slashContext);
    }
    return assistantCommandsToSlashDefs(authoringCommands, t);
  }, [authoringCommands, authoringCommandsError, authoringCommandsLoading, slashContext, t]);
  // Keep the live extra-context getter in a ref so `dispatchSend` reads the
  // latest open-document snapshot at send time without re-subscribing the channel.
  const getExtraContextRef = useRef<typeof getExtraContext>(getExtraContext);
  getExtraContextRef.current = getExtraContext;

  useEffect(() => {
    executionModeRef.current = executionMode;
  }, [executionMode]);

  const { rememberMention, expandMentions } = useComposerMentions();

  const [composerHeight, setComposerHeight] = useState(0);
  const isPageMode = mode === "page";
  const isEmbeddedMode = mode === "embedded";
  const isPanelMode = isPageMode || isEmbeddedMode;
  const embeddedPanelInset = "pl-5 pr-4";
  const isFullPageProjectAssistant = isPageMode && Boolean(projectSlug) && !issueIdentifier && threadId == null;
  const widePageContent = contentMaxWidth === "wide";
  const active = isPanelMode || open;
  const resolvedAssistantMode: ProjectAssistantMode =
    assistantMode ?? (projectSlug ? (issueIdentifier ? "project" : "project") : "freeform");
  const isExploreMode = resolvedAssistantMode === "explore";
  const isKbMode = resolvedAssistantMode === "kb" && Boolean(kbRepoSlug) && Boolean(kbPagePath);

  bundleRef.current = bundle;
  onDocumentChangedRef.current = onDocumentChanged;
  onDraftIssueCreatedRef.current = onDraftIssueCreated;
  onEffectiveAgentResolvedRef.current = onEffectiveAgentResolved;
  onIssueCreatedRef.current = onIssueCreated;
  onIssueGoalModeChangedRef.current = onIssueGoalModeChanged;

  const workspaceDiffStats = useWorkspaceDiffStats({
    projectSlug,
    issueIdentifier,
    threadId,
    enabled: active,
  });

  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node && scrollRef.current && !stickToBottomRef.current) {
      pinnedScrollTopRef.current = scrollRef.current.scrollTop;
    }

    scrollStickinessCleanupRef.current?.();
    scrollStickinessCleanupRef.current = null;
    scrollRef.current = node;
    if (node) {
      scrollStickinessCleanupRef.current = attachChatScrollStickiness(
        node,
        stickToBottomRef,
        pinnedScrollTopRef,
        setIsAtBottom,
      );
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickToBottomRef.current = true;
    pinnedScrollTopRef.current = null;
    setIsAtBottom(true);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => () => scrollStickinessCleanupRef.current?.(), []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const pinnedTop = pinnedScrollTopRef.current;
    if (!scroller || stickToBottomRef.current || pinnedTop == null) return;
    if (Math.abs(scroller.scrollTop - pinnedTop) > 1) {
      scroller.scrollTop = pinnedTop;
    }
  });

  useEffect(() => {
    scrollBehaviorRef.current = "initial";
    stickToBottomRef.current = true;
    pinnedScrollTopRef.current = null;
    setIsAtBottom(true);
  }, [issueIdentifier, threadId]);

  useEffect(() => {
    setRunningStartedAt((current) => {
      if (isRunning) return current ?? Date.now();
      return null;
    });
  }, [isRunning]);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

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
  }, [active, projectSlug, t]);

  useEffect(() => {
    if (!active) return;
    if (threadId == null && !projectSlug) {
      setConnectionError(t("assistant.panel.noConnectionTarget"));
      return;
    }

    setChannelReady(false);
    lastConfirmedGoalModeRef.current = null;
    pendingGoalModeRef.current = null;
    setAuthoringGoal(emptyAuthoringGoal);
    setLastTurn(null);

    const socket = createTrackerSocket();
    socket.connect();

    const topic =
      threadId != null
        ? assistantThreadTopic(threadId)
        : issueIdentifier
          ? assistantIssueTopic(projectSlug ?? "", issueIdentifier)
          : isKbMode
            ? assistantKbTopic(projectSlug ?? "", kbRepoSlug ?? "", kbPagePath ?? "")
            : isExploreMode
              ? assistantExploreTopic(projectSlug ?? "")
              : assistantTopic(projectSlug ?? "");
    const channel = socket.channel(topic);
    channelRef.current = channel;

    bindAssistantEvents(channel, {
      onHistoryLoaded: (history) =>
        setMessagesPreservingScroll(scrollRef.current, stickToBottomRef, history, setMessages),
      onHistorySynced: (history) => {
        setMessagesPreservingScroll(scrollRef.current, stickToBottomRef, history, setMessages);
        setIsRunning(false);
        setPendingQuestions(null);
        setPendingApproval(null);
      },
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
        setPendingApproval(null);
        const createdIssue = draftIssueCreatedFromMessage(message);
        if (createdIssue) onDraftIssueCreatedRef.current?.(createdIssue);
      },
      onAssistantError: (message) => {
        setMessages((current) => appendMessage(current, assistantMessage("assistant-error", message)));
        setConnectionError(message);
        setIsRunning(false);
        setPendingQuestions(null);
        setPendingApproval(null);
      },
      onUserInputRequired: (request) => setPendingQuestions(request),
      onApprovalRequired: (request) => setPendingApproval(request),
      onAssistantDocumentChanged: (payload) => {
        if (payload.identifier && issueIdentifier && normalizeIssueIdentifier(payload.identifier) === normalizeIssueIdentifier(issueIdentifier)) {
          setChangedDocsRefreshKey((current) => current + 1);
        }
        onDocumentChangedRef.current?.(payload);
      },
      onAssistantIssueCreated: (payload) => onIssueCreatedRef.current?.(payload),
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
              contextRefs: [],
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
      onGoalStatus: (status) => {
        setAuthoringGoal((current) => mergeGoalStatus(current, status));
        // In a goal-enabled thread every turn is a goal turn, so the status push is
        // authoritative for whether the assistant is busy: running:true reattaches a
        // tab to a run already in flight (e.g. after a refresh); running:false means
        // idle (covers paused-cancel where no assistant_completed/error is emitted).
        setIsRunning(status.running);
      },
      onGoalRunning: (running) => {
        if (running) setIsRunning(true);
      },
      // Observer/reattached tabs receive turn_status fan-out (the originating tab
      // reconciles via assistant_completed/error). Mirror the running indicator and
      // remember the latest turn so an interrupted turn can offer Resume. Request a
      // durable history sync on terminal status so tabs recover when streaming events
      // targeted a dead channel process.
      onTurnStatus: (status) => {
        setLastTurn(status);
        setIsRunning(status.status === "running");
        if (status.status === "running" && status.activeTools.length > 0) {
          setMessages((current) => hydrateStreamingActiveTools(current, status.activeTools));
        }
        if (isTerminalTurnStatus(status.status)) {
          setPendingQuestions(null);
          requestHistorySync(channel);
        }
      },
    });

    const joinPush = channel.join();
    joinPush.receive("ok", (response) => {
      setConnectionError(null);
      setChannelReady(true);

      // Reconcile the last turn on a freshly joined (e.g. reloaded) tab: surface the
      // Resume affordance for an interrupted turn and reattach the running indicator
      // when a turn is still in flight.
      const joinedLastTurn = readLastTurn(response);
      setLastTurn(joinedLastTurn);
      if (joinedLastTurn?.status === "running") {
        setIsRunning(true);
        if (joinedLastTurn.activeTools.length > 0) {
          setMessages((current) => hydrateStreamingActiveTools(current, joinedLastTurn.activeTools));
        }
      }

      if (issueIdentifier) {
        const hydratedGoalMode = goalModeFromResponse(response) ?? false;
        lastConfirmedGoalModeRef.current = hydratedGoalMode;
        if (hydratedGoalMode) onIssueGoalModeChangedRef.current?.(true);
        // Reattach to a goal turn already in flight (e.g. started before this
        // refresh): seed the pill timer from the server's run-elapsed and mark the
        // assistant running so the pill renders "executing" immediately.
        const goalRunning = hydratedGoalMode && goalRunningFromResponse(response);
        setAuthoringGoal({
          ...emptyAuthoringGoal,
          enabled: hydratedGoalMode,
          objective: hydratedGoalMode ? goalObjectiveFromResponse(response) : null,
          status: goalRunning ? "active" : null,
          timeUsedSeconds: goalRunning ? goalRunElapsedFromResponse(response) : null,
        });
        if (goalRunning) setIsRunning(true);
        // Pull the native goal (status + timer) asynchronously; the channel pushes
        // "goal_status" back. Cheap no-op server-side when the goal isn't enabled.
        if (hydratedGoalMode) requestGoalStatus(channel);
      }

      const agent = effectiveAgentFromResponse(response);
      if (agent) {
        composerAgentRef.current = agent;
        setComposerAgent(agent);
        setServerAgentSeed(agent);
        onEffectiveAgentResolvedRef.current?.(agent);
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
  }, [active, isExploreMode, isKbMode, kbRepoSlug, kbPagePath, issueIdentifier, projectSlug, threadId, t]);

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
  }, [active, channelReady, issueIdentifier, issueGoalMode, issueGoalModeRequestId, onIssueGoalModeChanged, onIssueGoalModeError, t]);

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
  }, [active, channelReady, issueIdentifier, dispatchRequestId, issueGoalMode, onDispatchSucceeded, onDispatchError, t]);

  const dispatchApprovedPlan = useCallback(
    (messageId: string, mode: PlanApprovalMode) => {
      if (!issueIdentifier) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError(t("assistant.panel.channelNotConnected"));
        return;
      }

      setConnectionError(null);
      setExecutionMode(mode);
      executionModeRef.current = mode;
      setApprovedPlanMessageIds((current) => new Set(current).add(messageId));

      const agent = composerAgentRef.current;
      const agentName = agentDisplayName(agent);
      const pushResult = dispatchCodingAgent(channel, { goalMode: issueGoalMode === true, agent, mode });
      pushResult.receive("ok", (response) => {
        onDispatchSucceeded?.(messageFromResponse(response) ?? t("assistant.panel.dispatchedTo", { agent: agentName }));
      });
      pushResult.receive("error", (reason) => {
        setApprovedPlanMessageIds((current) => {
          const next = new Set(current);
          next.delete(messageId);
          return next;
        });
        onDispatchError?.(errorMessage(reason));
      });
      pushResult.receive("timeout", () => {
        setApprovedPlanMessageIds((current) => {
          const next = new Set(current);
          next.delete(messageId);
          return next;
        });
        onDispatchError?.(t("assistant.panel.dispatchTimeout", { agent: agentName }));
      });
    },
    [issueGoalMode, issueIdentifier, onDispatchError, onDispatchSucceeded, t],
  );

  const dispatchSend = useCallback(
    (submit: AssistantComposerSubmit) => {
      const trimmed = submit.message.trim();
      const hasAttachments = submit.attachments.length > 0;
      const hasContextRefs = submit.contextRefs.length > 0;
      if (!trimmed && !hasAttachments && !hasContextRefs) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError(t("assistant.panel.channelNotConnected"));
        return;
      }

      const extraContext = getExtraContextRef.current?.() ?? {};
      const expandedMessage = expandMentions(trimmed || fallbackAttachmentMessage(submit.attachments, t));
      const payload = {
        message: expandedMessage,
        context: {
          view,
          agent: submit.agent,
          model: submit.settings.model,
          effort: submit.settings.effort,
          ...(hasExecutableContext ? { execution_mode: executionModeRef.current } : {}),
          ...extraContext,
        },
        attachments: submit.attachments,
        ...(hasContextRefs ? { context_refs: submit.contextRefs } : {}),
      };

      setConnectionError(null);
      stickToBottomRef.current = true;
      pinnedScrollTopRef.current = null;
      setIsAtBottom(true);
      scrollBehaviorRef.current = "initial";
      setIsRunning(true);
      // Keep the transcript pinned to the bottom for the outgoing turn. Double-rAF
      // waits for layout after the user bubble lands (server echo / local append).
      const scrollOutgoingIntoView = () => {
        const scroller = scrollRef.current;
        if (!scroller || !stickToBottomRef.current) return;
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
      };
      requestAnimationFrame(() => {
        scrollOutgoingIntoView();
        requestAnimationFrame(scrollOutgoingIntoView);
      });
      channel.push("send_message", payload).receive("error", (reason) => {
        setConnectionError(errorMessage(reason));
        setIsRunning(false);
      });
    },
    [view, t, expandMentions, hasExecutableContext],
  );

  const steerTurn = useCallback(
    (submit: AssistantComposerSubmit) => {
      const channel = channelRef.current;
      const text = expandMentions(submit.message.trim());
      if (!channel || (!text && submit.contextRefs.length === 0)) return;
      channel.push("steer_turn", {
        message: text,
        ...(submit.contextRefs.length > 0 ? { context_refs: submit.contextRefs } : {}),
      });
    },
    [expandMentions],
  );

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
        setAuthoringGoal((current) => ({
          ...current,
          enabled,
          objective: goalObjectiveFromResponse(response) ?? (objective.length > 0 ? objective : current.objective),
        }));
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

  const pauseGoal = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    // Optimistic: mark paused immediately; the reply carries the authoritative state.
    setAuthoringGoal((current) => ({ ...current, status: "paused" }));
    pauseAuthoringGoal(channel).receive("ok", (response) => {
      setAuthoringGoal((current) => mergeGoalStatus(current, normalizeGoalStatus(response)));
    });
  }, []);

  const resumeGoal = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    setAuthoringGoal((current) => ({ ...current, status: "active" }));
    setIsRunning(true);
    resumeAuthoringGoal(channel).receive("error", (reason) => {
      setIsRunning(false);
      onIssueGoalModeError?.(errorMessage(reason, t));
    });
  }, [onIssueGoalModeError, t]);

  const removeGoal = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    clearAuthoringGoal(channel).receive("ok", (response) => {
      setAuthoringGoal((current) => mergeGoalStatus(current, normalizeGoalStatus(response)));
      lastConfirmedGoalModeRef.current = false;
      onIssueGoalModeChanged?.(false);
    });
  }, [onIssueGoalModeChanged]);

  const editGoalObjective = useCallback(
    (objective: string) => {
      const channel = channelRef.current;
      const trimmed = objective.trim();
      if (!channel || trimmed.length === 0) return;
      setAuthoringGoal((current) => ({ ...current, objective: trimmed }));
      setAuthoringGoalObjective(channel, trimmed).receive("ok", (response) => {
        setAuthoringGoal((current) => mergeGoalStatus(current, normalizeGoalStatus(response)));
      });
    },
    [],
  );

  const sendMessage = useCallback(
    (submit: AssistantComposerSubmit) => {
      if (submit.kind === "goal") {
        enableGoalCommand(submit);
        return;
      }

      const trimmed = submit.message.trim();
      const hasAttachments = submit.attachments.length > 0;
      const hasContextRefs = submit.contextRefs.length > 0;
      if (!trimmed && !hasAttachments && !hasContextRefs) return;

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
      setComposerAgent(agent);
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
        contextRefs: [],
      });
    },
    [sendMessage],
  );

  const visibleMessages = useMemo(() => displayMessages(messages, t), [messages, t]);
  const planApprovalMessageId = useMemo(
    () => latestPendingPlanMessageId(visibleMessages, approvedPlanMessageIds),
    [visibleMessages, approvedPlanMessageIds],
  );
  const taskSnapshot = useMemo(
    () => deriveAgentTasksFromAssistantMessages(visibleMessages),
    [visibleMessages],
  );
  const hasTasks = (taskSnapshot?.tasks.length ?? 0) > 0;
  const tasksDone = taskSnapshot ? completedTaskCount(taskSnapshot) : 0;
  const tasksTotal = taskSnapshot?.tasks.length ?? 0;
  const isLgUp = useIsLgUp();
  const [tasksDockOpen, setTasksDockOpen] = useState<boolean>(
    () => window.localStorage.getItem(TASKS_DOCK_STORAGE_KEY) !== "false",
  );
  const persistTasksDockOpen = useCallback((next: boolean) => {
    window.localStorage.setItem(TASKS_DOCK_STORAGE_KEY, String(next));
    setTasksDockOpen(next);
  }, []);
  const toggleTasksDock = useCallback(() => {
    setTasksDockOpen((previous) => {
      const next = !previous;
      window.localStorage.setItem(TASKS_DOCK_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  const tasksAvailable = isPageMode && hasTasks && taskSnapshot != null;
  const showTasksDock = tasksAvailable && tasksDockOpen && isLgUp;
  const showTasksSheet = tasksAvailable && tasksDockOpen && !isLgUp;

  useEffect(() => {
    if (!onTasksDockControlChange) return undefined;
    onTasksDockControlChange(
      isPageMode && hasTasks
        ? { done: tasksDone, total: tasksTotal, open: tasksDockOpen, toggle: toggleTasksDock }
        : null,
    );
    return () => onTasksDockControlChange(null);
  }, [onTasksDockControlChange, isPageMode, hasTasks, tasksDone, tasksTotal, tasksDockOpen, toggleTasksDock]);

  useEffect(() => {
    if (!onKnowledgeBaseControlChange || !projectSlug) {
      onKnowledgeBaseControlChange?.(null);
      return undefined;
    }
    onKnowledgeBaseControlChange({
      open: () => setKnowledgeBaseOpen(true),
      changedDocCount: changedDocs.count,
    });
    return () => onKnowledgeBaseControlChange(null);
  }, [changedDocs.count, onKnowledgeBaseControlChange, projectSlug]);

  const kbDocumentReferences = useMemo(
    () =>
      visibleMessages.reduce<string[]>((references, message) => {
        for (const reference of extractKbDocumentReferencesFromMessage(message)) {
          if (!references.includes(reference)) references.push(reference);
        }
        return references;
      }, []),
    [visibleMessages],
  );
  const kbDocumentReferencesKey = kbDocumentReferences.join("\0");
  const composerBundle = useMemo(() => bundle ?? fallbackCatalogBundle(), [bundle]);
  const catalogLoading = !bundle && !catalogError;

  useEffect(() => {
    onKbDocumentReferencesChanged?.(kbDocumentReferences);
  }, [kbDocumentReferences, kbDocumentReferencesKey, onKbDocumentReferencesChanged]);

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
    if (!isPanelMode || !stickToBottomRef.current) return undefined;
    const scroller = scrollRef.current;
    if (!scroller) return undefined;

    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return;

      const behavior = isRunning && scrollBehaviorRef.current !== "initial" ? "smooth" : "auto";
      scrollBehaviorRef.current = "smooth";
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      // Second frame: message/tool rows often grow after the first paint.
      secondFrame = requestAnimationFrame(() => {
        if (!stickToBottomRef.current || !scrollRef.current) return;
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
    };
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

  const activeToolDetail = activeToolDetailFromMessages(messages, lastTurn);
  const nowMs = useNowTick(1000, { enabled: isRunning });
  const stale =
    isRunning &&
    typeof lastTurn?.lastActivityAt === "string" &&
    Number.isFinite(Date.parse(lastTurn.lastActivityAt)) &&
    nowMs - Date.parse(lastTurn.lastActivityAt) >= STALE_ACTIVITY_MS;

  const handleStopTurn = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    stopTurn(channel).receive("error", (reason) => setConnectionError(errorMessage(reason)));
  }, []);

  const handleKillTool = useCallback(
    (toolCallId: string) => {
      const channel = channelRef.current;
      if (!channel) return;
      killTool(channel, toolCallId).receive("error", (reason) => {
        const payload = (reason ?? {}) as { can_stop_turn?: boolean; reason?: string };
        if (payload.can_stop_turn === true) {
          toast.error(t("assistant.working.killFailed"));
          return;
        }
        setConnectionError(errorMessage(reason));
      });
    },
    [t],
  );

  const panelTitle = isExploreMode
    ? t("assistant.panel.exploreTitle")
    : projectSlug
      ? t("assistant.panel.projectTitle")
      : t("assistant.panel.freeformTitle");
  const panelModelCommand = bundle ? catalogFor(bundle, bundle.defaultAgent).command : null;

  const sendDiffReview = useCallback(
    (review: string) => {
      const activeBundle = bundleRef.current ?? fallbackCatalogBundle();
      const activeCatalog = catalogFor(activeBundle, activeBundle.defaultAgent);
      sendMessage({
        kind: "infer",
        message: review,
        agent: composerAgentRef.current ?? activeBundle.defaultAgent,
        settings: defaultComposerSettings(activeCatalog),
        attachments: [],
        contextRefs: [],
      });
    },
    [sendMessage],
  );

  const insertContextRef = useCallback((ref: ComposerContextChipRef) => {
    contextInsertRequestIdRef.current += 1;
    setContextInsertRequest({
      id: contextInsertRequestIdRef.current,
      ref: { ...ref, state: "draft" },
    });
  }, []);

  const messageItems = (
    <AssistantMessageList
      messages={visibleMessages}
      taskSnapshot={taskSnapshot}
      hidePinnedPanel={showTasksDock}
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier}
      threadId={threadId}
      isRunning={isRunning}
      runningStartedAt={runningStartedAt}
      activeToolDetail={activeToolDetail}
      stale={stale}
      connectionError={connectionError}
      channelReady={channelReady}
      planApprovalMessageId={planApprovalMessageId}
      onOpenDocumentPath={onOpenDocumentPath}
      onInsertContext={insertContextRef}
      onApprovePlan={dispatchApprovedPlan}
      onStop={handleStopTurn}
      onKillTool={handleKillTool}
    />
  );

  const removeQueued = useCallback(
    (id: string) => setQueued((current) => current.filter((entry) => entry.id !== id)),
    [],
  );

  const queuedChips =
    queued.length > 0 ? (
      <QueuedMessageChips
        items={queued.map((item) => ({ id: item.id, message: item.payload.message.trim() }))}
        onSendNow={forceSendQueued}
        onRemove={removeQueued}
      />
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

  const submitCommandApproval = useCallback(
    (requestId: string | number, action: "approve" | "cancel") => {
      const channel = channelRef.current;
      if (!channel) return;

      submitApproval(channel, requestId, action)
        .receive("ok", () => setPendingApproval((current) => (current?.requestId === requestId ? null : current)))
        .receive("error", (reason) => setConnectionError(errorMessage(reason)));
    },
    [],
  );

  const approvalNode = pendingApproval ? (
    <div className="px-4 pb-2">
      <CommandApprovalCard
        request={pendingApproval}
        onSubmit={submitCommandApproval}
        onInsertContext={insertContextRef}
        disabled={!channelReady}
      />
    </div>
  ) : null;

  // An interrupted turn can be re-dispatched; offer Resume while no turn is running.
  const resumeBanner =
    lastTurn?.canResume && !isRunning ? (
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="min-w-0 flex-1">{t("assistant.panel.turnInterrupted")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => {
              const channel = channelRef.current;
              if (!channel) return;
              void resumeTurn(channel);
              setLastTurn(null);
            }}
          >
            {t("assistant.panel.resume")}
          </Button>
        </div>
      </div>
    ) : null;

  // Docks flush inside the composer card (passed as its `header`) so the goal
  // reads as the top of the message box — one piece, no separating line.
  const authoringGoalPill =
    issueIdentifier && authoringGoal.enabled ? (
      <GoalPill
        phase={authoringGoalPhase(authoringGoal, isRunning)}
        objective={authoringGoal.objective}
        running={isRunning}
        timeUsedSeconds={authoringGoal.timeUsedSeconds}
        onPause={pauseGoal}
        onResume={resumeGoal}
        onRemove={removeGoal}
        onEditObjective={editGoalObjective}
      />
    ) : null;

  const openKnowledgeBase = useCallback(() => {
    if (!projectSlug) return;
    setKnowledgeBaseOpen(true);
  }, [projectSlug]);

  useEffect(() => {
    if (!projectSlug || catalogLoading) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      if (isTextEntryTarget(event.target)) return;

      event.preventDefault();
      openKnowledgeBase();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [catalogLoading, openKnowledgeBase, projectSlug]);

  const composerNode = (
    <AssistantComposer
      projectSlug={projectSlug ?? ""}
      bundle={composerBundle}
      agentMenuDisabled={isRunning || catalogLoading}
      composerDisabled={catalogLoading}
      floating={isPanelMode}
      hasQueued={queued.length > 0}
      seedMessage={composerSeedMessage}
      slashContext={slashContext}
      slashCommandExtras={authoringSlashCommandExtras}
      magicPaletteRequestId={magicPaletteRequestId}
      header={authoringGoalPill}
      contextInsertRequest={contextInsertRequest}
      hint={catalogLoading ? t("assistant.panel.loadingModels") : undefined}
      mentionsEnabled={mentionsEnabled}
      mentionOptions={mentionOptions}
      onMentionQueryChange={setMentionQuery}
      onMentionSelect={rememberMention}
      agentSeed={serverAgentSeed}
      toolbarAfterAttach={
        isPageMode && hasTasks ? (
          <Button
            type="button"
            variant={tasksDockOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            aria-pressed={tasksDockOpen}
            aria-label={tasksDockOpen ? t("issue.tasks.hide") : t("issue.tasks.show")}
            title={tasksDockOpen ? t("issue.tasks.hide") : t("issue.tasks.show")}
            onClick={toggleTasksDock}
          >
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("issue.tasks.title")}</span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {t("issue.tasks.progress", { done: tasksDone, total: tasksTotal })}
            </span>
          </Button>
        ) : undefined
      }
      toolbarMore={
        projectSlug || issueIdentifier || threadId ? (
          <>
            {issueIdentifier || threadId ? (
              <GitDiffLauncher
                projectSlug={projectSlug ?? undefined}
                identifier={issueIdentifier ?? null}
                threadId={threadId ?? null}
                disabled={catalogLoading}
                onSendReview={sendDiffReview}
                openRequestId={diffRequestId}
              />
            ) : null}
            {hideHeader ? <WorkspaceDiffStatsChip stats={workspaceDiffStats} /> : null}
            {projectSlug ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative h-8 gap-1 px-2 text-xs"
                disabled={catalogLoading}
                aria-label={t("layout.projectHeader.knowledgeBase")}
                title={t("assistant.panel.openKnowledgeBaseShortcut")}
                onClick={openKnowledgeBase}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("assistant.panel.openKnowledgeBase")}</span>
                {changedDocs.count > 0 ? (
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                    data-testid="changed-docs-dot"
                  />
                ) : null}
              </Button>
            ) : null}
            {hasExecutableContext ? (
              <ExecutionModeMenu
                agent={composerAgent}
                mode={executionMode}
                disabled={isRunning || catalogLoading}
                onChange={setExecutionMode}
              />
            ) : null}
            {hasExecutableContext ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                disabled={catalogLoading}
                title={t("commands.magic.open")}
                onClick={() => setMagicPaletteRequestId((current) => current + 1)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("commands.magic.button")}</span>
              </Button>
            ) : null}
          </>
        ) : undefined
      }
      onForceQueued={forceSendOldestQueued}
      onSubmit={sendMessage}
      onAgentChange={handleComposerAgentChange}
      dropTargetRef={panelRef}
    />
  );

  const knowledgeBaseDialog = projectSlug ? (
    <KnowledgeBaseModal
      open={knowledgeBaseOpen}
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier ?? null}
      changedDocPaths={changedDocs.paths}
      changedDocEntries={changedDocs.entries}
      onOpenChange={setKnowledgeBaseOpen}
      onInsertContext={insertContextRef}
    />
  ) : null;

  const scrollToBottomButton = !isAtBottom ? (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center",
        isEmbeddedMode ? embeddedPanelInset : isPageMode ? "px-4" : "",
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label={t("assistant.panel.scrollToBottom")}
        title={t("assistant.panel.scrollToBottom")}
        onClick={scrollToBottom}
        className="pointer-events-auto h-8 w-8 rounded-full border bg-background/95 shadow-md backdrop-blur-sm"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  ) : null;

  if (isPanelMode) {
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <section
          ref={panelRef}
          className={cn(
            "relative flex",
            isPageMode && (isFullPageProjectAssistant ? "h-[calc(100vh-4rem)]" : "h-full min-h-0"),
            isEmbeddedMode && "h-full min-h-0",
            showTasksDock && "gap-3",
          )}
          aria-label={t("assistant.panel.ariaLabel")}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {isEmbeddedMode || hideHeader ? null : (
            <AssistantPanelHeader
              title={panelTitle}
              isPageMode={isPageMode}
              projectSlug={projectSlug}
              diffStats={workspaceDiffStats}
              modelCommand={panelModelCommand}
            />
          )}

          <div className="relative min-h-0 flex-1">
            <div ref={setScrollContainerRef} className={cn("h-full overflow-y-auto", SCROLLBAR_THIN)}>
              <div
                className={cn(
                  "flex w-full flex-col",
                  isPageMode
                    ? widePageContent
                      ? "mx-auto max-w-[min(100%,80rem)] gap-4 px-4 pt-4 lg:px-6"
                      : "mx-auto max-w-4xl gap-4 px-4 pt-4"
                    : cn("gap-4 py-4", embeddedPanelInset),
                )}
                style={isFullPageProjectAssistant ? { paddingBottom: composerHeight + 16 } : undefined}
              >
                {messageItems}
              </div>
            </div>
            {scrollToBottomButton}
          </div>

          {isFullPageProjectAssistant ? (
            <div ref={composerDockRef} className="pointer-events-none absolute inset-x-0 bottom-0">
              <div className="pointer-events-none h-10 bg-gradient-to-t from-background to-transparent" />
              <div className="pointer-events-auto bg-background">
                <div
                  className={cn(
                    "mx-auto w-full px-4 pb-2 pt-1",
                    widePageContent ? "max-w-[min(100%,80rem)] lg:px-6" : "max-w-4xl",
                  )}
                >
                  {resumeBanner}
                  {queuedChips}
                  {questionsNode}
                  {approvalNode}
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
            <div ref={composerDockRef} className="shrink-0 bg-background pr-2.5">
              <div
                className={cn(
                  "mx-auto w-full px-4 py-2",
                  widePageContent ? "max-w-[min(100%,80rem)] lg:px-6" : "max-w-4xl",
                )}
              >
                {resumeBanner}
                {queuedChips}
                {questionsNode}
                {approvalNode}
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
            <div className={cn("shrink-0 bg-background pb-2 pt-2", embeddedPanelInset)}>
              {queuedChips}
              {questionsNode}
              {approvalNode}
              {composerNode ?? (
                <div className="border-t px-4 py-6 text-sm text-muted-foreground">{t("assistant.panel.loadingModels")}</div>
              )}
              {catalogError ? (
                <p className="border-t px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">{catalogError}</p>
              ) : null}
            </div>
          )}
          </div>
          {showTasksDock && taskSnapshot ? (
            <AssistantTasksDock snapshot={taskSnapshot} onClose={toggleTasksDock} />
          ) : null}
        </section>
        {showTasksSheet && taskSnapshot ? (
          <AssistantTasksSheet
            open={tasksDockOpen}
            snapshot={taskSnapshot}
            onOpenChange={persistTasksDockOpen}
          />
        ) : null}
        {btw ? (
          <BtwOverlay question={btw.question} answer={btw.answer} status={btw.status} onClose={() => setBtw(null)} />
        ) : null}
        {knowledgeBaseDialog}
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
            {resumeBanner}
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
      {knowledgeBaseDialog}
    </AssistantRuntimeProvider>
  );
}
