import { ExternalLink, GitBranch, Play, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import {
  WorkspaceActionButton,
  WorkspaceIconButton,
  workspaceActionIconProps,
} from "@/components/sessions/WorkspaceActionButton";
import { ChatStatusIcon } from "@/components/shared/ChatStatusIcon";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import { formatBytes, type WorkspaceCard, type WorkspaceListItem } from "@/lib/workspaceCards";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { RecentSession } from "@/types/recents";

interface WorkspaceDetailPaneProps {
  item: WorkspaceListItem | null;
  issueHref: string | null;
  resumePending?: boolean;
  archiving?: boolean;
  /** Compact body for accordion expansion (no empty-state filler). */
  embedded?: boolean;
  onOpenExecution?(session: ProjectSessionRow): void;
  onOpenAuthoring?(issueIdentifier: string): void;
  onOpenSession?(session: RecentSession): void;
  onOpenAssistantSession?(threadId: number, title: string): void;
  onResume?(session: ProjectSessionRow): void;
  onNewSession?(issueIdentifier: string): void;
  onRemove?(path: string): void;
  onArchive?(threadId: number): void;
}

export function WorkspaceDetailPane({
  item,
  issueHref,
  resumePending = false,
  archiving = false,
  embedded = false,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
}: WorkspaceDetailPaneProps) {
  const { t } = useTranslation();

  if (!item) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center px-4 text-xs text-muted-foreground">
        {t("workspacesPage.selectWorkspace", { defaultValue: "Select a workspace" })}
      </div>
    );
  }

  if (item.kind === "chat") {
    const session = item.session;
    const href = recentSessionPath(session);
    const openChat = () => {
      if (session.threadId != null && onOpenAssistantSession) {
        onOpenAssistantSession(session.threadId, session.title);
      }
    };

    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {!embedded ? (
              <p className="truncate text-xs font-semibold text-foreground">{session.title}</p>
            ) : null}
            <p className="truncate text-[10px] text-muted-foreground">
              {recentSessionSubtitle(session, t)}
            </p>
          </div>
          {session.threadId != null && onArchive ? (
            <ArchiveChatButton
              threadId={session.threadId}
              archiving={archiving}
              onArchive={onArchive}
            />
          ) : null}
        </div>
        <div className="space-y-0.5">
          <DetailSession
            icon={<ChatStatusIcon statusKind={session.statusKind} />}
            label={session.title}
            meta={formatRelativeTime(session.updatedAt)}
            absoluteTitle={formatDateTime(session.updatedAt)}
            onOpen={session.threadId != null && onOpenAssistantSession ? openChat : undefined}
            href={session.threadId != null && onOpenAssistantSession ? undefined : href}
          />
        </div>
      </div>
    );
  }

  return (
    <CardDetail
      card={item.card}
      issueHref={issueHref}
      resumePending={resumePending}
      embedded={embedded}
      onOpenExecution={onOpenExecution}
      onOpenAuthoring={onOpenAuthoring}
      onOpenSession={onOpenSession}
      onResume={onResume}
      onNewSession={onNewSession}
      onRemove={onRemove}
    />
  );
}

