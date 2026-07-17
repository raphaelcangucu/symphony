import { ExternalLink, GitBranch, Plus, Trash2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import {
  WorkspaceActionButton,
  WorkspaceIconButton,
  workspaceActionIconProps,
  workspaceMenuIconProps,
} from "@/components/sessions/WorkspaceActionButton";
import {
  ChatStatusIcon,
  sessionStatusIconKindFromScope,
} from "@/components/shared/ChatStatusIcon";
import {
  canArchiveSessionRow,
  formatBytes,
  isWorkspaceRemovable,
  type WorkspaceCard,
  type WorkspaceListItem,
} from "@/lib/workspaceCards";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { RecentSession } from "@/types/recents";

interface WorkspaceDetailPaneProps {
  item: WorkspaceListItem | null;
  issueHref: string | null;
  archiving?: boolean;
  /** Compact body for accordion expansion (no empty-state filler). */
  embedded?: boolean;
  onOpenSession?(session: RecentSession): void;
  onOpenAssistantSession?(threadId: number, title: string): void;
  onNewSession?(issueIdentifier: string): void;
  onRemove?(path: string): void;
  onArchive?(threadId: number): void;
}

export function WorkspaceDetailPane({
  item,
  issueHref,
  archiving = false,
  embedded = false,
  onOpenSession,
  onOpenAssistantSession,
  onNewSession,
  onRemove,
  onArchive,
}: WorkspaceDetailPaneProps) {
  const { t } = useTranslation();

  if (!item) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center px-4 text-sm text-muted-foreground">
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
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {!embedded ? (
              <p className="truncate text-sm font-semibold text-foreground">{session.title}</p>
            ) : null}
            <p className="truncate text-xs text-muted-foreground">
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
            icon={
              <ChatStatusIcon
                sessionKind={sessionStatusIconKindFromScope(session.scope)}
                statusKind={session.statusKind}
              />
            }
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
      embedded={embedded}
      onOpenSession={onOpenSession}
      onNewSession={onNewSession}
      onRemove={onRemove}
      onArchive={onArchive}
    />
  );
}

function CardDetail({
  card,
  issueHref,
  embedded = false,
  onOpenSession,
  onNewSession,
  onRemove,
  onArchive,
}: {
  card: WorkspaceCard;
  issueHref: string | null;
  embedded?: boolean;
  onOpenSession?: (session: RecentSession) => void;
  onNewSession?: (issueIdentifier: string) => void;
  onRemove?: (path: string) => void;
  onArchive?: (threadId: number) => void;
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

  const removable = Boolean(inventory && onRemove && isWorkspaceRemovable(card));

  return (
    <div className={cn("group/detail", embedded ? "space-y-1.5" : "space-y-2")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
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
          {removable ? (
            <WorkspaceIconButton
              label={t("workspacesPage.removeWorkspace.aria", {
                defaultValue: "Remove workspace",
              })}
              className={cn(
                "text-muted-foreground/70 opacity-0 hover:bg-destructive/10 hover:text-destructive",
                "focus-visible:opacity-100 group-hover/detail:opacity-100 group-focus-within/detail:opacity-100",
              )}
              onClick={() => onRemove!(inventory!.path)}
            >
              <Trash2 {...workspaceMenuIconProps} className="h-3.5 w-3.5" aria-hidden />
            </WorkspaceIconButton>
          ) : null}
        </div>
      </div>

      <div className="space-y-0.5">
        {card.sessions.map((session) => (
          <DetailSession
            key={session.id}
            icon={
              <ChatStatusIcon
                sessionKind={sessionStatusIconKindFromScope(session.scope)}
                statusKind={session.statusKind}
              />
            }
            label={session.title}
            meta={formatRelativeTime(session.updatedAt)}
            absoluteTitle={formatDateTime(session.updatedAt)}
            onOpen={onOpenSession ? () => onOpenSession(session) : undefined}
            onRemove={
              onArchive && canArchiveSessionRow(session)
                ? () => onArchive(session.threadId!)
                : undefined
            }
            removeAriaLabel={t("workspacesPage.removeSessionAria", {
              defaultValue: "Remove session",
            })}
          />
        ))}
        {branch || size ? (
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono">{branch ?? "—"}</span>
            {size ? <span className="shrink-0 tabular-nums">{size}</span> : null}
          </div>
        ) : null}
        {card.sessions.length === 0 ? (
          <DetailSession
            icon={<ChatStatusIcon />}
            label={t("workspacesPage.emptySessions", { defaultValue: "No sessions" })}
            meta=""
            onOpen={
              card.issueIdentifier && onNewSession
                ? () => onNewSession(card.issueIdentifier!)
                : undefined
            }
            openAriaLabel={t("workspacesPage.createSessionShort", { defaultValue: "Create" })}
          />
        ) : null}
      </div>
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
  onOpen,
  onRemove,
  removeAriaLabel,
  href,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  absoluteTitle?: string;
  trailing?: ReactNode;
  openAriaLabel?: string;
  onOpen?: () => void;
  onRemove?: () => void;
  removeAriaLabel?: string;
  href?: string;
}) {
  const interactive = Boolean(href || onOpen);
  const stopRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.();
  };

  const removeControl = onRemove ? (
    <button
      type="button"
      aria-label={removeAriaLabel ?? "Remove session"}
      title={removeAriaLabel ?? "Remove session"}
      onClick={stopRemove}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70",
        "opacity-0 hover:bg-destructive/10 hover:text-destructive",
        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "group-hover:opacity-100 group-focus-within:opacity-100",
      )}
    >
      <Trash2 {...workspaceMenuIconProps} className="h-3.5 w-3.5" aria-hidden />
    </button>
  ) : null;

  const content = (
    <>
      <span className="shrink-0 text-foreground/70">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm leading-5 text-foreground">{label}</span>
      {meta ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={absoluteTitle}>
          {meta}
        </span>
      ) : null}
      {trailing}
      {removeControl}
    </>
  );

  const rowClass = cn(
    "group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left",
    interactive &&
      "cursor-pointer hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  );

  if (href) {
    return (
      <Link to={href} className={rowClass} aria-label={openAriaLabel} title={openAriaLabel}>
        {content}
      </Link>
    );
  }

  if (onOpen) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    };
    return (
      <div
        role="button"
        tabIndex={0}
        className={rowClass}
        aria-label={openAriaLabel ?? label}
        title={openAriaLabel ?? label}
        onClick={onOpen}
        onKeyDown={onKeyDown}
      >
        {content}
      </div>
    );
  }

  return <div className={rowClass}>{content}</div>;
}
