import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Channel } from "phoenix";
import {
  Bot,
  BookOpen,
  ChevronDown,
  Clock,
  Plus,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { i18n } from "@/i18n";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  AssistantComposer,
  type AssistantComposerSubmit,
  type ComposerContextInsertRequest,
} from "@/components/assistant/AssistantComposer";
import {
  AssistantChatMessageBubble,
  type AssistantChatPlanApprovalAction,
} from "@/components/assistant/AssistantChatMessageBubble";
import { assistantCommandsToSlashDefs } from "@/components/assistant/assistantCommandDefs";
import {
  type ComposerContextChipRef,
  expandComposerMentions,
  parseMentionTokens,
  type ResolvedMention,
} from "@/components/assistant/contextMentions";
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
import { BtwOverlay, type BtwStatus } from "@/components/assistant/BtwOverlay";
import { AgentTaskPinnedPanel } from "@/components/agent-activity";
import { WorkingIndicator } from "@/components/assistant/WorkingIndicator";
import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { GoalPill, type GoalPillPhase } from "@/components/shared/GoalPill";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { deriveAgentTasksFromAssistantMessages } from "@/lib/agentTasks";
import { extractKbDocumentReferencesFromMarkdown } from "@/lib/assistantKbReferences";
import { catalogFor, defaultComposerSettings, fallbackCatalogBundle, type AssistantCatalogBundle } from "@/lib/assistantSettings";
import { combineDiffStats, diffStatsFromPatch, type DiffStats } from "@/lib/diffStats";
import { DEFAULT_EXECUTION_MODE } from "@/lib/executionMode";
import {
  fetchAssistantCatalogBundle,
  type AssistantChatMessage,
  type AssistantToolCall,
  type UserQuestionsRequest,
} from "@/services/assistant";
import { getGitDiff, getThreadGitDiff } from "@/services/gitDiff";
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
  setAuthoringGoalObjective,
  submitApproval,
  submitUserInput,
  type AssistantApprovalRequest,
  type AssistantDocumentChangedPayload,
  type AssistantTurnStatus,
  type AuthoringGoalStatus,
  type AssistantIssueCreatedPayload,
} from "@/services/phoenix/assistantChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { AgentKind, ExecutionMode } from "@/types/issue";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { useAssistantCommands } from "@/hooks/useAssistantCommands";

interface AuthoringGoalState {
  enabled: boolean;
  objective: string | null;
  native: boolean;
  status: string | null;
  timeUsedSeconds: number | null;
}

const emptyAuthoringGoal: AuthoringGoalState = {
  enabled: false,
  objective: null,
  native: false,
  status: null,
  timeUsedSeconds: null,
};

function mergeGoalStatus(prev: AuthoringGoalState, status: AuthoringGoalStatus): AuthoringGoalState {
  return {
    enabled: status.enabled,
    objective: status.objective ?? prev.objective,
    native: status.native,
    status: status.goal?.status ?? (status.native ? prev.status : null),
    timeUsedSeconds: status.goal?.timeUsedSeconds ?? prev.timeUsedSeconds,
  };
}

export interface DraftIssueCreated {
  identifier: string;
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
  composerSeedMessage?: string | null;
  contentMaxWidth?: ProjectAssistantContentMaxWidth;
}

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

function attachChatScrollStickiness(
  scroller: HTMLDivElement,
  stickToBottomRef: MutableRefObject<boolean>,
  pinnedScrollTopRef: MutableRefObject<number | null>,
  onAtBottomChange?: (atBottom: boolean) => void,
): () => void {
  const updateStickiness = () => {
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    pinnedScrollTopRef.current = atBottom ? null : scroller.scrollTop;
    onAtBottomChange?.(atBottom);
  };

  const detachFromBottom = () => {
    stickToBottomRef.current = false;
    pinnedScrollTopRef.current = scroller.scrollTop;
    // Stop an in-flight smooth scroll by pinning the current position.
    scroller.scrollTo({ top: scroller.scrollTop, behavior: "auto" });
  };

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) detachFromBottom();
  };

  let touchStartY: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    touchStartY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (touchStartY != null && y != null && y - touchStartY > 8) detachFromBottom();
  };

  updateStickiness();
  scroller.addEventListener("scroll", updateStickiness, { passive: true });
  scroller.addEventListener("wheel", onWheel, { passive: true });
  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: true });

  const content = scroller.firstElementChild;
  const resizeObserver = content ? new ResizeObserver(updateStickiness) : null;
  if (content) resizeObserver?.observe(content);

  return () => {
    scroller.removeEventListener("scroll", updateStickiness);
    scroller.removeEventListener("wheel", onWheel);
    scroller.removeEventListener("touchstart", onTouchStart);
    scroller.removeEventListener("touchmove", onTouchMove);
    resizeObserver?.disconnect();
  };
}

