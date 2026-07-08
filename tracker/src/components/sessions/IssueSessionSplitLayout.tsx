import { type ReactNode } from "react";

import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { useSessionTerminalDock } from "@/components/sessions/sessionTerminalDockContext";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueSessionSplitLayoutProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  headerStart: ReactNode;
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
  children: ReactNode;
}

/**
 * Header + toolbar wrapper for issue-bound session tabs. The terminal button
 * toggles the workspace-level terminal dock (rendered beside the sessions
 * panel by ProjectSessionsWorkspace) instead of navigating to the issue drawer.
 */
export function IssueSessionSplitLayout({
  projectSlug,
  issueIdentifier,
  view,
  headerStart,
  toolbarLeading = null,
  toolbarTrailing = null,
  children,
}: IssueSessionSplitLayoutProps) {
  const dock = useSessionTerminalDock();
  const terminalOpen = dock?.openIssueIdentifier === issueIdentifier;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center">{headerStart}</div>
        <IssueWorkingTreeToolbar
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          view={view}
          leading={toolbarLeading}
          trailing={toolbarTrailing}
          terminalOpen={terminalOpen}
          onTerminalToggle={dock ? () => dock.toggleTerminal(issueIdentifier) : undefined}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1.5">{children}</div>
    </div>
  );
}
