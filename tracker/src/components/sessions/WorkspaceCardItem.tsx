import { AlertTriangle, Clock, ExternalLink, GitBranch, HardDrive, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { ResumeSessionButton } from "@/components/shared/ResumeSessionButton";
import { SessionAgentBadge, SessionTypeBadge } from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { formatBytes, type WorkspaceCard } from "@/lib/workspaceCards";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import { cn, formatDateTime } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceRepoState } from "@/types/worktrees";

interface WorkspaceCardItemProps {
  card: WorkspaceCard;
  issueHref: string | null;
  resumePending?: boolean;
  onOpenExecution?: (session: ProjectSessionRow) => void;
  onOpenAuthoring?: (issueIdentifier: string) => void;
  onOpenSession?: (session: RecentSession) => void;
  onResume?: (session: ProjectSessionRow) => void;
  onNewSession?: (issueIdentifier: string) => void;
  onRemove?: (path: string) => void;
}

export function WorkspaceCardItem({
  card,
  issueHref,
  resumePending = false,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onResume,
  onNewSession,
  onRemove,
}: WorkspaceCardItemProps) {
  const { t } = useTranslation();
  const inventory = card.inventory;
  const orphan = inventory?.classification === "orphan";

  return (
    <li className="rounded-lg border border-border/60 bg-card/70 px-4 py-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {card.execution ? <ExecutionStatusDot status={card.execution.status} /> : null}
            {card.issueIdentifier ? (
              <span className="font-mono text-xs font-semibold text-primary">{card.issueIdentifier}</span>
            ) : null}
            {card.kind === "project" ? (
              <span className="text-sm font-medium text-foreground">{t("workspacesPage.projectWorkspace")}</span>
            ) : null}
            {card.kind === "standalone" ? (
              <>
                <span className="text-sm font-medium text-foreground">{card.title}</span>
                <CardBadge>{t("workspacesPage.standaloneBadge")}</CardBadge>
              </>
            ) : null}
            {card.kind === "issue_parallel" ? <CardBadge>{t("workspacesPage.parallelBadge")}</CardBadge> : null}
            {orphan ? <CardBadge tone="warning">{t("workspacesPage.orphanBadge")}</CardBadge> : null}
            {card.execution ? <SessionStatusBadge status={card.execution.status} /> : null}
            {card.execution?.agentKind ? <SessionAgentBadge kind={card.execution.agentKind} /> : null}
          </div>

          {card.kind === "issue" || card.kind === "orphan" || card.kind === "issue_parallel" ? (
            <span className="mt-1 block truncate text-sm font-medium text-foreground">{card.title}</span>
          ) : null}

          {inventory ? (
            <div className="mt-2 space-y-1">
              {inventory.repos.map((repo) => (
                <RepoLine key={repo.path} repo={repo} showName={inventory.repos.length > 1} />
              ))}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-3.5 w-3.5" />
                  {formatBytes(inventory.sizeBytes)}
                </span>
                {inventory.workPresent && orphan ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t("workspacesPage.workPresentWarning")}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-2 space-y-1.5">
            {card.execution ? (
              <SessionRow
                label={t("workspacesPage.sessionRows.execution")}
                meta={`${t("sessions.turns", { count: card.execution.turnCount })} · ${formatDateTime(card.execution.lastEventAt)}`}
                openAriaLabel={t("sessions.openExecutionAria", { identifier: card.issueIdentifier ?? "" })}
                onOpen={onOpenExecution ? () => onOpenExecution(card.execution!) : undefined}
                trailing={
                  onResume && canResumeExecution(card.execution.execution) ? (
                    <ResumeSessionButton pending={resumePending} onResume={() => onResume(card.execution!)} />
                  ) : null
                }
              />
            ) : null}
            {card.authoring && card.issueIdentifier ? (
              <SessionRow
                label={t("workspacesPage.sessionRows.authoring")}
                meta={formatDateTime(card.authoring.updatedAt)}
                openAriaLabel={t("sessions.openAuthoringAria", { identifier: card.issueIdentifier })}
                onOpen={onOpenAuthoring ? () => onOpenAuthoring(card.issueIdentifier!) : undefined}
              />
            ) : null}
            {card.sessions.map((session) => (
              <SessionRow
                key={session.id}
                label={session.title}
                statusDot={<RecentStatusDot statusKind={session.statusKind} className="mt-0.5" />}
                meta={formatDateTime(session.updatedAt)}
                badge={<SessionTypeBadge kind="chat" />}
                onOpen={onOpenSession ? () => onOpenSession(session) : undefined}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {card.issueIdentifier && onNewSession ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2"
              onClick={() => onNewSession(card.issueIdentifier!)}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{t("workspacesPage.newSession.button")}</span>
            </Button>
          ) : null}
          {issueHref ? (
            <Link
              to={issueHref}
              aria-label={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
              title={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          ) : null}
          {inventory?.removable && onRemove && card.kind !== "issue" && card.kind !== "project" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(inventory.path)}
            >
              {t("workspacesPage.sessionRows.remove")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function RepoLine({ repo, showName }: { repo: WorkspaceRepoState; showName: boolean }) {
  const { t } = useTranslation();
  const dirtyLabel = repo.dirty ? t("workspacesPage.workPresentWarning") : t("workspacesPage.clean");

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      {showName ? <span className="font-medium text-foreground/80">{repo.name}</span> : null}
      <span className="truncate font-mono">{repo.branch ?? "?"}</span>
      <span className={cn(repo.dirty && "text-amber-600 dark:text-amber-500")}>{dirtyLabel}</span>
      {repo.aheadCount > 0 ? <span>{t("workspacesPage.ahead", { count: repo.aheadCount })}</span> : null}
    </div>
  );
}

function SessionRow({
  label,
  meta,
  badge = null,
  statusDot = null,
  trailing = null,
  openAriaLabel,
  onOpen,
}: {
  label: string;
  meta: string;
  badge?: React.ReactNode;
  statusDot?: React.ReactNode;
  trailing?: React.ReactNode;
  openAriaLabel?: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/60 px-2.5 py-1.5">
      {statusDot}
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
      {badge}
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        {meta}
      </span>
      {onOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          aria-label={openAriaLabel}
          onClick={onOpen}
        >
          {t("workspacesPage.sessionRows.open")}
        </Button>
      ) : null}
      {trailing}
    </div>
  );
}

function CardBadge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "warning"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-500"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

const STATUS_DOT_CLASS: Record<AgentExecutionStatus, string> = {
  live: "bg-emerald-500 animate-pulse",
  retrying: "bg-orange-500 animate-pulse",
  waiting: "bg-amber-500",
  idle: "bg-slate-400",
  saved: "bg-slate-500",
  paused: "bg-amber-500",
  error: "bg-red-500",
  aborted: "bg-red-500",
};

function ExecutionStatusDot({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();
  const label = t(`sessions.status.${status}`);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_DOT_CLASS[status])}
    />
  );
}