function setMessagesPreservingScroll(
  scroller: HTMLDivElement | null,
  stickToBottomRef: MutableRefObject<boolean>,
  history: AssistantChatMessage[],
  setMessages: (messages: AssistantChatMessage[]) => void,
) {
  if (scroller && !stickToBottomRef.current) {
    const prevScrollHeight = scroller.scrollHeight;
    const prevScrollTop = scroller.scrollTop;
    setMessages(history);
    requestAnimationFrame(() => {
      if (!scroller.isConnected) return;
      scroller.scrollTop = prevScrollTop + (scroller.scrollHeight - prevScrollHeight);
    });
    return;
  }

  setMessages(history);
}

interface QueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
}

type PlanApprovalMode = Parameters<AssistantChatPlanApprovalAction["onApprove"]>[1];

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
  composerSeedMessage = null,
  contentMaxWidth = "default",
}: ProjectAssistantPanelProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!routeAgentSeed) return;
    composerAgentRef.current = routeAgentSeed;
    setComposerAgent(routeAgentSeed);
    setServerAgentSeed(routeAgentSeed);
  }, [routeAgentSeed]);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const executionModeRef = useRef<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const resolvedMentionsRef = useRef<Map<string, ResolvedMention>>(new Map());
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

  const rememberMention = useCallback((entity: ResolvedMention) => {
    resolvedMentionsRef.current.set(`${entity.type}:${entity.id}`, entity);
  }, []);

  const expandMentions = useCallback((text: string): string => {
    const tokens = parseMentionTokens(text);
    if (tokens.length === 0) return text;
    const resolved = tokens.map(
      (token) => resolvedMentionsRef.current.get(`${token.type}:${token.id}`) ?? token,
    );
    return expandComposerMentions(text, resolved);
  }, []);

  const [composerHeight, setComposerHeight] = useState(0);
  const [workspaceDiffStats, setWorkspaceDiffStats] = useState<DiffStats | null>(null);
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

  useEffect(() => {
    if (!active) return;
    if (!threadId && (!projectSlug || !issueIdentifier)) {
      setWorkspaceDiffStats(null);
      return;
    }

    let cancelled = false;

    async function loadWorkspaceDiffStats() {
      try {
        const result = threadId
          ? await getThreadGitDiff(threadId, "uncommitted")
          : await getGitDiff(projectSlug ?? "", issueIdentifier ?? "", "uncommitted");
        if (cancelled) return;
        const stats = combineDiffStats(result.repos.flatMap((repo) => repo.files.map((file) => diffStatsFromPatch(file.patch))));
        setWorkspaceDiffStats(stats.additions > 0 || stats.deletions > 0 ? stats : null);
      } catch {
        if (!cancelled) setWorkspaceDiffStats(null);
      }
    }

    void loadWorkspaceDiffStats();

    return () => {
      cancelled = true;
    };
  }, [active, issueIdentifier, projectSlug, threadId]);

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
      onAssistantDocumentChanged: (payload) => onDocumentChangedRef.current?.(payload),
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
      if (joinedLastTurn?.status === "running") setIsRunning(true);

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
      setIsAtBottom(true);
      scrollBehaviorRef.current = "initial";
      setIsRunning(true);
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

    const frame = requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return;

      const behavior = isRunning && scrollBehaviorRef.current !== "initial" ? "smooth" : "auto";
      scrollBehaviorRef.current = "smooth";
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    });

    return () => cancelAnimationFrame(frame);
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
  const panelTitle = isExploreMode
    ? t("assistant.panel.exploreTitle")
    : projectSlug
      ? t("assistant.panel.projectTitle")
      : t("assistant.panel.freeformTitle");
  const panelModelCommand = bundle ? catalogFor(bundle, bundle.defaultAgent).command : null;

  const insertContextRef = useCallback((ref: ComposerContextChipRef) => {
    contextInsertRequestIdRef.current += 1;
    setContextInsertRequest({
      id: contextInsertRequestIdRef.current,
      ref: { ...ref, state: "draft" },
    });
  }, []);

  const messageItems = (
    <>
      <AgentTaskPinnedPanel snapshot={taskSnapshot} />
      {visibleMessages.map((message) => (
        <AssistantChatMessageBubble
          key={message.id}
          message={message}
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          threadId={threadId}
          onOpenDocumentPath={onOpenDocumentPath}
          onInsertContext={insertContextRef}
          taskSnapshot={taskSnapshot}
          planApprovalAction={
            issueIdentifier && !isRunning && message.id === planApprovalMessageId
              ? { messageId: message.id, disabled: !channelReady, onApprove: dispatchApprovedPlan }
              : undefined
          }
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
        projectSlug || issueIdentifier || threadId ? (
          <>
            {issueIdentifier || threadId ? (
              <GitDiffLauncher
                projectSlug={projectSlug ?? undefined}
                identifier={issueIdentifier ?? null}
                threadId={threadId ?? null}
                disabled={catalogLoading}
              />
            ) : null}
            {projectSlug ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                disabled={catalogLoading}
                aria-label={t("layout.projectHeader.knowledgeBase")}
                title={t("assistant.panel.openKnowledgeBaseShortcut")}
                onClick={openKnowledgeBase}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("assistant.panel.openKnowledgeBase")}</span>
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
            "relative flex flex-col",
            isPageMode && (isFullPageProjectAssistant ? "h-[calc(100vh-4rem)]" : "h-full min-h-0"),
            isEmbeddedMode && "h-full min-h-0",
          )}
          aria-label={t("assistant.panel.ariaLabel")}
        >
          {isEmbeddedMode ? null : (
            <div
              data-testid="project-assistant-compact-header"
              className={cn(
                "border-b bg-background/95",
                isPageMode ? "px-4 py-2 lg:px-6" : "px-4 py-2",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Bot className="h-4 w-4" />
                  </span>
                  <h2 className="truncate text-sm font-semibold leading-tight">{panelTitle}</h2>
                  {projectSlug ? (
                    <span className="hidden max-w-[18rem] truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
                      {projectSlug}
                    </span>
                  ) : null}
                  {workspaceDiffStats ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 font-mono text-[11px]"
                      title={`+${workspaceDiffStats.additions}/-${workspaceDiffStats.deletions} lines`}
                    >
                      <span className="text-emerald-600">+{workspaceDiffStats.additions}</span>
                      <span className="text-rose-600">-{workspaceDiffStats.deletions}</span>
                    </span>
                  ) : null}
                </div>
                {panelModelCommand ? (
                  <span className="min-w-0 max-w-full truncate text-[11px] text-muted-foreground sm:max-w-[18rem]">
                    {panelModelCommand}
                  </span>
                ) : null}
              </div>
            </div>
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
        </section>
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

function authoringGoalPhase(goal: AuthoringGoalState, running: boolean): GoalPillPhase {
  if (running) return "running";
  switch (goal.status) {
    case "paused":
      return "paused";
    case "completed":
    case "complete":
    case "done":
    case "satisfied":
      return "completed";
    case "blocked":
    case "failed":
    case "cancelled":
    case "canceled":
      return "stalled";
    default:
      // native + active-but-not-running reads as stalled (resumable); no native goal yet = pending.
      return goal.native ? "stalled" : "pending";
  }
}

function CommandApprovalCard({
  request,
  disabled,
  onSubmit,
  onInsertContext,
}: {
  request: AssistantApprovalRequest;
  disabled?: boolean;
  onSubmit: (requestId: string | number, action: "approve" | "cancel") => void;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm shadow-sm dark:border-amber-400/30 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-100">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <span>{t("assistant.panel.commandApproval.title")}</span>
      </div>
      {request.command ? (
        <pre className="mb-2 max-h-32 overflow-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-xs text-foreground">
          {request.command}
        </pre>
      ) : null}
      <dl className="mb-3 space-y-1 text-xs text-muted-foreground">
        {request.cwd ? (
          <div>
            <dt className="font-medium text-foreground">{t("assistant.panel.commandApproval.cwd")}</dt>
            <dd className="break-all font-mono">{request.cwd}</dd>
          </div>
        ) : null}
        {request.reason ? (
          <div>
            <dt className="font-medium text-foreground">{t("assistant.panel.commandApproval.reason")}</dt>
            <dd>{request.reason}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {onInsertContext ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={disabled}
            onClick={() => onInsertContext(contextRefForApprovalRequest(request, t))}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("assistant.panel.addToContext")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "approve")}
        >
          {t("assistant.panel.commandApproval.approve")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-3 text-xs"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "cancel")}
        >
          {t("assistant.panel.commandApproval.cancel")}
        </Button>
      </div>
    </div>
  );
}

function contextRefForApprovalRequest(request: AssistantApprovalRequest, t: TFunction): ComposerContextChipRef {
  const requestId = String(request.requestId);
  const content = [
    "### Agent permission request",
    "",
    request.command ? "#### Command" : null,
    request.command ? ["```shell", request.command, "```"].join("\n") : null,
    request.cwd ? `- Working directory: ${request.cwd}` : null,
    request.reason ? `- Detected action: ${request.reason}` : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  return {
    type: "security",
    id: `permission:${requestId}`,
    label: t("assistant.panel.commandApproval.title"),
    detail: request.cwd ?? request.reason ?? requestId,
    content,
    state: "draft",
  };
}

function displayMessages(messages: AssistantChatMessage[], t: TFunction): AssistantChatMessage[] {
  if (messages.length > 0) return messages;

  return [assistantMessage("assistant-welcome", t("assistant.panel.welcome"))];
}

function latestPendingPlanMessageId(messages: AssistantChatMessage[], approvedIds: ReadonlySet<string>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    if (message.role !== "assistant" || approvedIds.has(message.id)) continue;
    if (message.toolCalls.some(isPendingPlanToolCall)) return message.id;
  }

  return null;
}

function isPendingPlanToolCall(toolCall: AssistantToolCall): boolean {
  if (toolCall.name !== "update_plan") return false;

  const plan = planItemsFromToolCall(toolCall);
  if (plan.length === 0) return true;

  return plan.some((item) => itemStatus(item) !== "completed");
}

function planItemsFromToolCall(toolCall: AssistantToolCall): Record<string, unknown>[] {
  const sources = [toolCall.arguments, toolCall.result].filter(
    (source): source is Record<string, unknown> => source != null && typeof source === "object" && !Array.isArray(source),
  );

  for (const source of sources) {
    if (Array.isArray(source.plan)) {
      return source.plan.filter(
        (item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item),
      );
    }
  }

  return [];
}

function itemStatus(item: Record<string, unknown>): string {
  return typeof item.status === "string" ? item.status.toLowerCase() : "";
}

function extractKbDocumentReferencesFromMessage(message: AssistantChatMessage): string[] {
  const references = new Set(extractKbDocumentReferencesFromMarkdown(message.content));

  for (const toolCall of message.toolCalls) {
    for (const reference of extractKbDocumentReferencesFromMarkdown(serializedToolCallReferenceText(toolCall))) {
      references.add(reference);
    }
  }

  return [...references];
}

function serializedToolCallReferenceText(toolCall: AssistantToolCall): string {
  return [toolCall.output, safeJsonStringify(toolCall.arguments), safeJsonStringify(toolCall.result)]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function safeJsonStringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
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

function goalRunningFromResponse(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  return (response as Record<string, unknown>).goal_running === true;
}

function goalRunElapsedFromResponse(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).goal_run_elapsed_seconds;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function effectiveAgentFromResponse(response: unknown): AgentKind | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).effective_agent;
  return normalizeAgentSeed(value);
}

function normalizeAgentSeed(value: unknown): AgentKind | null {
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
