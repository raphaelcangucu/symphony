import { Clock, ExternalLink, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ResumeSessionButton } from "@/components/shared/ResumeSessionButton";
import { SessionAgentBadge, SessionTypeBadge } from "@/components/shared/SessionBadge";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { executionStatusDotClass } from "@/lib/statusPresentation";
import { formatDateTime, formatDurationSeconds } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { ProjectSessionRow } from "@/lib/projectSessions";

interface SessionListItemProps {
  session: ProjectSessionRow;
  issueHref: string;
  resumePending?: boolean;
  onOpen: (session: ProjectSessionRow) => void;
  onResume: (session: ProjectSessionRow) => void;
}

export function SessionListItem({
  session,
  issueHref,
  resumePending = false,
  onOpen,
  onResume,
}: SessionListItemProps) {
  const { t } = useTranslation();
  const canResume = canResumeExecution(session.execution);
  const openLabel = t("sessions.openExecutionAria", { identifier: session.issueIdentifier });
  const openIssueLabel = t("sessions.openIssueAria", { identifier: session.issueIdentifier });

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(session)}
          aria-label={openLabel}
          className="group flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <ExecutionStatusDot status={session.status} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">
                {session.issueIdentifier}
              </span>
              <SessionTypeBadge kind="execution" />
              <SessionStatusBadge status={session.status} />
              {session.agentKind ? <SessionAgentBadge kind={session.agentKind} /> : null}
            </div>
            <span className="mt-1 block truncate text-sm font-medium text-foreground group-hover:underline">
              {session.title}
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatDateTime(session.lastEventAt)}
              </span>
              <span>{t("sessions.turns", { count: session.turnCount })}</span>
              <span>{t("sessions.runtime", { value: formatDurationSeconds(session.runtimeSeconds) })}</span>
            </div>
            {session.goalObjective ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                <GitBranch className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {session.goalObjective}
              </p>
            ) : null}
          </div>
        </button>
        <Link
          to={issueHref}
          aria-label={openIssueLabel}
          title={openIssueLabel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
        {canResume ? (
          <ResumeSessionButton pending={resumePending} onResume={() => onResume(session)} />
        ) : null}
      </div>
    </li>
  );
}

function ExecutionStatusDot({ status, className }: { status: AgentExecutionStatus; className?: string }) {
  const { t } = useTranslation();
  const label = t(`sessions.status.${status}`);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", executionStatusDotClass(status), className)}
    />
  );
}

export interface AuthoringSessionRow {
  issueIdentifier: string;
  title: string;
  updatedAt: string;
  agentKind: ProjectSessionRow["agentKind"];
}

interface AuthoringSessionListItemProps {
  session: AuthoringSessionRow;
  issueHref: string;
  onOpen: (session: AuthoringSessionRow) => void;
}

export function AuthoringSessionListItem({ session, issueHref, onOpen }: AuthoringSessionListItemProps) {
  const { t } = useTranslation();
  const openLabel = t("sessions.openAuthoringAria", { identifier: session.issueIdentifier });
  const openIssueLabel = t("sessions.openIssueAria", { identifier: session.issueIdentifier });

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(session)}
          aria-label={openLabel}
          className="group flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <span
            role="img"
            aria-label={t("issue.agentTabs.authoring")}
            title={t("issue.agentTabs.authoring")}
            className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">{session.issueIdentifier}</span>
              <SessionTypeBadge kind="chat" />
              <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("issue.agentTabs.authoring")}
              </span>
              {session.agentKind ? <SessionAgentBadge kind={session.agentKind} /> : null}
            </div>
            <span className="mt-1 block truncate text-sm font-medium text-foreground group-hover:underline">{session.title}</span>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatDateTime(session.updatedAt)}
              </span>
            </div>
          </div>
        </button>
        <Link
          to={issueHref}
          aria-label={openIssueLabel}
          title={openIssueLabel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </li>
  );
}
