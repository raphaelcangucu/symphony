import { AppWindow, ExternalLink, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
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
}: IssueWorkingTreeToolbarProps) {
  const { t } = useTranslation();
  const issueHref = issuePath(projectSlug, view, issueIdentifier, "sessions");
  const issueTerminalHref = issuePath(projectSlug, view, issueIdentifier, "terminal");
  const terminalActionClassName = cn(
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    terminalOpen && "bg-accent text-foreground",
  );
  const previewActionClassName = cn(
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    previewOpen && "bg-accent text-foreground",
  );

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {leading}
      <Link
        to={issueHref}
        aria-label={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        title={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      <IssueEditorMenu projectSlug={projectSlug} identifier={issueIdentifier} compact />
      <IssueDocumentsDrawer projectSlug={projectSlug} identifier={issueIdentifier} />
      {trailing}
    </div>
  );
}
