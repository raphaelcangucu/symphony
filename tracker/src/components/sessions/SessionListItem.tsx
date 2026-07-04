import { Clock, GitBranch, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentIconBadge, agentKindLabel } from "@/components/shared/AgentChip";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { Button } from "@/components/ui/button";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { cn, formatDateTime } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { ProjectSessionRow } from "@/lib/projectSessions";

interface SessionListItemProps {
  session: ProjectSessionRow;
  resumePending?: boolean;
  onOpen: (session: ProjectSessionRow) => void;
  onResume: (session: ProjectSessionRow) => void;
}

export function SessionListItem({
  session,
  resumePending = false,
  onOpen,
  onResume,
}: SessionListItemProps) {
  const { t } = useTranslation();
  const canResume = canResumeExecution(session.execution);
  const openLabel = t("sessions.openExecutionAria", { identifier: session.issueIdentifier });

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
              <SessionStatusBadge status={session.status} />
              {session.agentKind ? (
                <AgentIconBadge kind={session.agentKind} label={agentKindLabel(session.agentKind, t)} />
              ) : null}
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
              <span>{t("sessions.runtime", { value: formatRuntime(session.runtimeSeconds) })}</span>
            </div>
            {session.goalObjective ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                <GitBranch className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {session.goalObjective}
              </p>
            ) : null}
          </div>
        </button>
        {canResume ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={resumePending}
            onClick={() => onResume(session)}
            className="shrink-0 gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {resumePending ? t("sessions.resuming") : t("sessions.resume")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

const STATUS_DOT_CLASS: Record<AgentExecutionStatus, string> = {
  live: "bg-emerald-500 animate-pulse",
  retrying: "bg-orange-500 animate-pulse",
  waiting: "bg-amber-500",
  idle: "bg-slate-400",
  saved: "bg-slate-500",
  error: "bg-red-500",
  aborted: "bg-red-500",
};

function ExecutionStatusDot({ status, className }: { status: AgentExecutionStatus; className?: string }) {
  const { t } = useTranslation();
  const label = t(`sessions.status.${status}`);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_DOT_CLASS[status], className)}
    />
  );
}

function formatRuntime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}
