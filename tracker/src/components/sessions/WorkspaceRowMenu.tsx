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
import { isWorkspaceRemovable, type WorkspaceListItem } from "@/lib/workspaceCards";
import type { RecentSession } from "@/types/recents";

export interface WorkspaceRowMenuProps {
  item: WorkspaceListItem;
  issueHref: string | null;
  resumePending?: boolean;
  onOpenExecution?(session: ProjectSessionRow): void;
  onOpenAuthoring?(issueIdentifier: string): void;
  onOpenSession?(session: RecentSession): void;
  onOpenAssistantSession?(threadId: number, title: string): void;
  onResume?(session: ProjectSessionRow): void;
  onNewSession?(issueIdentifier: string): void;
  onRemove?(path: string): void;
  onArchive?(threadId: number): void;
}

export function WorkspaceRowMenu({
  item,
  issueHref,
  resumePending = false,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
}: WorkspaceRowMenuProps) {
  const { t } = useTranslation();
  const actions = buildActions({
    item,
    issueHref,
    resumePending,
    t,
    onOpenExecution,
    onOpenAuthoring,
    onOpenSession,
    onOpenAssistantSession,
    onResume,
    onNewSession,
    onRemove,
    onArchive,
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
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
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
    if (session.threadId != null && onArchive) {
      actions.push({
        key: "archive",
        label: t("assistant.archive.label", { defaultValue: "Archive" }),
        icon: <Archive {...workspaceMenuIconProps} aria-hidden />,
        danger: true,
        onSelect: () => onArchive(session.threadId!),
      });
    }
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

  if (card.execution && onOpenExecution) {
    actions.push({
      key: "open-execution",
      label: t("workspacesPage.sessionRows.open"),
      icon: sessionIcon,
      onSelect: () => onOpenExecution(card.execution!),
    });
  } else if (card.authoring && card.issueIdentifier && onOpenAuthoring) {
    actions.push({
      key: "open-authoring",
      label: t("workspacesPage.sessionRows.open"),
      icon: sessionIcon,
      onSelect: () => onOpenAuthoring(card.issueIdentifier!),
    });
  } else if (card.sessions[0] && onOpenSession) {
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
