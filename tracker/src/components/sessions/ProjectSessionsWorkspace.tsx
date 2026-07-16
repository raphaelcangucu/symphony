import { Archive, FolderPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IssueEnvironmentDock } from "@/components/sessions/IssueEnvironmentDock";
import { IssuePreviewDock } from "@/components/sessions/IssuePreviewDock";
import { IssueTerminalDock } from "@/components/sessions/IssueTerminalDock";
import { SessionEnvironmentDockContext } from "@/components/sessions/sessionEnvironmentDockContext";
import { SessionPreviewDockContext } from "@/components/sessions/sessionPreviewDockContext";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ProjectSessionsChromeSetterContext } from "@/components/layout/ProjectSessionsChromeContext";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { IssueAuthoringSessionPanel } from "@/components/issues/issue-detail/IssueAuthoringSessionPanel";
import { IssueExecutionSessionPanel } from "@/components/issues/issue-detail/IssueExecutionSessionPanel";
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
  SESSIONS_LIST_TAB_ID,
  assistantSessionTabId,
  authoringSessionTabId,
  createAssistantSessionTab,
  createAuthoringSessionTab,
  createExecutionSessionTab,
  createSessionsListTab,
  executionSessionTabId,
} from "@/lib/workspaceTabs/types";
import {
  issuePath,
  projectAuthoringSessionPath,
  projectExecutionSessionPath,
  projectSessionPath,
  projectSessionsPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import { archiveAssistantThread, getAssistantThread } from "@/services/assistantThreads";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { removeWorkspaces } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

interface ProjectSessionsWorkspaceProps {
  projectSlug: string;
  activeThreadId?: number | null;
  activeExecutionIdentifier?: string | null;
  activeAuthoringIdentifier?: string | null;
}

export function ProjectSessionsWorkspace({
  projectSlug,
  activeThreadId = null,
  activeExecutionIdentifier = null,
  activeAuthoringIdentifier = null,
}: ProjectSessionsWorkspaceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { view, project } = useWorkspace();
  const { relatedSessions, issues, executions, inventory, isLoading, isInventoryLoading, error, refetch } =
    useProjectSessions(projectSlug);
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
  const [terminalDockIssue, setTerminalDockIssue] = useState<string | null>(null);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [previewDockIssue, setPreviewDockIssue] = useState<string | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [environmentDockIssue, setEnvironmentDockIssue] = useState<string | null>(null);

  const toggleTerminalDock = useCallback((issueIdentifier: string) => {
    setTerminalDockIssue((current) => {
      const next = current === issueIdentifier ? null : issueIdentifier;
      if (next === null) setTerminalFullscreen(false);
      return next;
    });
    // Only one dock at a time keeps the split layout readable.
    setPreviewDockIssue(null);
    setPreviewFullscreen(false);
    setEnvironmentDockIssue(null);
  }, []);

  const closeTerminalDock = useCallback(() => {
    setTerminalDockIssue(null);
    setTerminalFullscreen(false);
  }, []);

  const toggleTerminalFullscreen = useCallback(() => {
    setTerminalFullscreen((current) => !current);
  }, []);

  const togglePreviewDock = useCallback((issueIdentifier: string) => {
    setPreviewDockIssue((current) => {
      const next = current === issueIdentifier ? null : issueIdentifier;
      if (next === null) setPreviewFullscreen(false);
      return next;
    });
    setTerminalDockIssue(null);
    setTerminalFullscreen(false);
    setEnvironmentDockIssue(null);
  }, []);

  const closePreviewDock = useCallback(() => {
    setPreviewDockIssue(null);
    setPreviewFullscreen(false);
  }, []);

  const togglePreviewFullscreen = useCallback(() => {
    setPreviewFullscreen((current) => !current);
  }, []);

  const toggleEnvironmentDock = useCallback((issueIdentifier: string) => {
    setEnvironmentDockIssue((current) => (current === issueIdentifier ? null : issueIdentifier));
    setTerminalDockIssue(null);
    setTerminalFullscreen(false);
    setPreviewDockIssue(null);
    setPreviewFullscreen(false);
  }, []);

  const closeEnvironmentDock = useCallback(() => {
    setEnvironmentDockIssue(null);
  }, []);

  const terminalDockControls = useMemo(
    () => ({ openIssueIdentifier: terminalDockIssue, toggleTerminal: toggleTerminalDock }),
    [terminalDockIssue, toggleTerminalDock],
  );

  const previewDockControls = useMemo(
    () => ({ openIssueIdentifier: previewDockIssue, togglePreview: togglePreviewDock }),
    [previewDockIssue, togglePreviewDock],
  );

  const environmentDockControls = useMemo(
    () => ({ openIssueIdentifier: environmentDockIssue, toggleEnvironment: toggleEnvironmentDock }),
    [environmentDockIssue, toggleEnvironmentDock],
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

  const openAuthoringSession = useCallback(
    (session: AuthoringSessionRow) => {
      const tabTitle = `${session.title} · ${t("issue.agentTabs.authoring")}`;
      openTab(createAuthoringSessionTab(session.issueIdentifier, tabTitle));
      navigate(projectAuthoringSessionPath(projectSlug, session.issueIdentifier), { replace: true });
    },
    [navigate, openTab, projectSlug, t],
  );

  const openExecutionSession = useCallback(
    (session: ProjectSessionRow) => {
      const tabTitle = `${session.title} · ${t("issue.agentTabs.execution")}`;
      openTab(createExecutionSessionTab(session.issueIdentifier, tabTitle));
      navigate(projectExecutionSessionPath(projectSlug, session.issueIdentifier), { replace: true });
    },
    [navigate, openTab, projectSlug, t],
  );

  const openAuthoringByIdentifier = useCallback(
    (issueIdentifier: string) => {
      const issue = issues.find((entry) => entry.identifier === issueIdentifier);
      openAuthoringSession({
        issueIdentifier,
        title: issue?.title ?? issueIdentifier,
        updatedAt: "",
        agentKind: null,
      });
    },
    [issues, openAuthoringSession],
  );

  const openRecentSession = useCallback(
    (session: RecentSession) => {
      if (session.threadId != null) {
        openAssistantSession(session.threadId, session.title);
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

  useEffect(() => {
    if (!activeThreadId) {
      openedAssistantRef.current = null;
      return;
    }

    const fallback = t("sessions.newSessionTitle");
    const tabId = assistantSessionTabId(activeThreadId);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const knownTitle =
      assistantTitleLookup.get(activeThreadId) ??
      fetchedAssistantTitlesRef.current.get(activeThreadId) ??
      null;

    if (knownTitle) {
      if (existingTab?.title === knownTitle) return;
      openedAssistantRef.current = activeThreadId;
      openTab(createAssistantSessionTab(activeThreadId, knownTitle));
      return;
    }

    if (!existingTab) {
      openTab(createAssistantSessionTab(activeThreadId, fallback));
    }

    let cancelled = false;
    void getAssistantThread(activeThreadId)
      .then((thread) => {
        if (cancelled) return;
        const title = thread.title?.trim() || fallback;
        fetchedAssistantTitlesRef.current.set(activeThreadId, title);
        openTab(createAssistantSessionTab(activeThreadId, title));
        openedAssistantRef.current = activeThreadId;
      })
      .catch(() => {
        if (cancelled) return;
        openedAssistantRef.current = activeThreadId;
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId, assistantTitleLookup, openTab, t, tabs]);

  const executionTitleLookup = useMemo(() => {
    const titles = new Map<string, string>();
    for (const issue of issues) titles.set(issue.identifier, issue.title);
    return titles;
  }, [issues]);

  const openedAuthoringRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeAuthoringIdentifier) {
      openedAuthoringRef.current = null;
      return;
    }

    const title = executionTitleLookup.get(activeAuthoringIdentifier) ?? activeAuthoringIdentifier;
    const tabId = authoringSessionTabId(activeAuthoringIdentifier);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const tabTitle = `${title} · ${t("issue.agentTabs.authoring")}`;
    const hasOpenedFallback =
      openedAuthoringRef.current === activeAuthoringIdentifier &&
      !executionTitleLookup.has(activeAuthoringIdentifier) &&
      existingTab != null;
    if (hasOpenedFallback || existingTab?.title === tabTitle) return;

    openedAuthoringRef.current = activeAuthoringIdentifier;
    openTab(createAuthoringSessionTab(activeAuthoringIdentifier, tabTitle));
  }, [activeAuthoringIdentifier, executionTitleLookup, openTab, t, tabs]);

  const openedExecutionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeExecutionIdentifier) {
      openedExecutionRef.current = null;
      return;
    }

    const title = executionTitleLookup.get(activeExecutionIdentifier) ?? activeExecutionIdentifier;
    const tabId = executionSessionTabId(activeExecutionIdentifier);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const tabTitle = `${title} · ${t("issue.agentTabs.execution")}`;
    const hasOpenedFallback =
      openedExecutionRef.current === activeExecutionIdentifier &&
      !executionTitleLookup.has(activeExecutionIdentifier) &&
      existingTab != null;
    if (hasOpenedFallback || existingTab?.title === tabTitle) return;

    openedExecutionRef.current = activeExecutionIdentifier;
    openTab(createExecutionSessionTab(activeExecutionIdentifier, tabTitle));
  }, [activeExecutionIdentifier, executionTitleLookup, openTab, t, tabs]);

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
      if (tab?.kind === "execution-session") {
        navigate(projectExecutionSessionPath(projectSlug, tab.issueIdentifier), { replace: true });
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
      const closingActive = tabId === activeTabId;
      closeTab(tabId);
      if (closingActive) {
        navigate(projectSessionsPath(projectSlug), { replace: true });
      }
    },
    [activeTabId, closeTab, navigate, projectSlug],
  );

  async function handleResume(session: ProjectSessionRow) {
    setResumePending(session.issueIdentifier);
    try {
      const result = await dispatchIssueAgent(projectSlug, session.issueIdentifier, { action: "resume" });
      toast.success(result.message || t("sessions.resumeStarted", { identifier: session.issueIdentifier }));
      await refetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("sessions.resumeFailed", { identifier: session.issueIdentifier }));
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
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-background p-2 sm:p-3">
      <div
        ref={splitContainerRef}
        className="flex h-full min-h-0 w-full gap-3 overflow-hidden"
      >
      <section
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden",
          (terminalFullscreen || previewFullscreen) && "hidden",
        )}
      >
        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          ariaLabel={t("workspace.sessions.tabsAria")}
          shortcutHints
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
                        onOpenExecution={openExecutionSession}
                        onOpenAuthoring={openAuthoringByIdentifier}
                        onOpenSession={openRecentSession}
                        onOpenAssistantSession={openAssistantSession}
                        onResume={handleResume}
                        onNewSession={handleNewSession}
                        onRemove={requestRemoveWorkspace}
                        onArchive={handleArchive}
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

        {activeTab?.kind === "execution-session" ? (
          <ExecutionSessionTabContent
            projectSlug={projectSlug}
            issueIdentifier={activeTab.issueIdentifier}
            issue={issues.find((entry) => entry.identifier === activeTab.issueIdentifier) ?? null}
            execution={executions.get(activeTab.issueIdentifier)}
            executions={executions}
            view={view}
            isLoading={isLoading}
            onIssueUpdated={() => void refetch()}
          />
        ) : null}
      </section>

      {terminalDockIssue ? (
        <IssueTerminalDock
          projectSlug={projectSlug}
          issueIdentifier={terminalDockIssue}
          splitContainerRef={splitContainerRef}
          fullscreen={terminalFullscreen}
          onToggleFullscreen={toggleTerminalFullscreen}
          onClose={closeTerminalDock}
        />
      ) : null}

      {previewDockIssue ? (
        <IssuePreviewDock
          projectSlug={projectSlug}
          issueIdentifier={previewDockIssue}
          view={view}
          execution={executions.get(previewDockIssue)}
          splitContainerRef={splitContainerRef}
          fullscreen={previewFullscreen}
          onToggleFullscreen={togglePreviewFullscreen}
          onClose={closePreviewDock}
        />
      ) : null}

      {environmentDockIssue ? (
        <IssueEnvironmentDock
          projectSlug={projectSlug}
          issueIdentifier={environmentDockIssue}
          view={view}
          splitContainerRef={splitContainerRef}
          onClose={closeEnvironmentDock}
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
    </SessionEnvironmentDockContext.Provider>
    </SessionPreviewDockContext.Provider>
    </SessionTerminalDockContext.Provider>
  );
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

  if (!issue) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        {isLoading ? t("sessions.loading") : t("sessions.executionUnavailable", { identifier: issueIdentifier })}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <IssueAuthoringSessionPanel issue={issue} projectSlug={projectSlug} view={view} />
    </section>
  );
}

function ExecutionSessionTabContent({
  projectSlug,
  issueIdentifier,
  issue,
  execution,
  executions,
  view,
  isLoading,
  onIssueUpdated,
}: {
  projectSlug: string;
  issueIdentifier: string;
  issue: Issue | null;
  execution?: AgentExecution;
  executions: ReadonlyMap<string, AgentExecution>;
  view: WorkspaceView;
  isLoading: boolean;
  onIssueUpdated: (updated: Issue) => void;
}) {
  const { t } = useTranslation();
  const allExecutions = useMemo(() => Array.from(executions.values()), [executions]);

  if (!issue) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        {isLoading ? t("sessions.loading") : t("sessions.executionUnavailable", { identifier: issueIdentifier })}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <IssueExecutionSessionPanel
        issue={issue}
        projectSlug={projectSlug}
        execution={execution}
        executions={allExecutions}
        view={view}
        onIssueUpdated={onIssueUpdated}
      />
    </section>
  );
}

