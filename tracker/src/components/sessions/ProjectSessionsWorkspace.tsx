import { Archive, FolderPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IssueEnvironmentDock } from "@/components/sessions/IssueEnvironmentDock";
import { IssuePreviewDock } from "@/components/sessions/IssuePreviewDock";
import { IssueTasksDock } from "@/components/sessions/IssueTasksDock";
import { IssueTerminalDock } from "@/components/sessions/IssueTerminalDock";
import { SessionEnvironmentDockContext } from "@/components/sessions/sessionEnvironmentDockContext";
import { SessionPreviewDockContext } from "@/components/sessions/sessionPreviewDockContext";
import { SessionTasksDockContext } from "@/components/sessions/sessionTasksDockContext";
import { SessionTasksDockFeedProvider } from "@/components/sessions/sessionTasksDockFeedContext";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";

import { ProjectSessionsChromeSetterContext } from "@/components/layout/ProjectSessionsChromeContext";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueAuthoringSessionPanel } from "@/components/issues/issue-detail/IssueAuthoringSessionPanel";
import { NewStandaloneWorkspaceDialog } from "@/components/sessions/NewStandaloneWorkspaceDialog";
import { type AuthoringSessionRow } from "@/components/sessions/SessionListItem";
import { StartIssueSessionDialog, type StartIssueSessionDialogIssue } from "@/components/sessions/StartIssueSessionDialog";
import { WorkspaceAccordionItem } from "@/components/sessions/WorkspaceAccordionItem";
import {
  WorkspaceActionButton,
  workspaceActionIconProps,
} from "@/components/sessions/WorkspaceActionButton";
import { WorkspaceArchiveDialog } from "@/components/sessions/WorkspaceArchiveDialog";
import { WorkspaceCleanupDialog } from "@/components/sessions/WorkspaceCleanupDialog";
import {
  WorkspaceRemoveDialog,
  type WorkspaceRemoveTarget,
} from "@/components/sessions/WorkspaceRemoveDialog";
import { sessionToolbarIconButtonClassName } from "@/components/sessions/sessionToolbarStyles";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { createSiblingSession } from "@/lib/createSiblingSession";
import { type ProjectSessionRow } from "@/lib/projectSessions";
import { resolveExecutionSessionId } from "@/lib/resolveExecutionSessionId";
import { resolveResumeThreadId, trackerApiErrorCode } from "@/lib/resumeExecutionSession";
import { workspaceScopesEqual, type WorkspaceScope } from "@/lib/workspaceScope";
import {
  buildWorkspaceCards,
  flattenWorkspaceCardsByRecency,
  formatBytes,
  isWorkspaceRemovable,
  linkedSessionThreadIds,
} from "@/lib/workspaceCards";
import { workspaceCloneRepoOptions } from "@/lib/workspaceCloneRepos";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import {
  NEW_ISSUE_TAB_ID,
  SESSIONS_LIST_TAB_ID,
  assistantSessionTabId,
  authoringSessionTabId,
  createAssistantSessionTab,
  createAuthoringSessionTab,
  createNewIssueTab,
  createSessionsListTab,
} from "@/lib/workspaceTabs/types";
import {
  sessionStatusIconKindFromScope,
} from "@/components/shared/ChatStatusIcon";
import {
  resolveIssueLinkedTabTitle,
  resolveWorkspaceTabPresentation,
  type WorkspaceTabPresentationContext,
  type WorkspaceTabStatusIcon,
} from "@/lib/workspaceTabs/presentation";
import {
  issuePath,
  projectAuthoringSessionPath,
  projectNewIssueWorkspacePath,
  projectSessionPath,
  projectSessionsPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import {
  archiveAssistantThread,
  deleteAssistantThread,
  getAssistantThread,
} from "@/services/assistantThreads";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { getIssue } from "@/services/issues";
import { removeWorkspaces } from "@/services/worktrees";
import { evictAssistantSessionCache } from "@/stores/assistantSessionStore";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

interface ProjectSessionsWorkspaceProps {
  projectSlug: string;
  activeThreadId?: number | null;
  activeExecutionIdentifier?: string | null;
  activeAuthoringIdentifier?: string | null;
  activeNewIssue?: boolean;
}

export function ProjectSessionsWorkspace({
  projectSlug,
  activeThreadId = null,
  activeExecutionIdentifier = null,
  activeAuthoringIdentifier = null,
  activeNewIssue = false,
}: ProjectSessionsWorkspaceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { view, project } = useWorkspace();
  const {
    relatedSessions,
    issues,
    executions,
    inventory,
    isLoading,
    isSessionsLoading,
    isInventoryLoading,
    error,
    refetch,
  } = useProjectSessions(projectSlug);
  const setSessionsChrome = useContext(ProjectSessionsChromeSetterContext);
  const [resumePending, setResumePending] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceRemoveTarget | null>(null);
  const [newSessionIssue, setNewSessionIssue] = useState<StartIssueSessionDialogIssue | null>(null);
  const [siblingCreating, setSiblingCreating] = useState(false);
  const siblingCreateInFlight = useRef(false);
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const canonicalTabs = useMemo(() => [createSessionsListTab(t("workspacesPage.title"))], [t]);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [terminalDockScope, setTerminalDockScope] = useState<WorkspaceScope | null>(null);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [previewDockScope, setPreviewDockScope] = useState<WorkspaceScope | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [environmentDockScope, setEnvironmentDockScope] = useState<WorkspaceScope | null>(null);
  const [tasksDockScope, setTasksDockScope] = useState<WorkspaceScope | null>(null);
  const [tasksFullscreen, setTasksFullscreen] = useState(false);

  const toggleTerminalDock = useCallback((scope: WorkspaceScope) => {
    setTerminalDockScope((current) => {
      const next = workspaceScopesEqual(current, scope) ? null : scope;
      if (next === null) setTerminalFullscreen(false);
      return next;
    });
    if (scope.kind === "thread") setTerminalFullscreen(false);
    // Only one dock at a time keeps the split layout readable.
    setPreviewDockScope(null);
    setPreviewFullscreen(false);
    setEnvironmentDockScope(null);
    setTasksDockScope(null);
    setTasksFullscreen(false);
  }, []);

  const closeTerminalDock = useCallback(() => {
    setTerminalDockScope(null);
    setTerminalFullscreen(false);
  }, []);

  const toggleTerminalFullscreen = useCallback(() => {
    setTerminalFullscreen((current) => !current);
  }, []);

  const togglePreviewDock = useCallback((scope: WorkspaceScope) => {
    setPreviewDockScope((current) => {
      const next = workspaceScopesEqual(current, scope) ? null : scope;
      if (next === null) setPreviewFullscreen(false);
      return next;
    });
    if (scope.kind === "thread") setPreviewFullscreen(false);
    setTerminalDockScope(null);
    setTerminalFullscreen(false);
    setEnvironmentDockScope(null);
    setTasksDockScope(null);
    setTasksFullscreen(false);
  }, []);

  const closePreviewDock = useCallback(() => {
    setPreviewDockScope(null);
    setPreviewFullscreen(false);
  }, []);

  const togglePreviewFullscreen = useCallback(() => {
    setPreviewFullscreen((current) => !current);
  }, []);

  const toggleEnvironmentDock = useCallback((scope: WorkspaceScope) => {
    setEnvironmentDockScope((current) => (workspaceScopesEqual(current, scope) ? null : scope));
    setTerminalDockScope(null);
    setTerminalFullscreen(false);
    setPreviewDockScope(null);
    setPreviewFullscreen(false);
    setTasksDockScope(null);
    setTasksFullscreen(false);
  }, []);

  const closeEnvironmentDock = useCallback(() => {
    setEnvironmentDockScope(null);
  }, []);

  const toggleTasksDock = useCallback((scope: WorkspaceScope) => {
    setTasksDockScope((current) => {
      const next = workspaceScopesEqual(current, scope) ? null : scope;
      if (next === null) setTasksFullscreen(false);
      return next;
    });
    setTerminalDockScope(null);
    setTerminalFullscreen(false);
    setPreviewDockScope(null);
    setPreviewFullscreen(false);
    setEnvironmentDockScope(null);
  }, []);

  const closeTasksDock = useCallback(() => {
    setTasksDockScope(null);
    setTasksFullscreen(false);
  }, []);

  const toggleTasksFullscreen = useCallback(() => {
    setTasksFullscreen((current) => !current);
  }, []);

  const terminalDockControls = useMemo(
    () => ({ openScope: terminalDockScope, toggleTerminal: toggleTerminalDock }),
    [terminalDockScope, toggleTerminalDock],
  );

  const previewDockControls = useMemo(
    () => ({ openScope: previewDockScope, togglePreview: togglePreviewDock }),
    [previewDockScope, togglePreviewDock],
  );

  const environmentDockControls = useMemo(
    () => ({ openScope: environmentDockScope, toggleEnvironment: toggleEnvironmentDock }),
    [environmentDockScope, toggleEnvironmentDock],
  );

  const tasksDockControls = useMemo(
    () => ({ openScope: tasksDockScope, toggleTasks: toggleTasksDock }),
    [tasksDockScope, toggleTasksDock],
  );

  const { tabs, activeTabId, activeTab, selectTab, openTab, closeTab } = useWorkspaceTabs({
    scope: "project-sessions",
    projectSlug,
    canonicalTabs,
    defaultActiveTabId: SESSIONS_LIST_TAB_ID,
  });

  const openAssistantSession = useCallback(
    (threadId: number, title: string) => {
      openTab(createAssistantSessionTab(threadId, title));
      navigate(projectSessionPath(projectSlug, threadId), { replace: true });
    },
    [navigate, openTab, projectSlug],
  );

  const handleCreateSiblingSession = useCallback(async () => {
    if (activeTab?.kind !== "assistant-session" || siblingCreateInFlight.current) return;

    siblingCreateInFlight.current = true;
    setSiblingCreating(true);
    try {
      const source = await getAssistantThread(activeTab.threadId);
      const created = await createSiblingSession({
        ...source,
        projectSlug: source.projectSlug?.trim() || projectSlug,
      });
      openAssistantSession(
        created.id,
        created.title?.trim() || t("sessions.newSessionTitle"),
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("sessions.createFailed"));
    } finally {
      siblingCreateInFlight.current = false;
      setSiblingCreating(false);
    }
  }, [activeTab, openAssistantSession, projectSlug, t]);

  const executionTitleLookup = useMemo(() => {
    const titles = new Map<string, string>();
    for (const issue of issues) titles.set(issue.identifier, issue.title);
    return titles;
  }, [issues]);

  const threadIssueLookup = useMemo(() => {
    const identifiers = new Map<number, string>();
    for (const session of relatedSessions) {
      if (session.threadId == null) continue;
      const identifier = session.identifier?.trim();
      if (identifier) identifiers.set(session.threadId, identifier);
    }
    return identifiers;
  }, [relatedSessions]);

  const threadStatusIconLookup = useMemo(() => {
    const icons = new Map<number, WorkspaceTabStatusIcon>();
    for (const session of relatedSessions) {
      if (session.threadId == null) continue;
      icons.set(session.threadId, {
        sessionKind: sessionStatusIconKindFromScope(session.scope),
        statusKind: session.statusKind,
        needsAttention: false,
      });
    }
    return icons;
  }, [relatedSessions]);

  const tabPresentationContext = useMemo<WorkspaceTabPresentationContext>(
    () => ({
      threadIssueIdentifiers: threadIssueLookup,
      issueTitles: executionTitleLookup,
      threadStatusIcons: threadStatusIconLookup,
    }),
    [executionTitleLookup, threadIssueLookup, threadStatusIconLookup],
  );

  const resolveTabPresentation = useCallback(
    (tab: (typeof tabs)[number]) => resolveWorkspaceTabPresentation(tab, tabPresentationContext),
    [tabPresentationContext],
  );

  const openAuthoringSession = useCallback(
    (session: AuthoringSessionRow) => {
      const tabTitle = resolveIssueLinkedTabTitle(session.issueIdentifier, session.title);
      openTab(createAuthoringSessionTab(session.issueIdentifier, tabTitle));
      navigate(projectAuthoringSessionPath(projectSlug, session.issueIdentifier), { replace: true });
    },
    [navigate, openTab, projectSlug],
  );

  const openRecentSession = useCallback(
    (session: RecentSession) => {
      if (session.threadId != null) {
        openAssistantSession(
          session.threadId,
          resolveIssueLinkedTabTitle(session.identifier, session.title),
        );
      }
    },
    [openAssistantSession],
  );

  const assistantTitleLookup = useMemo(() => {
    const titles = new Map<number, string>();
    for (const session of relatedSessions) {
      if (session.threadId == null) continue;
      const title = session.title.trim();
      if (title) titles.set(session.threadId, title);
    }
    return titles;
  }, [relatedSessions]);

  const fetchedAssistantTitlesRef = useRef<Map<number, string>>(new Map());
  const openedAssistantRef = useRef<number | null>(null);
  const suppressedAssistantCloseRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeThreadId) {
      openedAssistantRef.current = null;
      suppressedAssistantCloseRef.current = null;
      return;
    }

    if (suppressedAssistantCloseRef.current === activeThreadId) return;

    const fallback = t("sessions.newSessionTitle");
    const tabId = assistantSessionTabId(activeThreadId);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const issueIdentifier = threadIssueLookup.get(activeThreadId) ?? null;
    const knownTitle =
      assistantTitleLookup.get(activeThreadId) ??
      fetchedAssistantTitlesRef.current.get(activeThreadId) ??
      null;
    const resolvedTitle = resolveIssueLinkedTabTitle(issueIdentifier, knownTitle ?? fallback);

    if (knownTitle || issueIdentifier) {
      // Always openTab so route changes focus the matching tab even when the
      // title is unchanged (common now that issue-linked tabs use the identifier).
      if (existingTab?.title === resolvedTitle && activeTabId === tabId) {
        openedAssistantRef.current = activeThreadId;
        return;
      }
      openedAssistantRef.current = activeThreadId;
      openTab(createAssistantSessionTab(activeThreadId, resolvedTitle));
      return;
    }

    if (!existingTab || activeTabId !== tabId) {
      openTab(createAssistantSessionTab(activeThreadId, existingTab?.title || fallback));
    }

    let cancelled = false;
    void getAssistantThread(activeThreadId)
      .then((thread) => {
        if (cancelled) return;
        const title = thread.title?.trim() || fallback;
        fetchedAssistantTitlesRef.current.set(activeThreadId, title);
        openTab(
          createAssistantSessionTab(
            activeThreadId,
            resolveIssueLinkedTabTitle(thread.issueIdentifier, title),
          ),
        );
        openedAssistantRef.current = activeThreadId;
      })
      .catch(() => {
        if (cancelled) return;
        openedAssistantRef.current = activeThreadId;
      });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, activeThreadId, assistantTitleLookup, openTab, t, tabs, threadIssueLookup]);

  const openedAuthoringRef = useRef<string | null>(null);
  const suppressedAuthoringCloseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeAuthoringIdentifier) {
      openedAuthoringRef.current = null;
      suppressedAuthoringCloseRef.current = null;
      return;
    }

    if (suppressedAuthoringCloseRef.current === activeAuthoringIdentifier) return;

    const title = executionTitleLookup.get(activeAuthoringIdentifier) ?? activeAuthoringIdentifier;
    const tabId = authoringSessionTabId(activeAuthoringIdentifier);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const tabTitle = resolveIssueLinkedTabTitle(activeAuthoringIdentifier, title);
    const isActive = activeTabId === tabId;
    const titleMatches = existingTab?.title === tabTitle;

    // Deep links must focus the tab even when it already exists from persistence.
    if (isActive && titleMatches) {
      openedAuthoringRef.current = activeAuthoringIdentifier;
      return;
    }

    const waitingForTitle =
      isActive &&
      existingTab != null &&
      openedAuthoringRef.current === activeAuthoringIdentifier &&
      !executionTitleLookup.has(activeAuthoringIdentifier);
    if (waitingForTitle) return;

    openedAuthoringRef.current = activeAuthoringIdentifier;
    openTab(createAuthoringSessionTab(activeAuthoringIdentifier, tabTitle));
  }, [activeAuthoringIdentifier, activeTabId, executionTitleLookup, openTab, t, tabs]);

  const openedNewIssueRef = useRef(false);
  const suppressNewIssueOpenRef = useRef(false);
  useEffect(() => {
    if (!activeNewIssue) {
      openedNewIssueRef.current = false;
      suppressNewIssueOpenRef.current = false;
      return;
    }
    if (suppressNewIssueOpenRef.current) return;

    const tabTitle = t("issue.create.withAssistant");
    const existingTab = tabs.find((tab) => tab.id === NEW_ISSUE_TAB_ID);
    if (openedNewIssueRef.current && existingTab?.title === tabTitle && activeTabId === NEW_ISSUE_TAB_ID) {
      return;
    }

    openedNewIssueRef.current = true;
    openTab(createNewIssueTab(tabTitle));
  }, [activeNewIssue, activeTabId, openTab, t, tabs]);

  const handleNewIssueCreated = useCallback(
    (created: { identifier: string }) => {
      const identifier = created.identifier.trim();
      if (!identifier) return;

      // Prevent the ?new=1 effect from reopening the ephemeral tab before the
      // authoring deep link replaces it in the URL.
      suppressNewIssueOpenRef.current = true;
      closeTab(NEW_ISSUE_TAB_ID);
      const issue = issues.find((entry) => entry.identifier === identifier);
      openAuthoringSession({
        issueIdentifier: identifier,
        title: issue?.title ?? identifier,
        updatedAt: "",
        agentKind: null,
      });
    },
    [closeTab, issues, openAuthoringSession],
  );

  const openedExecutionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeExecutionIdentifier) {
      openedExecutionRef.current = null;
      return;
    }

    const resolvedId = resolveExecutionSessionId(
      Array.from(executions.values()),
      activeExecutionIdentifier,
    );
    if (resolvedId != null) {
      const title = executionTitleLookup.get(activeExecutionIdentifier) ?? activeExecutionIdentifier;
      const tabTitle = resolveIssueLinkedTabTitle(activeExecutionIdentifier, title);
      const target = projectSessionPath(projectSlug, resolvedId);
      openAssistantSession(resolvedId, tabTitle);
      openedExecutionRef.current = activeExecutionIdentifier;
      if (location.pathname !== target) {
        navigate(target, { replace: true });
      }
      return;
    }

    // Legacy `?exec=&surface=autonomous` is no longer a destination — drop it when
    // there is no orchestrator execution session to open.
    openedExecutionRef.current = null;
    if (location.search.includes("exec=")) {
      navigate(projectSessionsPath(projectSlug), { replace: true });
    }
  }, [
    activeExecutionIdentifier,
    executionTitleLookup,
    executions,
    location.pathname,
    location.search,
    navigate,
    openAssistantSession,
    projectSlug,
    t,
  ]);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      selectTab(tabId);
      const tab = tabs.find((entry) => entry.id === tabId);
      if (tab?.kind === "assistant-session") {
        navigate(projectSessionPath(projectSlug, tab.threadId), { replace: true });
        return;
      }
      if (tab?.kind === "authoring-session") {
        navigate(projectAuthoringSessionPath(projectSlug, tab.issueIdentifier), { replace: true });
        return;
      }
      if (tab?.kind === "new-issue") {
        navigate(projectNewIssueWorkspacePath(projectSlug), { replace: true });
        return;
      }
      if (tab?.kind === "sessions-list") {
        navigate(projectSessionsPath(projectSlug), { replace: true });
      }
    },
    [navigate, projectSlug, selectTab, tabs],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const closing = tabs.find((entry) => entry.id === tabId);
      if (closing?.kind === "assistant-session") {
        evictAssistantSessionCache(closing.threadId);
        if (activeThreadId === closing.threadId) {
          suppressedAssistantCloseRef.current = closing.threadId;
        }
      }
      if (closing?.kind === "authoring-session" && activeAuthoringIdentifier === closing.issueIdentifier) {
        suppressedAuthoringCloseRef.current = closing.issueIdentifier;
      }
      if (closing?.kind === "new-issue" && activeNewIssue) {
        suppressNewIssueOpenRef.current = true;
      }
      const closingActive = tabId === activeTabId;
      closeTab(tabId);
      if (closingActive) {
        navigate(projectSessionsPath(projectSlug), { replace: true });
      }
    },
    [
      activeAuthoringIdentifier,
      activeNewIssue,
      activeTabId,
      activeThreadId,
      closeTab,
      navigate,
      projectSlug,
      tabs,
    ],
  );

  async function handleResume(session: ProjectSessionRow) {
    setResumePending(session.issueIdentifier);
    try {
      const result = await dispatchIssueAgent(projectSlug, session.issueIdentifier, { action: "resume" });
      toast.success(result.message || t("sessions.resumeStarted", { identifier: session.issueIdentifier }));
      await refetch();
    } catch (cause) {
      if (trackerApiErrorCode(cause) === "already_running") {
        const threadId = resolveResumeThreadId(session.issueIdentifier, session, relatedSessions);
        if (threadId != null) {
          const tabTitle = resolveIssueLinkedTabTitle(session.issueIdentifier, session.title);
          openAssistantSession(threadId, tabTitle);
          toast.info(
            t("sessions.alreadyRunningOpened", {
              identifier: session.issueIdentifier,
              defaultValue: "{{identifier}} is already running — opened the live session.",
            }),
          );
          return;
        }
      }

      const message =
        axios.isAxiosError(cause) &&
        typeof (cause.response?.data as { error?: { message?: string } } | undefined)?.error?.message ===
          "string"
          ? ((cause.response?.data as { error: { message: string } }).error.message as string)
          : cause instanceof Error
            ? cause.message
            : t("sessions.resumeFailed", { identifier: session.issueIdentifier });
      toast.error(message);
    } finally {
      setResumePending(null);
    }
  }

  const handleArchive = useCallback(
    (threadId: number) => {
      void archiveChat(threadId);
    },
    [archiveChat],
  );

  const handleDelete = useCallback(
    (threadId: number) => {
      const confirmed = window.confirm(
        t("layout.sidebar.actions.deleteThreadEffect", {
          defaultValue: "Permanently delete this local thread and its history.",
        }),
      );
      if (!confirmed) return;

      void (async () => {
        try {
          await deleteAssistantThread(threadId);
          toast.success(
            t("workspacesPage.archive.deleteDone", {
              count: 1,
              defaultValue: "Deleted {{count}} sessions",
            }),
          );
          void refetch();
        } catch (cause) {
          toast.error(
            cause instanceof Error
              ? cause.message
              : t("workspacesPage.archive.deleteFailed", {
                  defaultValue: "Unable to delete sessions",
                }),
          );
        }
      })();
    },
    [refetch, t],
  );

  const cards = useMemo(
    () =>
      buildWorkspaceCards({
        executions: executions.values(),
        issues,
        relatedSessions,
        inventory: inventory?.entries ?? [],
      }),
    [executions, inventory, issues, relatedSessions],
  );
  const listItems = useMemo(() => flattenWorkspaceCardsByRecency(cards), [cards]);
  const total = listItems.length;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const allowedAssistantThreadIds = useMemo(() => {
    const ids = new Set<number>();
    if (activeThreadId != null) ids.add(activeThreadId);
    for (const session of relatedSessions) {
      if (session.threadId != null) ids.add(session.threadId);
    }
    for (const item of listItems) {
      if (item.kind !== "card") continue;
      for (const threadId of linkedSessionThreadIds(item.card)) ids.add(threadId);
    }
    return ids;
  }, [activeThreadId, listItems, relatedSessions]);

  const allowedIssueIdentifiers = useMemo(() => {
    const identifiers = new Set(issues.map((issue) => issue.identifier));
    if (activeAuthoringIdentifier) identifiers.add(activeAuthoringIdentifier);
    if (activeExecutionIdentifier) identifiers.add(activeExecutionIdentifier);
    return identifiers;
  }, [activeAuthoringIdentifier, activeExecutionIdentifier, issues]);

  useEffect(() => {
    // Wait for the project sessions index only — global recents can lag and
    // would otherwise leave cross-project tabs visible indefinitely.
    if (isSessionsLoading) return;

    for (const tab of tabs) {
      if (!tab.closable) continue;

      const outOfProject =
        (tab.kind === "assistant-session" && !allowedAssistantThreadIds.has(tab.threadId)) ||
        (tab.kind === "authoring-session" && !allowedIssueIdentifiers.has(tab.issueIdentifier));

      if (outOfProject) closeTab(tab.id);
    }
  }, [allowedAssistantThreadIds, allowedIssueIdentifiers, closeTab, isSessionsLoading, tabs]);

  useEffect(() => {
    if (listItems.length === 0) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey((current) =>
      current && listItems.some((item) => item.key === current) ? current : null,
    );
  }, [listItems]);

  function toggleExpanded(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  const cloneRepos = useMemo(() => {
    const projectEntry = inventory?.entries.find((entry) => entry.kind === "project");
    return workspaceCloneRepoOptions(projectEntry?.repos ?? [], project?.repositories);
  }, [inventory, project?.repositories]);

  const requestRemoveWorkspace = useCallback(
    (path: string) => {
      const item = listItems.find(
        (entry) => entry.kind === "card" && entry.card.inventory?.path === path,
      );
      if (!item || item.kind !== "card" || !isWorkspaceRemovable(item.card)) {
        toast.warning(t("workspacesPage.cleanup.blockedExecution"));
        return;
      }
      const inventory = item.card.inventory!;
      setRemoveTarget({
        path: inventory.path,
        title:
          item.card.title ||
          item.card.issueIdentifier ||
          inventory.path,
        sizeBytes: inventory.sizeBytes,
        workPresent: inventory.workPresent,
        threadIds: linkedSessionThreadIds(item.card),
      });
    },
    [listItems, t],
  );

  const confirmRemoveWorkspace = useCallback(
    async (target: WorkspaceRemoveTarget) => {
      try {
        const results = await removeWorkspaces(projectSlug, [target.path]);
        const skipped = results.find((result) => result.status === "skipped");
        if (skipped) {
          toast.warning(skipped.reason ?? t("workspacesPage.cleanup.failed"));
          return;
        }
        await Promise.all(
          target.threadIds.map(async (threadId) => {
            try {
              await archiveAssistantThread(threadId);
            } catch {
              // Tree removal already succeeded; session archive is best-effort.
            }
          }),
        );
        toast.success(
          t("workspacesPage.removeWorkspace.done", {
            defaultValue: "Workspace removed",
          }),
        );
        await refetch();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("workspacesPage.cleanup.failed"));
        throw cause;
      }
    },
    [projectSlug, refetch, t],
  );

  const handleNewSession = useCallback(
    (issueIdentifier: string) => {
      const issue = issues.find((entry) => entry.identifier === issueIdentifier);
      setNewSessionIssue({
        identifier: issueIdentifier,
        title: issue?.title ?? issueIdentifier,
        agentKind: executions.get(issueIdentifier)?.agentKind ?? null,
        parentIdentifier: issue?.parentIdentifier ?? null,
      });
    },
    [executions, issues],
  );

  useEffect(() => {
    if (!setSessionsChrome) return;

    setSessionsChrome({ count: total });

    return () => {
      setSessionsChrome(null);
    };
  }, [setSessionsChrome, total]);

  return (
    <SessionTerminalDockContext.Provider value={terminalDockControls}>
    <SessionPreviewDockContext.Provider value={previewDockControls}>
    <SessionEnvironmentDockContext.Provider value={environmentDockControls}>
    <SessionTasksDockContext.Provider value={tasksDockControls}>
    <SessionTasksDockFeedProvider>
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-background p-2 sm:p-3">
      <div
        ref={splitContainerRef}
        className="flex h-full min-h-0 w-full gap-3 overflow-hidden"
      >
      <section
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden",
          (terminalFullscreen || previewFullscreen || tasksFullscreen) && "hidden",
        )}
      >
        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          ariaLabel={t("workspace.sessions.tabsAria")}
          shortcutHints
          resolveTabPresentation={resolveTabPresentation}
          trailing={
            activeTab?.kind === "assistant-session" ? (
              <button
                type="button"
                aria-label={t("sessions.newSession")}
                title={t("sessions.newSession")}
                disabled={siblingCreating}
                onClick={() => void handleCreateSiblingSession()}
                className={sessionToolbarIconButtonClassName}
                data-testid="sibling-session-button"
              >
                {siblingCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
              </button>
            ) : null
          }
        />
        {error ? <p className="shrink-0 px-1 text-sm text-destructive">{error}</p> : null}

        {activeTab?.kind === "sessions-list" ? (
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 overflow-hidden xl:max-w-4xl">
            <div className="flex shrink-0 items-start justify-between gap-3 px-1">
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-foreground">{t("workspacesPage.title")}</p>
                <p className="text-xs text-muted-foreground">
                  {inventory
                    ? isInventoryLoading
                      ? t("workspacesPage.totalsLoading", {
                          count: inventory.totals.count,
                          size: formatBytes(inventory.totals.sizeBytes),
                        })
                      : t("workspacesPage.toolbarSummary", {
                          count: inventory.totals.count,
                          size: formatBytes(inventory.totals.sizeBytes),
                          defaultValue: "{{count}} trees · {{size}}",
                        })
                    : isInventoryLoading
                      ? t("workspacesPage.inventoryLoading")
                      : t("workspacesPage.toolbarSummaryEmpty", {
                          defaultValue: "No inventory yet",
                        })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <WorkspaceActionButton
                  icon={<FolderPlus {...workspaceActionIconProps} aria-hidden />}
                  onClick={() => setNewWorkspaceOpen(true)}
                >
                  {t("workspacesPage.newWorkspace.button")}
                </WorkspaceActionButton>
                <WorkspaceActionButton
                  icon={<Archive {...workspaceActionIconProps} aria-hidden />}
                  onClick={() => setArchiveOpen(true)}
                >
                  {t("workspacesPage.archive.button", { defaultValue: "Archive…" })}
                </WorkspaceActionButton>
                {inventory && !isInventoryLoading ? (
                  <WorkspaceActionButton
                    icon={<Trash2 {...workspaceActionIconProps} aria-hidden />}
                    onClick={() => setCleanupOpen(true)}
                  >
                    {t("workspacesPage.cleanup.button")}
                  </WorkspaceActionButton>
                ) : null}
              </div>
            </div>

            {isLoading && total === 0 ? (
              <EmptyState variant="simple">{t("sessions.loading")}</EmptyState>
            ) : null}

            {!isLoading && total === 0 && !isInventoryLoading ? (
              <EmptyState variant="simple">{t("sessions.empty")}</EmptyState>
            ) : null}

            {total > 0 ? (
              <div
                className={cn("min-h-0 flex-1 overflow-y-auto p-0.5", SCROLLBAR_THIN)}
                role="list"
                aria-label={t("workspacesPage.title")}
              >
                <ul className="w-full space-y-0.5">
                  {listItems.map((item) => (
                    <li key={item.key}>
                      <WorkspaceAccordionItem
                        item={item}
                        expanded={item.key === expandedKey}
                        issueHref={
                          item.kind === "card" && item.card.issueIdentifier
                            ? issuePath(projectSlug, view, item.card.issueIdentifier, "sessions")
                            : null
                        }
                        resumePending={
                          item.kind === "card" ? resumePending === item.card.issueIdentifier : false
                        }
                        archiving={archiving}
                        onToggle={() => toggleExpanded(item.key)}
                        onOpenSession={openRecentSession}
                        onOpenAssistantSession={openAssistantSession}
                        onResume={handleResume}
                        onNewSession={handleNewSession}
                        onRemove={requestRemoveWorkspace}
                        onArchive={handleArchive}
                        onDelete={handleDelete}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Keep every open assistant session mounted (hidden when inactive) so
            switching tabs does not tear down the Phoenix channel mid-turn. */}
        {tabs
          .filter((tab): tab is Extract<typeof tab, { kind: "assistant-session" }> => tab.kind === "assistant-session")
          .map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "min-h-0 flex-1 flex-col overflow-hidden",
                activeTabId === tab.id ? "flex" : "hidden",
              )}
              aria-hidden={activeTabId !== tab.id}
            >
              <AssistantSessionTabContent
                projectSlug={projectSlug}
                threadId={tab.threadId}
                view={view}
                relatedSessions={relatedSessions}
              />
            </div>
          ))}

        {activeTab?.kind === "authoring-session" ? (
          <AuthoringSessionTabContent
            projectSlug={projectSlug}
            issueIdentifier={activeTab.issueIdentifier}
            issue={issues.find((entry) => entry.identifier === activeTab.issueIdentifier) ?? null}
            view={view}
            isLoading={isLoading}
          />
        ) : null}

        {activeTab?.kind === "new-issue" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <IssueAuthoringPanel
              projectSlug={projectSlug}
              view={view}
              compact
              onIssueCreated={handleNewIssueCreated}
            />
          </div>
        ) : null}

      </section>

      {terminalDockScope ? (
        <IssueTerminalDock
          scope={terminalDockScope}
          splitContainerRef={splitContainerRef}
          fullscreen={terminalFullscreen}
          onToggleFullscreen={toggleTerminalFullscreen}
          onClose={closeTerminalDock}
        />
      ) : null}

      {previewDockScope ? (
        <IssuePreviewDock
          scope={previewDockScope}
          view={view}
          execution={
            previewDockScope.kind === "issue"
              ? executions.get(previewDockScope.issueIdentifier)
              : undefined
          }
          splitContainerRef={splitContainerRef}
          fullscreen={previewFullscreen}
          onToggleFullscreen={togglePreviewFullscreen}
          onClose={closePreviewDock}
        />
      ) : null}

      {environmentDockScope ? (
        <IssueEnvironmentDock
          scope={environmentDockScope}
          splitContainerRef={splitContainerRef}
          onClose={closeEnvironmentDock}
        />
      ) : null}

      {tasksDockScope ? (
        <IssueTasksDock
          scope={tasksDockScope}
          splitContainerRef={splitContainerRef}
          fullscreen={tasksFullscreen}
          onToggleFullscreen={toggleTasksFullscreen}
          onClose={closeTasksDock}
        />
      ) : null}
      </div>

      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={newSessionIssue}
        cloneRepos={cloneRepos}
        open={newSessionIssue !== null}
        onOpenChange={(open) => {
          if (!open) setNewSessionIssue(null);
        }}
        view={view}
        navigateToProjectSession
        onCreated={() => void refetch()}
      />

      <WorkspaceRemoveDialog
        target={removeTarget}
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={confirmRemoveWorkspace}
      />

      <WorkspaceArchiveDialog
        sessions={relatedSessions}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        onDone={() => void refetch()}
      />

      {inventory ? (
        <WorkspaceCleanupDialog
          projectSlug={projectSlug}
          entries={inventory.entries}
          open={cleanupOpen}
          onOpenChange={setCleanupOpen}
          onCleaned={() => void refetch()}
        />
      ) : null}

      <NewStandaloneWorkspaceDialog
        projectSlug={projectSlug}
        cloneRepos={cloneRepos}
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        onCreated={(_, threadId) => {
          void refetch();
          navigate(projectSessionPath(projectSlug, threadId), { replace: true });
        }}
      />
    </main>
    </SessionTasksDockFeedProvider>
    </SessionTasksDockContext.Provider>
    </SessionEnvironmentDockContext.Provider>
    </SessionPreviewDockContext.Provider>
    </SessionTerminalDockContext.Provider>
  );
}

function useResolvedIssue(
  projectSlug: string,
  issueIdentifier: string,
  issueFromList: Issue | null,
): { issue: Issue | null; loading: boolean } {
  const [fetchedIssue, setFetchedIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (issueFromList) {
      setFetchedIssue(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchedIssue(null);

    void getIssue(projectSlug, issueIdentifier)
      .then((issue) => {
        if (!cancelled) setFetchedIssue(issue);
      })
      .catch(() => {
        if (!cancelled) setFetchedIssue(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [issueFromList, issueIdentifier, projectSlug]);

  if (issueFromList) return { issue: issueFromList, loading: false };
  return { issue: fetchedIssue, loading };
}

function AuthoringSessionTabContent({
  projectSlug,
  issueIdentifier,
  issue,
  view,
  isLoading,
}: {
  projectSlug: string;
  issueIdentifier: string;
  issue: Issue | null;
  view: WorkspaceView;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const resolved = useResolvedIssue(projectSlug, issueIdentifier, issue);

  if (!resolved.issue) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        {isLoading || resolved.loading
          ? t("sessions.loading")
          : t("sessions.executionUnavailable", { identifier: issueIdentifier })}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <IssueAuthoringSessionPanel issue={resolved.issue} projectSlug={projectSlug} view={view} />
    </section>
  );
}


