import {
  Archive,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  workspaceMenuIconProps,
  WorkspaceIconButton,
} from "@/components/sessions/WorkspaceActionButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import {
  canArchiveSessionRow,
  isWorkspaceRemovable,
  type WorkspaceListItem,
} from "@/lib/workspaceCards";
import type { RecentSession } from "@/types/recents";

export interface WorkspaceRowMenuProps {
  item: WorkspaceListItem;
  issueHref: string | null;
  resumePending?: boolean;
  onOpenSession?(session: RecentSession): void;
  onOpenAssistantSession?(threadId: number, title: string): void;
  onResume?(session: ProjectSessionRow): void;
  onNewSession?(issueIdentifier: string): void;
  onRemove?(path: string): void;
  onArchive?(threadId: number): void;
  onDelete?(threadId: number): void;
}

export function WorkspaceRowMenu({
  item,
  issueHref,
  resumePending = false,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
  onDelete,
}: WorkspaceRowMenuProps) {
  const { t } = useTranslation();
  const actions = buildActions({
    item,
    issueHref,
    resumePending,
    t,
    onOpenSession,
    onOpenAssistantSession,
    onResume,
    onNewSession,
    onRemove,
    onArchive,
    onDelete,
  });

  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <WorkspaceIconButton
          label={t("workspacesPage.rowMenu.more", { defaultValue: "More actions" })}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MoreHorizontal {...workspaceMenuIconProps} aria-hidden />
        </WorkspaceIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]" onClick={(event) => event.stopPropagation()}>
        {actions.map((action) =>
          action.separator ? (
            <DropdownMenuSeparator key={action.key} />
          ) : action.href ? (
            <DropdownMenuItem key={action.key} asChild>
              <Link to={action.href} className="gap-2">
                {action.icon}
                {action.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={action.key}
              disabled={action.disabled}
              className={action.danger ? "text-destructive focus:text-destructive" : undefined}
              onSelect={() => action.onSelect?.()}
            >
              <span className="inline-flex items-center gap-2">
                {action.icon}
                {action.label}
              </span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

type MenuAction = {
  key: string;
  label?: string;
  icon?: ReactNode;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onSelect?: () => void;
};

function buildActions({
  item,
  issueHref,
  resumePending,
  t,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
  onDelete,
}: WorkspaceRowMenuProps & { t: Translate }): MenuAction[] {
  const actions: MenuAction[] = [];
  const openIcon = <ExternalLink {...workspaceMenuIconProps} aria-hidden />;
  const sessionIcon = <MessageSquare {...workspaceMenuIconProps} aria-hidden />;

  if (item.kind === "chat") {
    const session = item.session;
    if (session.threadId != null && onOpenAssistantSession) {
      actions.push({
        key: "open",
        label: t("workspacesPage.sessionRows.open"),
        icon: openIcon,
        onSelect: () => onOpenAssistantSession(session.threadId!, session.title),
      });
    }
    pushThreadLifecycleActions(actions, session, t, onArchive, onDelete);
    return actions;
  }

  const { card } = item;

  if (issueHref) {
    actions.push({
      key: "open-issue",
      label: t("workspacesPage.rowMenu.openIssue", {
        defaultValue: "Open issue",
      }),
      icon: openIcon,
      href: issueHref,
    });
  }

  // Threads only: open the newest thread; no synthetic execution/authoring targets.
  if (card.sessions[0] && onOpenSession) {
    actions.push({
      key: "open-session",
      label: t("workspacesPage.sessionRows.open"),
      icon: sessionIcon,
      onSelect: () => onOpenSession(card.sessions[0]!),
    });
  }

  if (card.issueIdentifier && onNewSession) {
    actions.push({
      key: "new-session",
      label: t("workspacesPage.sessionAction", { defaultValue: "Session" }),
      icon: <Plus {...workspaceMenuIconProps} aria-hidden />,
      onSelect: () => onNewSession(card.issueIdentifier!),
    });
  }

  if (card.execution && onResume && canResumeExecution(card.execution.execution)) {
    actions.push({
      key: "resume",
      label: resumePending
        ? t("sessions.resuming", { defaultValue: "Resuming…" })
        : t("sessions.resume", { defaultValue: "Resume" }),
      icon: <Play {...workspaceMenuIconProps} aria-hidden />,
      disabled: resumePending,
      onSelect: () => onResume(card.execution!),
    });
  }

  const primarySession = card.sessions.find((session) => session.threadId != null) ?? null;
  pushThreadLifecycleActions(actions, primarySession, t, onArchive, onDelete);

  if (onRemove && isWorkspaceRemovable(card)) {
    if (actions.length > 0) actions.push({ key: "sep-remove", separator: true });
    actions.push({
      key: "remove",
      label: t("workspacesPage.sessionRows.remove"),
      icon: <Trash2 {...workspaceMenuIconProps} aria-hidden />,
      danger: true,
      onSelect: () => onRemove(card.inventory!.path),
    });
  }

  return actions;
}

function pushThreadLifecycleActions(
  actions: MenuAction[],
  session: RecentSession | null,
  t: Translate,
  onArchive: WorkspaceRowMenuProps["onArchive"],
  onDelete: WorkspaceRowMenuProps["onDelete"],
): void {
  if (session?.threadId == null) return;

  const canArchive = Boolean(onArchive && canArchiveSessionRow(session));
  const canDelete = Boolean(onDelete);
  if (!canArchive && !canDelete) return;

  if (actions.length > 0) actions.push({ key: "sep-lifecycle", separator: true });

  if (canArchive && onArchive) {
    actions.push({
      key: "archive",
      label: t("assistant.archive.label", { defaultValue: "Archive" }),
      icon: <Archive {...workspaceMenuIconProps} aria-hidden />,
      onSelect: () => onArchive(session.threadId!),
    });
  }

  if (canDelete && onDelete) {
    actions.push({
      key: "delete",
      label: t("layout.sidebar.actions.delete", { defaultValue: "Delete" }),
      icon: <Trash2 {...workspaceMenuIconProps} aria-hidden />,
      danger: true,
      onSelect: () => onDelete(session.threadId!),
    });
  }
}
