import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { SessionListItem } from "@/components/sessions/SessionListItem";
import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { SessionAgentBadge, SessionTypeBadge } from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useIssueSessions } from "@/hooks/useIssueSessions";
import { cn, formatDateTime, SCROLLBAR_THIN } from "@/lib/utils";
import {
  issuePath,
  projectAuthoringSessionPath,
  projectExecutionSessionPath,
  projectSessionPath,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { AssistantThread } from "@/types/assistant-thread";
import type { Issue } from "@/types/issue";
import { Clock, MessageSquare } from "lucide-react";

interface IssueSessionsTabProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  view: WorkspaceView;
}

export function IssueSessionsTab({ issue, projectSlug, execution, view }: IssueSessionsTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const {
    executionSession,
    chatSessions,
    isLoading,
    error,
    resumePending,
    refetch,
    resumeExecution,
  } = useIssueSessions(projectSlug, issue, execution);
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const openExecutionSession = useCallback(() => {
    const threadId =
      execution?.executionSessionId ?? executionSession?.execution.executionSessionId ?? null;
    navigate(projectExecutionSessionPath(projectSlug, issue.identifier, threadId));
  }, [
    execution?.executionSessionId,
    executionSession?.execution.executionSessionId,
    issue.identifier,
    navigate,
    projectSlug,
  ]);

  const openChatSession = useCallback(
    (thread: AssistantThread) => {
      if (thread.scope === "issue") {
        navigate(projectAuthoringSessionPath(projectSlug, issue.identifier));
        return;
      }
      navigate(projectSessionPath(projectSlug, thread.id));
    },
    [issue.identifier, navigate, projectSlug],
  );

  const handleCreated = useCallback(
    (thread: AssistantThread) => {
      void refetch();
      navigate(projectSessionPath(projectSlug, thread.id));
    },
    [navigate, projectSlug, refetch],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("issue.sessions.hint")}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("issue.sessions.newSession")}
          </Button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-auto", SCROLLBAR_THIN)}>
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!isLoading && !executionSession && chatSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background/70 px-5 py-10 text-center text-sm text-muted-foreground">
            {t("issue.sessions.empty")}
          </div>
        ) : null}

        <ul className="grid gap-2">
          {executionSession ? (
            <SessionListItem
              session={executionSession}
              issueHref={issuePath(projectSlug, view, issue.identifier, "sessions")}
              resumePending={resumePending}
              onOpen={() => openExecutionSession()}
              onResume={() => void resumeExecution()}
            />
          ) : null}
          {chatSessions.map((thread) => (
            <IssueChatSessionCard
              key={thread.id}
              thread={thread}
              issue={issue}
              archiving={archiving}
              onOpen={() => openChatSession(thread)}
              onArchive={archiveChat}
            />
          ))}
        </ul>
      </div>

      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={{
          identifier: issue.identifier,
          title: issue.title,
          agentKind: issue.agentKind ?? null,
          parentIdentifier: issue.parentIdentifier ?? null,
        }}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

function IssueChatSessionCard({
  thread,
  issue,
  archiving,
  onOpen,
  onArchive,
}: {
  thread: AssistantThread;
  issue: Issue;
  archiving: boolean;
  onOpen: () => void;
  onArchive: (threadId: number) => void;
}) {
  const { t } = useTranslation();
  const title = thread.title?.trim() || t("issue.sessions.defaultSessionTitle");
  const scopeLabel =
    thread.scope === "issue_session" ? t("issue.sessions.issueSessionBadge") : t("issue.sessions.authoringBadge");

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          <RecentStatusDot statusKind="active" className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">{issue.identifier}</span>
              <SessionTypeBadge kind="chat" />
              <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {scopeLabel}
              </span>
              {thread.agentKind ? <SessionAgentBadge kind={thread.agentKind} /> : null}
            </div>
            <span className="mt-1 block truncate text-sm font-medium text-foreground group-hover:underline">{title}</span>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatDateTime(thread.updatedAt)}
              </span>
            </div>
            {thread.preview ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {thread.preview}
              </p>
            ) : null}
          </div>
        </button>
        <ArchiveChatButton threadId={thread.id} archiving={archiving} onArchive={onArchive} />
      </div>
    </li>
  );
}
