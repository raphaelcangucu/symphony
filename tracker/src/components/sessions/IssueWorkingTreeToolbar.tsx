import {
  AppWindow,
  BookOpen,
  ExternalLink,
  ListChecks,
  PanelRight,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
import {
  sessionToolbarIconButtonActiveClassName,
  sessionToolbarIconButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueWorkingTreeToolbarProps {
  projectSlug: string;
  issueIdentifier?: string | null;
  threadId?: number | null;
  /** Label used by workspace actions when the scope is not issue-bound. */
  workspaceLabel?: string | null;
  view: WorkspaceView;
  /** Extra controls rendered before the standard issue/working-tree actions. */
  leading?: ReactNode;
  /** Extra controls rendered after documents (e.g. new session). */
  trailing?: ReactNode;
  /** Hides issue navigation for thread-scoped workspaces. */
  showOpenIssue?: boolean;
  /** Disables actions that require a provisioned workspace path. */
  pathActionsEnabled?: boolean;
  /** When set, the terminal control toggles an inline dock instead of navigating away. */
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
  /** When set, shows a preview control toggling the inline dev-server preview dock. */
  previewOpen?: boolean;
  onPreviewToggle?: () => void;
  /** When set, shows an environment control toggling the workspace environment dock. */
  environmentOpen?: boolean;
  onEnvironmentToggle?: () => void;
  /** When set, shows a tasks/tools control toggling the workspace tasks dock. */
  tasksOpen?: boolean;
  onTasksToggle?: () => void;
  /** Opens the shared issue KB modal owned by the assistant panel. */
  onOpenKnowledgeBase?: () => void;
  changedDocCount?: number;
}

export function IssueWorkingTreeToolbar({
  projectSlug,
  issueIdentifier,
  threadId,
  workspaceLabel,
  view,
  leading = null,
  trailing = null,
  showOpenIssue = true,
  pathActionsEnabled = true,
  terminalOpen = false,
  onTerminalToggle,
  previewOpen = false,
  onPreviewToggle,
  environmentOpen = false,
  onEnvironmentToggle,
  tasksOpen = false,
  onTasksToggle,
  onOpenKnowledgeBase,
  changedDocCount,
}: IssueWorkingTreeToolbarProps) {
  const { t } = useTranslation();
  const normalizedIssueIdentifier = issueIdentifier?.trim() || null;
  const editorThreadId =
    typeof threadId === "number" && Number.isInteger(threadId) && threadId > 0 ? threadId : null;
  const actionIdentifier = normalizedIssueIdentifier ?? (workspaceLabel?.trim() || null);
  const issueHref = normalizedIssueIdentifier
    ? issuePath(projectSlug, view, normalizedIssueIdentifier, "sessions")
    : null;
  const issueTerminalHref = normalizedIssueIdentifier
    ? issuePath(projectSlug, view, normalizedIssueIdentifier, "terminal")
    : null;
  const pathActionUnavailableTitle = t("sessions.workspaceNotProvisioned");
  const terminalActionClassName = cn(
    sessionToolbarIconButtonClassName,
    terminalOpen && sessionToolbarIconButtonActiveClassName,
  );
  const previewActionClassName = cn(
    sessionToolbarIconButtonClassName,
    previewOpen && sessionToolbarIconButtonActiveClassName,
  );
  const environmentActionClassName = cn(
    sessionToolbarIconButtonClassName,
    environmentOpen && sessionToolbarIconButtonActiveClassName,
  );
  const tasksActionClassName = cn(
    sessionToolbarIconButtonClassName,
    tasksOpen && sessionToolbarIconButtonActiveClassName,
  );

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {leading}
      {showOpenIssue && normalizedIssueIdentifier && issueHref ? (
        <Link
          to={issueHref}
          aria-label={t("sessions.openIssueAria", { identifier: normalizedIssueIdentifier })}
          title={t("sessions.openIssueAria", { identifier: normalizedIssueIdentifier })}
          className={sessionToolbarIconButtonClassName}
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      ) : null}
      {actionIdentifier && !pathActionsEnabled ? (
        <button
          type="button"
          disabled
          aria-label={t("issue.terminal.ariaLabel", { identifier: actionIdentifier })}
          title={pathActionUnavailableTitle}
          className={terminalActionClassName}
        >
          <TerminalSquare className="h-4 w-4" />
        </button>
      ) : actionIdentifier && onTerminalToggle ? (
        <button
          type="button"
          aria-label={t("issue.terminal.ariaLabel", { identifier: actionIdentifier })}
          title={t("issue.terminal.ariaLabel", { identifier: actionIdentifier })}
          aria-pressed={terminalOpen}
          onClick={onTerminalToggle}
          className={terminalActionClassName}
        >
          <TerminalSquare className="h-4 w-4" />
        </button>
      ) : normalizedIssueIdentifier && issueTerminalHref ? (
        <Link
          to={issueTerminalHref}
          aria-label={t("issue.terminal.ariaLabel", { identifier: normalizedIssueIdentifier })}
          title={t("issue.terminal.ariaLabel", { identifier: normalizedIssueIdentifier })}
          className={terminalActionClassName}
        >
          <TerminalSquare className="h-4 w-4" />
        </Link>
      ) : null}
      {onPreviewToggle ? (
        <button
          type="button"
          disabled={!pathActionsEnabled}
          aria-label={t("workspace.preview.ariaLabel", { identifier: actionIdentifier })}
          title={
            pathActionsEnabled
              ? t("workspace.preview.ariaLabel", { identifier: actionIdentifier })
              : pathActionUnavailableTitle
          }
          aria-pressed={previewOpen}
          onClick={onPreviewToggle}
          className={previewActionClassName}
        >
          <AppWindow className="h-4 w-4" />
        </button>
      ) : null}
      {onEnvironmentToggle ? (
        <button
          type="button"
          disabled={!pathActionsEnabled}
          aria-label={t("workspace.environment.ariaLabel", {
            identifier: actionIdentifier,
          })}
          title={
            pathActionsEnabled
              ? t("workspace.environment.ariaLabel", { identifier: actionIdentifier })
              : pathActionUnavailableTitle
          }
          aria-pressed={environmentOpen}
          onClick={onEnvironmentToggle}
          className={environmentActionClassName}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      ) : null}
      {onTasksToggle ? (
        <button
          type="button"
          data-testid="tasks-dock-toolbar-toggle"
          aria-label={t("workspace.tasks.ariaLabel", { identifier: actionIdentifier })}
          title={t("workspace.tasks.ariaLabel", { identifier: actionIdentifier })}
          aria-pressed={tasksOpen}
          onClick={onTasksToggle}
          className={tasksActionClassName}
        >
          <ListChecks className="h-4 w-4" />
        </button>
      ) : null}
      {normalizedIssueIdentifier || editorThreadId ? (
        <IssueEditorMenu
          projectSlug={projectSlug}
          identifier={normalizedIssueIdentifier}
          threadId={editorThreadId}
          compact
        />
      ) : null}
      {normalizedIssueIdentifier ? (
        <IssueDocumentsDrawer
          projectSlug={projectSlug}
          identifier={normalizedIssueIdentifier}
          compact
          triggerOnly={Boolean(onOpenKnowledgeBase)}
          onOpenChange={
            onOpenKnowledgeBase
              ? (next) => {
                  if (next) onOpenKnowledgeBase();
                }
              : undefined
          }
          changedDocCount={onOpenKnowledgeBase ? changedDocCount : undefined}
          changedDocPaths={onOpenKnowledgeBase ? [] : undefined}
        />
      ) : onOpenKnowledgeBase ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("relative", sessionToolbarIconButtonClassName)}
          onClick={onOpenKnowledgeBase}
          aria-label={t("assistant.authoring.openDocuments")}
          title={t("assistant.authoring.openDocuments")}
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          {(changedDocCount ?? 0) > 0 ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
              data-testid="changed-docs-dot"
            />
          ) : null}
        </Button>
      ) : null}
      {trailing}
    </div>
  );
}
