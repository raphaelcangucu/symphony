import { type ReactNode } from "react";

import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { useSessionEnvironmentDock } from "@/components/sessions/sessionEnvironmentDockContext";
import { useSessionPreviewDock } from "@/components/sessions/sessionPreviewDockContext";
import { useSessionTasksDock } from "@/components/sessions/sessionTasksDockContext";
import { useSessionTerminalDock } from "@/components/sessions/sessionTerminalDockContext";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueSessionSplitLayoutProps {
  projectSlug: string;
  issueIdentifier?: string | null;
  view: WorkspaceView;
  headerStart: ReactNode;
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
  showOpenIssue?: boolean;
  pathActionsEnabled?: boolean;
  onOpenKnowledgeBase?: () => void;
  changedDocCount?: number;
  children: ReactNode;
}

/**
 * Header + toolbar wrapper for issue-bound session tabs. Terminal / Preview /
 * Environment / Tasks buttons toggle workspace-level docks (rendered beside the
 * sessions panel by ProjectSessionsWorkspace) instead of navigating away.
 */
export function IssueSessionSplitLayout({
  projectSlug,
  issueIdentifier,
  view,
  headerStart,
  toolbarLeading = null,
  toolbarTrailing = null,
  showOpenIssue = true,
  pathActionsEnabled = true,
  onOpenKnowledgeBase,
  changedDocCount,
  children,
}: IssueSessionSplitLayoutProps) {
  const normalizedIssueIdentifier = issueIdentifier?.trim() || null;
  const dock = useSessionTerminalDock();
  const terminalOpen =
    normalizedIssueIdentifier != null && dock?.openIssueIdentifier === normalizedIssueIdentifier;
  const previewDock = useSessionPreviewDock();
  const previewOpen =
    normalizedIssueIdentifier != null &&
    previewDock?.openIssueIdentifier === normalizedIssueIdentifier;
  const environmentDock = useSessionEnvironmentDock();
  const environmentOpen =
    normalizedIssueIdentifier != null &&
    environmentDock?.openIssueIdentifier === normalizedIssueIdentifier;
  const tasksDock = useSessionTasksDock();
  const tasksOpen =
    normalizedIssueIdentifier != null &&
    tasksDock?.openIssueIdentifier === normalizedIssueIdentifier;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center">{headerStart}</div>
        <IssueWorkingTreeToolbar
          projectSlug={projectSlug}
          issueIdentifier={normalizedIssueIdentifier}
          view={view}
          leading={toolbarLeading}
          trailing={toolbarTrailing}
          showOpenIssue={showOpenIssue}
          pathActionsEnabled={pathActionsEnabled}
          terminalOpen={terminalOpen}
          onTerminalToggle={
            dock && normalizedIssueIdentifier
              ? () => dock.toggleTerminal(normalizedIssueIdentifier)
              : undefined
          }
          previewOpen={previewOpen}
          onPreviewToggle={
            previewDock && normalizedIssueIdentifier
              ? () => previewDock.togglePreview(normalizedIssueIdentifier)
              : undefined
          }
          environmentOpen={environmentOpen}
          onEnvironmentToggle={
            environmentDock && normalizedIssueIdentifier
              ? () => environmentDock.toggleEnvironment(normalizedIssueIdentifier)
              : undefined
          }
          tasksOpen={tasksOpen}
          onTasksToggle={
            tasksDock && normalizedIssueIdentifier
              ? () => tasksDock.toggleTasks(normalizedIssueIdentifier)
              : undefined
          }
          onOpenKnowledgeBase={onOpenKnowledgeBase}
          changedDocCount={changedDocCount}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1.5">{children}</div>
    </div>
  );
}
