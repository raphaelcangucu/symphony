import { AppWindow, ExternalLink, ListChecks, PanelRight, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
import {
  sessionToolbarIconButtonActiveClassName,
  sessionToolbarIconButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { cn } from "@/lib/utils";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueWorkingTreeToolbarProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  /** Extra controls rendered before the standard issue/working-tree actions. */
  leading?: ReactNode;
  /** Extra controls rendered after documents (e.g. new session). */
  trailing?: ReactNode;
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
  view,
  leading = null,
  trailing = null,
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
  const issueHref = issuePath(projectSlug, view, issueIdentifier, "sessions");
  const issueTerminalHref = issuePath(projectSlug, view, issueIdentifier, "terminal");
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
      <Link
        to={issueHref}
        aria-label={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        title={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        className={sessionToolbarIconButtonClassName}
      >
        <ExternalLink className="h-4 w-4" />
      </Link>
      {onTerminalToggle ? (
        <button
          type="button"
          aria-label={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
          title={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
          aria-pressed={terminalOpen}
          onClick={onTerminalToggle}
          className={terminalActionClassName}
        >
          <TerminalSquare className="h-4 w-4" />
        </button>
      ) : (
        <Link
          to={issueTerminalHref}
          aria-label={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
          title={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
          className={terminalActionClassName}
        >
          <TerminalSquare className="h-4 w-4" />
        </Link>
      )}
      {onPreviewToggle ? (
        <button
          type="button"
          aria-label={t("workspace.preview.ariaLabel", { identifier: issueIdentifier })}
          title={t("workspace.preview.ariaLabel", { identifier: issueIdentifier })}
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
          aria-label={t("workspace.environment.ariaLabel", { identifier: issueIdentifier })}
          title={t("workspace.environment.ariaLabel", { identifier: issueIdentifier })}
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
          aria-label={t("workspace.tasks.ariaLabel", { identifier: issueIdentifier })}
          title={t("workspace.tasks.ariaLabel", { identifier: issueIdentifier })}
          aria-pressed={tasksOpen}
          onClick={onTasksToggle}
          className={tasksActionClassName}
        >
          <ListChecks className="h-4 w-4" />
        </button>
      ) : null}
      <IssueEditorMenu projectSlug={projectSlug} identifier={issueIdentifier} compact />
      <IssueDocumentsDrawer
        projectSlug={projectSlug}
        identifier={issueIdentifier}
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
      {trailing}
    </div>
  );
}
