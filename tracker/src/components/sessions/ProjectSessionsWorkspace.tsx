import { MessageSquare, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { SessionListItem } from "@/components/sessions/SessionListItem";
import { AgentIconBadge, agentKindLabel } from "@/components/shared/AgentChip";
import { Button } from "@/components/ui/button";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { PROJECT_SESSION_BUCKETS, type ProjectSessionRow } from "@/lib/projectSessions";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import {
  SESSIONS_LIST_TAB_ID,
  createAssistantSessionTab,
  createSessionsListTab,
} from "@/lib/workspaceTabs/types";
import { projectSessionPath, projectSessionsPath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { createProjectSessionThread } from "@/services/assistantThreads";
import type { RecentSession } from "@/types/recents";

type UnifiedSessionItem =
  | { kind: "execution"; key: string; sortValue: number; session: ProjectSessionRow }
  | { kind: "related"; key: string; sortValue: number; session: RecentSession };

interface ProjectSessionsWorkspaceProps {
  projectSlug: string;
  activeThreadId?: number | null;
}

export function ProjectSessionsWorkspace({ projectSlug, activeThreadId = null }: ProjectSessionsWorkspaceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { view } = useWorkspace();
  const { groups, relatedSessions, isLoading, error, refetch } = useProjectSessions(projectSlug);
  const [resumePending, setResumePending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    if (!activeThreadId) return;
    openTab(createAssistantSessionTab(activeThreadId, t("sessions.newSessionTitle")));
  }, [activeThreadId, openTab, t]);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      selectTab(tabId);
      const tab = tabs.find((entry) => entry.id === tabId);
      if (tab?.kind === "assistant-session") {
        navigate(projectSessionPath(projectSlug, tab.threadId), { replace: true });
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

  async function handleCreateSession() {
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
  }

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

  return (
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3 sm:p-4">
      <section className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,96rem)] flex-col gap-2.5 overflow-hidden">
        <header className="shrink-0 rounded-lg border border-border/60 bg-card/90 px-4 py-2.5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sessions.eyebrow")}
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{t("sessions.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("sessions.description")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
                <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {t("sessions.refresh")}
              </Button>
              <Button type="button" size="sm" onClick={() => void handleCreateSession()} disabled={creating}>
                <Plus className="h-4 w-4" />
                {creating ? t("sessions.creating") : t("sessions.newSession")}
              </Button>
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </header>

        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          ariaLabel={t("workspace.sessions.tabsAria")}
          shortcutHints
        />

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
                onResume={handleResume}
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
      </section>
    </main>
  );
}

function UnifiedSessionsList({
  items,
  projectSlug,
  view,
  resumePending,
  onResume,
  onOpenAssistantSession,
}: {
  items: UnifiedSessionItem[];
  projectSlug: string;
  view: WorkspaceView;
  resumePending: string | null;
  onResume: (session: ProjectSessionRow) => void;
  onOpenAssistantSession: (threadId: number, title: string) => void;
}) {
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((item) =>
        item.kind === "execution" ? (
          <SessionListItem
            key={item.key}
            projectSlug={projectSlug}
            view={view}
            session={item.session}
            resumePending={resumePending === item.session.issueIdentifier}
            onResume={onResume}
          />
        ) : (
          <RelatedSessionCard
            key={item.key}
            session={item.session}
            onOpenAssistantSession={onOpenAssistantSession}
          />
        ),
      )}
    </ul>
  );
}

function RelatedSessionCard({
  session,
  onOpenAssistantSession,
}: {
  session: RecentSession;
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
        <button
          type="button"
          className="flex min-w-0 w-full items-start gap-3 text-left"
          onClick={() => onOpenAssistantSession(session.threadId!, session.title)}
        >
          <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
              <SessionKindBadge session={session} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
            {session.preview ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {session.preview}
              </p>
            ) : null}
          </div>
        </button>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
      <Link to={recentSessionPath(session)} className="flex min-w-0 items-start gap-3">
        <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
            <SessionKindBadge session={session} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
          {session.preview ? (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              {session.preview}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function SessionKindBadge({ session }: { session: RecentSession }) {
  const { t } = useTranslation();
  const label = session.agentKind
    ? agentKindLabel(session.agentKind, t)
    : session.kind === "codex"
      ? t("sessions.related.agent")
      : t("sessions.related.chat");

  if (!session.agentKind) {
    return (
      <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
        {label}
      </span>
    );
  }

  return <AgentIconBadge kind={session.agentKind} label={label} />;
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