function CardDetail({
  card,
  issueHref,
  resumePending,
  embedded = false,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onResume,
  onNewSession,
  onRemove,
}: {
  card: WorkspaceCard;
  issueHref: string | null;
  resumePending: boolean;
  embedded?: boolean;
  onOpenExecution?: (session: ProjectSessionRow) => void;
  onOpenAuthoring?: (issueIdentifier: string) => void;
  onOpenSession?: (session: RecentSession) => void;
  onResume?: (session: ProjectSessionRow) => void;
  onNewSession?: (issueIdentifier: string) => void;
  onRemove?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const inventory = card.inventory;
  const orphan = inventory?.classification === "orphan";
  const title =
    card.kind === "project"
      ? t("workspacesPage.projectWorkspace")
      : card.title || card.issueIdentifier || card.key;
  const branch = inventory?.repos[0]?.branch ?? null;
  const size = inventory ? formatBytes(inventory.sizeBytes) : null;
  const canResume =
    Boolean(card.execution && onResume && canResumeExecution(card.execution.execution));

  return (
    <div className={cn(embedded ? "space-y-2" : "space-y-2.5")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{title}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {card.issueIdentifier ?? card.kind}
            {card.kind === "standalone" ? ` · ${t("workspacesPage.standaloneBadge")}` : null}
            {card.kind === "issue_parallel" ? ` · ${t("workspacesPage.parallelBadge")}` : null}
            {orphan ? ` · ${t("workspacesPage.orphanBadge")}` : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {card.issueIdentifier && onNewSession ? (
            <WorkspaceActionButton
              icon={<Plus {...workspaceActionIconProps} aria-hidden />}
              onClick={() => onNewSession(card.issueIdentifier!)}
            >
              {t("workspacesPage.sessionAction", { defaultValue: "Session" })}
            </WorkspaceActionButton>
          ) : null}
          {issueHref ? (
            <WorkspaceIconButton
              href={issueHref}
              label={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
            >
              <ExternalLink {...workspaceActionIconProps} aria-hidden />
            </WorkspaceIconButton>
          ) : null}
        </div>
      </div>

      <div className="space-y-0.5">
        {card.execution ? (
          <DetailSession
            icon={<ChatStatusIcon executionStatus={card.execution.status} />}
            label={`${t("workspacesPage.sessionRows.execution")} · ${t("sessions.turns", {
              count: card.execution.turnCount,
            })}`}
            meta={formatRelativeTime(card.execution.lastEventAt)}
            absoluteTitle={formatDateTime(card.execution.lastEventAt)}
            onOpen={onOpenExecution ? () => onOpenExecution(card.execution!) : undefined}
            openAriaLabel={t("sessions.openExecutionAria", { identifier: card.issueIdentifier ?? "" })}
            trailing={
              canResume ? (
                <WorkspaceActionButton
                  icon={<Play {...workspaceActionIconProps} aria-hidden />}
                  disabled={resumePending}
                  onClick={() => onResume!(card.execution!)}
                >
                  {resumePending
                    ? t("sessions.resuming", { defaultValue: "Resuming…" })
                    : t("sessions.resume", { defaultValue: "Resume" })}
                </WorkspaceActionButton>
              ) : null
            }
          />
        ) : null}
        {card.authoring && card.issueIdentifier ? (
          <DetailSession
            icon={<ChatStatusIcon statusKind="idle" />}
            label={t("workspacesPage.sessionRows.authoring")}
            meta={formatRelativeTime(card.authoring.updatedAt)}
            absoluteTitle={formatDateTime(card.authoring.updatedAt)}
            onOpen={onOpenAuthoring ? () => onOpenAuthoring(card.issueIdentifier!) : undefined}
            openAriaLabel={t("sessions.openAuthoringAria", { identifier: card.issueIdentifier })}
          />
        ) : null}
        {card.sessions.map((session) => (
          <DetailSession
            key={session.id}
            icon={<ChatStatusIcon statusKind={session.statusKind} />}
            label={session.title}
            meta={formatRelativeTime(session.updatedAt)}
            absoluteTitle={formatDateTime(session.updatedAt)}
            onOpen={onOpenSession ? () => onOpenSession(session) : undefined}
          />
        ))}
        {branch || size ? (
          <DetailSession
            icon={
              <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            }
            label={branch ?? "—"}
            meta={size ?? ""}
          />
        ) : null}
        {!card.execution && !card.authoring && card.sessions.length === 0 ? (
          <DetailSession
            icon={<ChatStatusIcon />}
            label={t("workspacesPage.emptySessions", { defaultValue: "No sessions" })}
            meta=""
            onOpen={
              card.issueIdentifier && onNewSession
                ? () => onNewSession(card.issueIdentifier!)
                : undefined
            }
            openLabel={t("workspacesPage.createSessionShort", { defaultValue: "Create" })}
          />
        ) : null}
      </div>

      {inventory?.removable && onRemove && card.kind !== "issue" && card.kind !== "project" ? (
        <WorkspaceActionButton danger onClick={() => onRemove(inventory.path)}>
          {t("workspacesPage.sessionRows.remove")}
        </WorkspaceActionButton>
      ) : null}
    </div>
  );
}

function DetailSession({
  icon,
  label,
  meta,
  absoluteTitle,
  trailing = null,
  openAriaLabel,
  openLabel,
  onOpen,
  href,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  absoluteTitle?: string;
  trailing?: ReactNode;
  openAriaLabel?: string;
  openLabel?: string;
  onOpen?: () => void;
  href?: string;
}) {
  const { t } = useTranslation();
  const openText = openLabel ?? t("workspacesPage.sessionRows.open");

  return (
    <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-background/80">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate leading-4 text-foreground/90">{label}</span>
      {meta ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" title={absoluteTitle}>
          {meta}
        </span>
      ) : null}
      {href || onOpen ? (
        <WorkspaceActionButton
          href={href}
          aria-label={openAriaLabel}
          onClick={onOpen}
        >
          {openText}
        </WorkspaceActionButton>
      ) : null}
      {trailing}
    </div>
  );
}
