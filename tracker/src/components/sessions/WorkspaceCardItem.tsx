import { AlertTriangle, ExternalLink, GitBranch, HardDrive, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { ResumeSessionButton } from "@/components/shared/ResumeSessionButton";
import { SessionAgentBadge, SessionTypeBadge } from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { executionStatusDotClass } from "@/lib/statusPresentation";
import { formatBytes, type WorkspaceCard } from "@/lib/workspaceCards";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
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
    <li
      className={cn(
        "rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm transition-all",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem] sm:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {card.execution ? <ExecutionStatusDot status={card.execution.status} /> : null}
            {card.issueIdentifier ? (
              <span className="font-mono text-xs font-semibold text-primary">{card.issueIdentifier}</span>
            ) : null}
            {card.kind === "project" ? (
              <span className="truncate text-sm font-semibold text-foreground">
                {t("workspacesPage.projectWorkspace")}
              </span>
            ) : null}
            {card.kind === "standalone" ? (
              <span className="truncate text-sm font-semibold text-foreground">{card.title}</span>
            ) : null}
            {card.kind === "issue" || card.kind === "orphan" || card.kind === "issue_parallel" ? (
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{card.title}</span>
            ) : null}
            {card.kind === "standalone" ? <CardBadge>{t("workspacesPage.standaloneBadge")}</CardBadge> : null}
            {card.kind === "issue_parallel" ? <CardBadge>{t("workspacesPage.parallelBadge")}</CardBadge> : null}
            {orphan ? <CardBadge tone="warning">{t("workspacesPage.orphanBadge")}</CardBadge> : null}
            {card.execution ? <SessionStatusBadge status={card.execution.status} /> : null}
            {card.execution?.agentKind ? <SessionAgentBadge kind={card.execution.agentKind} /> : null}
          </div>

          {inventory ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {inventory.repos.map((repo) => (
                <RepoChip key={repo.path} repo={repo} showName={inventory.repos.length > 1} />
              ))}
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                <HardDrive className="h-3 w-3" />
                {formatBytes(inventory.sizeBytes)}
              </span>
              {inventory.workPresent && orphan ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  {t("workspacesPage.workPresentWarning")}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            {card.execution ? (
              <SessionRow
                label={t("workspacesPage.sessionRows.execution")}
                meta={`${t("sessions.turns", { count: card.execution.turnCount })} · ${formatRelativeTime(card.execution.lastEventAt)}`}
                absoluteTitle={formatDateTime(card.execution.lastEventAt)}
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
                meta={formatRelativeTime(card.authoring.updatedAt)}
                absoluteTitle={formatDateTime(card.authoring.updatedAt)}
                openAriaLabel={t("sessions.openAuthoringAria", { identifier: card.issueIdentifier })}
                onOpen={onOpenAuthoring ? () => onOpenAuthoring(card.issueIdentifier!) : undefined}
              />
            ) : null}
            {card.sessions.map((session) => (
              <SessionRow
                key={session.id}
                label={session.title}
                statusDot={<RecentStatusDot statusKind={session.statusKind} className="mt-0.5" />}
                meta={formatRelativeTime(session.updatedAt)}
                absoluteTitle={formatDateTime(session.updatedAt)}
                badge={<SessionTypeBadge kind="chat" />}
                onOpen={onOpenSession ? () => onOpenSession(session) : undefined}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-row flex-wrap items-center gap-1 self-start sm:w-[7.5rem] sm:flex-col sm:items-stretch">
          {card.issueIdentifier && onNewSession ? (
            <Button type="button" variant="default" size="sm" onClick={() => onNewSession(card.issueIdentifier!)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="truncate">{t("workspacesPage.newSession.button")}</span>
            </Button>
          ) : null}
          {issueHref ? (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 sm:w-full sm:justify-center">
              <Link
                to={issueHref}
                aria-label={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
                title={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
          {inventory?.removable && onRemove && card.kind !== "issue" && card.kind !== "project" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
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

function RepoChip({ repo, showName }: { repo: WorkspaceRepoState; showName: boolean }) {
  const { t } = useTranslation();
  const dirtyLabel = repo.dirty ? t("workspacesPage.workPresentWarning") : t("workspacesPage.clean");

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground",
        repo.dirty && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500",
      )}
    >
      <GitBranch className="h-3 w-3 shrink-0 opacity-60" />
      {showName ? <span className="font-medium text-foreground/80">{repo.name}</span> : null}
      <span className="truncate font-mono text-foreground/80">{repo.branch ?? "?"}</span>
      <span>·</span>
      <span>{dirtyLabel}</span>
      {repo.aheadCount > 0 ? <span>· {t("workspacesPage.ahead", { count: repo.aheadCount })}</span> : null}
    </span>
  );
}

function SessionRow({
  label,
  meta,
  absoluteTitle,
  badge = null,
  statusDot = null,
  trailing = null,
  openAriaLabel,
  onOpen,
}: {
  label: string;
  meta: string;
  absoluteTitle?: string;
  badge?: React.ReactNode;
  statusDot?: React.ReactNode;
  trailing?: React.ReactNode;
  openAriaLabel?: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {statusDot}
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {badge}
        <span className="truncate text-[11px] text-muted-foreground" title={absoluteTitle}>
          {meta}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5"
            aria-label={openAriaLabel}
            onClick={onOpen}
          >
            {t("workspacesPage.sessionRows.open")}
          </Button>
        ) : null}
        {trailing}
      </div>
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

function ExecutionStatusDot({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();
  const label = t(`sessions.status.${status}`);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", executionStatusDotClass(status))}
    />
  );
}
