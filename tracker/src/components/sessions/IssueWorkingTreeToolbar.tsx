import { ExternalLink, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueWorkingTreeToolbarProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  /** Extra controls rendered before the standard issue/working-tree actions. */
  leading?: ReactNode;
  /** Extra controls rendered after documents (e.g. new session). */
  trailing?: ReactNode;
}

export function IssueWorkingTreeToolbar({
  projectSlug,
  issueIdentifier,
  view,
  leading = null,
  trailing = null,
}: IssueWorkingTreeToolbarProps) {
  const { t } = useTranslation();
  const issueHref = issuePath(projectSlug, view, issueIdentifier, "sessions");
  const issueTerminalHref = issuePath(projectSlug, view, issueIdentifier, "terminal");

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {leading}
      <Link
        to={issueHref}
        aria-label={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        title={t("sessions.openIssueAria", { identifier: issueIdentifier })}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ExternalLink className="h-4 w-4" />
      </Link>
      <Link
        to={issueTerminalHref}
        aria-label={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
        title={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <TerminalSquare className="h-4 w-4" />
      </Link>
      <IssueEditorMenu projectSlug={projectSlug} identifier={issueIdentifier} />
      <IssueDocumentsDrawer projectSlug={projectSlug} identifier={issueIdentifier} />
      {trailing}
    </div>
  );
}
