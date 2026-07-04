import { Clock, MessageSquare } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { ProjectSessionsChromeSetterContext } from "@/components/layout/ProjectSessionsChromeContext";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { AgentTabs } from "@/components/issues/issue-detail/AgentTabs";
import { SessionListItem } from "@/components/sessions/SessionListItem";
import { SessionAgentBadge, SessionTypeBadge, type SessionBadgeKind } from "@/components/shared/SessionBadge";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { PROJECT_SESSION_BUCKETS, type ProjectSessionRow } from "@/lib/projectSessions";
import { cn, formatDateTime, SCROLLBAR_THIN } from "@/lib/utils";
import {
  SESSIONS_LIST_TAB_ID,
  createAssistantSessionTab,
  createExecutionSessionTab,
  createSessionsListTab,
  executionSessionTabId,
} from "@/lib/workspaceTabs/types";
import {
  issuePath,
  projectExecutionSessionPath,
  projectSessionPath,
  projectSessionsPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { createProjectSessionThread } from "@/services/assistantThreads";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

type UnifiedSessionItem =
  | { kind: "execution"; key: string; sortValue: number; session: ProjectSessionRow }
  | { kind: "related"; key: string; sortValue: number; session: RecentSession };

interface ProjectSessionsWorkspaceProps {
  projectSlug: string;
  activeThreadId?: number | null;
  activeExecutionIdentifier?: string | null;
}

export function ProjectSessionsWorkspace({
  projectSlug,
  activeThreadId = null,
  activeExecutionIdentifier = null,
}: ProjectSessionsWorkspaceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { view } = useWorkspace();
  const { groups, relatedSessions, issues, executions, isLoading, error, refetch } = useProjectSessions(projectSlug);
  const setSessionsChrome = useContext(ProjectSessionsChromeSetterContext);
  const [resumePending, setResumePending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const canonicalTabs = useMemo(() => [createSessionsListTab(t("sessions.title"))], [t]);

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

  const openExecutionSession = useCallback(
    (session: ProjectSessionRow) => {
      openTab(createExecutionSessionTab(session.issueIdentifier, session.title));
      navigate(projectExecutionSessionPath(projectSlug, session.issueIdentifier), { replace: true });
    },
    [navigate, openTab, projectSlug],
  );

  useEffect(() => {
    if (!activeThreadId) return;
    openTab(createAssistantSessionTab(activeThreadId, t("sessions.newSessionTitle")));
  }, [activeThreadId, openTab, t]);

  const executionTitleLookup = useMemo(() => {
    const titles = new Map<string, string>();
    for (const bucket of PROJECT_SESSION_BUCKETS) {
      for (const row of groups[bucket]) titles.set(row.issueIdentifier, row.title);
    }
    for (const issue of issues) if (!titles.has(issue.identifier)) titles.set(issue.identifier, issue.title);
    return titles;
  }, [groups, issues]);

  const openedExecutionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeExecutionIdentifier) {
      openedExecutionRef.current = null;
      return;
    }

    const title = executionTitleLookup.get(activeExecutionIdentifier) ?? activeExecutionIdentifier;
    const tabId = executionSessionTabId(activeExecutionIdentifier);
    const existingTab = tabs.find((tab) => tab.id === tabId);
    const hasOpenedFallback =
      openedExecutionRef.current === activeExecutionIdentifier &&
      !executionTitleLookup.has(activeExecutionIdentifier) &&
      existingTab != null;
    if (hasOpenedFallback || existingTab?.title === title) return;

    openedExecutionRef.current = activeExecutionIdentifier;
    openTab(createExecutionSessionTab(activeExecutionIdentifier, title));
  }, [activeExecutionIdentifier, executionTitleLookup, openTab, tabs]);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      selectTab(tabId);
      const tab = tabs.find((entry) => entry.id === tabId);
      if (tab?.kind === "assistant-session") {
        navigate(projectSessionPath(projectSlug, tab.threadId), { replace: true });
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

  const handleCreateSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const thread = await createProjectSessionThread(projectSlug, { title: t("sessions.newSessionTitle") });
      await refetch();
      openAssistantSession(thread.id, thread.title ?? t("sessions.newSessionTitle"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("sessions.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [creating, openAssistantSession, projectSlug, refetch, t]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleArchive = useCallback(
    (threadId: number) => {
      void archiveChat(threadId);
    },
    [archiveChat],
  );

  const executionSessions = useMemo(
    () => PROJECT_SESSION_BUCKETS.flatMap((bucket) => groups[bucket]),
    [groups],
  );
  const sessionItems = useMemo<UnifiedSessionItem[]>(() => {
    const executionItems: UnifiedSessionItem[] = executionSessions.map((session) => ({
      kind: "execution",
      key: `execution:${session.issueIdentifier}`,
      sortValue: timestampValue(session.lastEventAt ?? session.startedAt),
      session,
    }));
    const relatedItems: UnifiedSessionItem[] = relatedSessions.map((session) => ({
      kind: "related",
      key: `related:${session.id}`,
      sortValue: timestampValue(session.updatedAt),
      session,
    }));

    return [...executionItems, ...relatedItems].sort((a, b) => b.sortValue - a.sortValue);
  }, [executionSessions, relatedSessions]);
  const total = sessionItems.length;

  useEffect(() => {
    if (!setSessionsChrome) return;

    setSessionsChrome({
      count: total,
      isCreating: creating,
      isLoading,
      onCreateSession: () => {
        void handleCreateSession();
      },
      onRefresh: handleRefresh,
    });

    return () => {
      setSessionsChrome(null);
    };
  }, [creating, handleCreateSession, handleRefresh, isLoading, setSessionsChrome, total]);

  return (
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3 sm:p-4">
      <section className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,96rem)] flex-col gap-2.5 overflow-hidden">
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
            {isLoading && total === 0 ? (
              <div className="rounded-lg border border-dashed bg-background/70 px-5 py-10 text-center text-sm text-muted-foreground">
                {t("sessions.loading")}
              </div>
            ) : null}

            {!isLoading && total === 0 ? (
              <div className="rounded-lg border border-dashed bg-background/70 px-5 py-10 text-center text-sm text-muted-foreground">
                {t("sessions.empty")}
              </div>
            ) : null}

            {sessionItems.length > 0 ? (
              <UnifiedSessionsList
                items={sessionItems}
                projectSlug={projectSlug}
                view={view}
                resumePending={resumePending}
                archiving={archiving}
                onResume={handleResume}
                onArchive={handleArchive}
                onOpenExecutionSession={openExecutionSession}
                onOpenAssistantSession={openAssistantSession}
              />
            ) : null}
          </div>
        ) : null}

        {activeTab?.kind === "assistant-session" ? (
          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
            <ProjectAssistantPanel
              projectSlug={projectSlug}
              threadId={activeTab.threadId}
              view={view}
              mode="page"
              contentMaxWidth="wide"
            />
          </section>
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
    </main>
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
      <AgentTabs
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

function UnifiedSessionsList({
  items,
  projectSlug,
  view,
  resumePending,
  archiving,
  onResume,
  onArchive,
  onOpenExecutionSession,
  onOpenAssistantSession,
}: {
  items: UnifiedSessionItem[];
  projectSlug: string;
  view: WorkspaceView;
  resumePending: string | null;
  archiving: boolean;
  onResume: (session: ProjectSessionRow) => void;
  onArchive: (threadId: number) => void;
  onOpenExecutionSession: (session: ProjectSessionRow) => void;
  onOpenAssistantSession: (threadId: number, title: string) => void;
}) {
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((item) =>
        item.kind === "execution" ? (
          <SessionListItem
            key={item.key}
            session={item.session}
            issueHref={issuePath(projectSlug, view, item.session.issueIdentifier)}
            resumePending={resumePending === item.session.issueIdentifier}
            onOpen={onOpenExecutionSession}
            onResume={onResume}
          />
        ) : (
          <RelatedSessionCard
            key={item.key}
            session={item.session}
            archiving={archiving}
            onArchive={onArchive}
            onOpenAssistantSession={onOpenAssistantSession}
          />
        ),
      )}
    </ul>
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
    (session.scope === "project_session" || session.scope === "project") &&
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
  const agentKind = relatedSessionAgentKind(session);

  return (
    <>
      <SessionTypeBadge kind={relatedSessionBadgeKind(session)} />
      {agentKind ? <SessionAgentBadge kind={agentKind} /> : null}
    </>
  );
}

function relatedSessionBadgeKind(session: RecentSession): SessionBadgeKind {
  return session.kind === "codex" ? "execution" : "chat";
}

function relatedSessionAgentKind(session: RecentSession): AgentKind | null {
  return session.agentKind ?? (session.kind === "codex" ? "codex" : null);
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
