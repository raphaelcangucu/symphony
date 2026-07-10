import { Clock, FolderPlus, MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IssuePreviewDock } from "@/components/sessions/IssuePreviewDock";
import { IssueTerminalDock } from "@/components/sessions/IssueTerminalDock";
import { SessionPreviewDockContext } from "@/components/sessions/sessionPreviewDockContext";
import { SessionTerminalDockContext } from "@/components/sessions/sessionTerminalDockContext";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { ProjectSessionsChromeSetterContext } from "@/components/layout/ProjectSessionsChromeContext";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { IssueAuthoringSessionPanel } from "@/components/issues/issue-detail/IssueAuthoringSessionPanel";
import { IssueExecutionSessionPanel } from "@/components/issues/issue-detail/IssueExecutionSessionPanel";
import { NewStandaloneWorkspaceDialog } from "@/components/sessions/NewStandaloneWorkspaceDialog";
import { type AuthoringSessionRow } from "@/components/sessions/SessionListItem";
import { StartIssueSessionDialog, type StartIssueSessionDialogIssue } from "@/components/sessions/StartIssueSessionDialog";
import { WorkspaceCardItem } from "@/components/sessions/WorkspaceCardItem";
import { WorkspaceCleanupDialog } from "@/components/sessions/WorkspaceCleanupDialog";
import { RecentSessionBadges } from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { type ProjectSessionRow } from "@/lib/projectSessions";
import { buildWorkspaceCards, formatBytes, type WorkspaceCard } from "@/lib/workspaceCards";
import { cn, formatDateTime, SCROLLBAR_THIN } from "@/lib/utils";
import {
  SESSIONS_LIST_TAB_ID,
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
  const { view } = useWorkspace();
  const { relatedSessions, issues, executions, inventory, isLoading, isInventoryLoading, error, refetch } =
    useProjectSessions(projectSlug);
  const setSessionsChrome = useContext(ProjectSessionsChromeSetterContext);
  const [resumePending, setResumePending] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newSessionIssue, setNewSessionIssue] = useState<StartIssueSessionDialogIssue | null>(null);
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const canonicalTabs = useMemo(() => [createSessionsListTab(t("workspacesPage.title"))], [t]);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [terminalDockIssue, setTerminalDockIssue] = useState<string | null>(null);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [previewDockIssue, setPreviewDockIssue] = useState<string | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  const toggleTerminalDock = useCallback((issueIdentifier: string) => {
    setTerminalDockIssue((current) => {
      const next = current === issueIdentifier ? null : issueIdentifier;
      if (next === null) setTerminalFullscreen(false);
      return next;
    });
    // Only one dock at a time keeps the split layout readable.
    setPreviewDockIssue(null);
    setPreviewFullscreen(false);
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
  }, []);

  const closePreviewDock = useCallback(() => {
    setPreviewDockIssue(null);
    setPreviewFullscreen(false);
  }, []);

  const togglePreviewFullscreen = useCallback(() => {
    setPreviewFullscreen((current) => !current);
  }, []);

  const terminalDockControls = useMemo(
    () => ({ openIssueIdentifier: terminalDockIssue, toggleTerminal: toggleTerminalDock }),
    [terminalDockIssue, toggleTerminalDock],
  );

  const previewDockControls = useMemo(
    () => ({ openIssueIdentifier: previewDockIssue, togglePreview: togglePreviewDock }),
    [previewDockIssue, togglePreviewDock],
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

  useEffect(() => {
    if (!activeThreadId) return;
    openTab(createAssistantSessionTab(activeThreadId, t("sessions.newSessionTitle")));
  }, [activeThreadId, openTab, t]);

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
  const total =
    cards.projectCards.length +
    cards.activeCards.length +
    cards.waitingCards.length +
    cards.orphanCards.length +
    cards.chatSessions.length;

  const projectRepos = useMemo(() => {
    const projectEntry = inventory?.entries.find((entry) => entry.kind === "project");
    return projectEntry?.repos ?? [];
  }, [inventory]);

  const handleRemoveWorkspace = useCallback(
    async (path: string) => {
      try {
        const results = await removeWorkspaces(projectSlug, [path]);
        const skipped = results.find((result) => result.status === "skipped");
        if (skipped) {
          toast.warning(skipped.reason ?? t("workspacesPage.cleanup.failed"));
        }
        await refetch();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("workspacesPage.cleanup.failed"));
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
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-2 sm:p-3">
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
        />
        {error ? <p className="shrink-0 px-1 text-sm text-destructive">{error}</p> : null}

        {activeTab?.kind === "sessions-list" ? (
          <div className={cn("min-h-0 flex-1 overflow-y-auto", SCROLLBAR_THIN)}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  {t("workspacesPage.inventoryLabel")}
                </span>
                {inventory ? (
                  <>
                    <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80">
                      {isInventoryLoading
                        ? t("workspacesPage.totalsLoading", {
                            count: inventory.totals.count,
                            size: formatBytes(inventory.totals.sizeBytes),
                          })
                        : t("workspacesPage.totalsTrees", { count: inventory.totals.count })}
                    </span>
                    {!isInventoryLoading ? (
                      <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80">
                        {t("workspacesPage.totalsSize", { size: formatBytes(inventory.totals.sizeBytes) })}
                      </span>
                    ) : null}
                    {!isInventoryLoading && inventory.totals.reclaimableBytes > 0 ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                        {t("workspacesPage.totalsReclaimable", {
                          reclaimable: formatBytes(inventory.totals.reclaimableBytes),
                        })}
                      </span>
                    ) : null}
                  </>
                ) : isInventoryLoading ? (
                  <span className="text-xs text-muted-foreground">{t("workspacesPage.inventoryLoading")}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setNewWorkspaceOpen(true)}>
                  <FolderPlus className="h-3.5 w-3.5" />
                  {t("workspacesPage.newWorkspace.button")}
                </Button>
                {inventory && !isInventoryLoading ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCleanupOpen(true)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("workspacesPage.cleanup.button")}
                  </Button>
                ) : null}
              </div>
            </div>

            {isLoading && total === 0 ? (
              <EmptyState variant="simple">{t("sessions.loading")}</EmptyState>
            ) : null}

            {!isLoading && total === 0 && !isInventoryLoading ? (
              <EmptyState variant="simple">{t("sessions.empty")}</EmptyState>
            ) : null}

            <div className="space-y-4">
              <WorkspaceCardSection
                title={t("workspacesPage.sections.project")}
                cards={cards.projectCards}
                projectSlug={projectSlug}
                view={view}
                resumePending={resumePending}
                onOpenExecution={openExecutionSession}
                onOpenAuthoring={openAuthoringByIdentifier}
                onOpenSession={openRecentSession}
                onResume={handleResume}
                onNewSession={handleNewSession}
                onRemove={handleRemoveWorkspace}
              />
              <WorkspaceCardSection
                title={t("workspacesPage.sections.active")}
                cards={cards.activeCards}
                projectSlug={projectSlug}
                view={view}
                resumePending={resumePending}
                onOpenExecution={openExecutionSession}
                onOpenAuthoring={openAuthoringByIdentifier}
                onOpenSession={openRecentSession}
                onResume={handleResume}
                onNewSession={handleNewSession}
                onRemove={handleRemoveWorkspace}
              />
              <WorkspaceCardSection
                title={t("workspacesPage.sections.waiting")}
                cards={cards.waitingCards}
                projectSlug={projectSlug}
                view={view}
                resumePending={resumePending}
                onOpenExecution={openExecutionSession}
                onOpenAuthoring={openAuthoringByIdentifier}
                onOpenSession={openRecentSession}
                onResume={handleResume}
                onNewSession={handleNewSession}
                onRemove={handleRemoveWorkspace}
              />
              <WorkspaceCardSection
                title={t("workspacesPage.sections.orphans")}
                cards={cards.orphanCards}
                projectSlug={projectSlug}
                view={view}
                resumePending={resumePending}
                onOpenExecution={openExecutionSession}
                onOpenAuthoring={openAuthoringByIdentifier}
                onOpenSession={openRecentSession}
                onResume={handleResume}
                onNewSession={handleNewSession}
                onRemove={handleRemoveWorkspace}
              />

              {cards.chatSessions.length > 0 ? (
                <section>
                  <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">
                    {t("workspacesPage.sections.chats")}
                  </h2>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {cards.chatSessions.map((session) => (
                      <RelatedSessionCard
                        key={session.id}
                        session={session}
                        archiving={archiving}
                        onArchive={handleArchive}
                        onOpenAssistantSession={openAssistantSession}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab?.kind === "assistant-session" ? (
          <AssistantSessionTabContent
            projectSlug={projectSlug}
            threadId={activeTab.threadId}
            view={view}
            relatedSessions={relatedSessions}
          />
        ) : null}

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
      </div>

      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={newSessionIssue}
        open={newSessionIssue !== null}
        onOpenChange={(open) => {
          if (!open) setNewSessionIssue(null);
        }}
        view={view}
        navigateToProjectSession
        onCreated={() => void refetch()}
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
        projectRepos={projectRepos}
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        onCreated={(_, threadId) => {
          void refetch();
          navigate(projectSessionPath(projectSlug, threadId), { replace: true });
        }}
      />
    </main>
    </SessionPreviewDockContext.Provider>
    </SessionTerminalDockContext.Provider>
  );
}

function WorkspaceCardSection({
  title,
  cards,
  projectSlug,
  view,
  resumePending,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onResume,
  onNewSession,
  onRemove,
}: {
  title: string;
  cards: WorkspaceCard[];
  projectSlug: string;
  view: WorkspaceView;
  resumePending: string | null;
  onOpenExecution: (session: ProjectSessionRow) => void;
  onOpenAuthoring: (issueIdentifier: string) => void;
  onOpenSession: (session: RecentSession) => void;
  onResume: (session: ProjectSessionRow) => void;
  onNewSession: (issueIdentifier: string) => void;
  onRemove: (path: string) => void;
}) {
  if (cards.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
      <ul className="grid gap-2">
        {cards.map((card) => (
          <WorkspaceCardItem
            key={card.key}
            card={card}
            issueHref={
              card.issueIdentifier ? issuePath(projectSlug, view, card.issueIdentifier, "sessions") : null
            }
            resumePending={resumePending === card.issueIdentifier}
            onOpenExecution={onOpenExecution}
            onOpenAuthoring={onOpenAuthoring}
            onOpenSession={onOpenSession}
            onResume={onResume}
            onNewSession={onNewSession}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
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
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border/60 bg-background p-6 text-center text-sm text-muted-foreground shadow-sm">
        {isLoading ? t("sessions.loading") : t("sessions.executionUnavailable", { identifier: issueIdentifier })}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background p-3 shadow-sm">
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
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border/60 bg-background p-6 text-center text-sm text-muted-foreground shadow-sm">
        {isLoading ? t("sessions.loading") : t("sessions.executionUnavailable", { identifier: issueIdentifier })}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background p-3 shadow-sm">
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

function RelatedSessionCard({
  session,
  archiving,
  onArchive,
  onOpenAssistantSession,
}: {
  session: RecentSession;
  archiving: boolean;
  onArchive: (threadId: number) => void;
  onOpenAssistantSession: (threadId: number, title: string) => void;
}) {
  const { t } = useTranslation();
  const subtitle = recentSessionSubtitle(session, t);
  const canOpenAsTab =
    (session.scope === "project_session" ||
      session.scope === "project" ||
      session.scope === "issue" ||
      session.scope === "issue_session") &&
    session.threadId != null &&
    session.projectSlug;

  if (canOpenAsTab && session.threadId != null) {
    return (
      <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={() => onOpenAssistantSession(session.threadId!, session.title)}
          >
            <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
                <SessionKindBadge session={session} />
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatDateTime(session.updatedAt)}
              </p>
              {session.preview ? (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                  {session.preview}
                </p>
              ) : null}
            </div>
          </button>
          <ArchiveChatButton threadId={session.threadId} archiving={archiving} onArchive={onArchive} />
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link to={recentSessionPath(session)} className="flex min-w-0 flex-1 items-start gap-3">
          <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
              <SessionKindBadge session={session} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {formatDateTime(session.updatedAt)}
            </p>
            {session.preview ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {session.preview}
              </p>
            ) : null}
          </div>
        </Link>
        {session.threadId != null ? (
          <ArchiveChatButton threadId={session.threadId} archiving={archiving} onArchive={onArchive} />
        ) : null}
      </div>
    </li>
  );
}

function SessionKindBadge({ session }: { session: RecentSession }) {
  return <RecentSessionBadges session={session} />;
}

