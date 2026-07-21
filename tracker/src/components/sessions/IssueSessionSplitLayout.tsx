import { type ReactNode } from "react";

import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { useSessionEnvironmentDock } from "@/components/sessions/sessionEnvironmentDockContext";
import { useSessionPreviewDock } from "@/components/sessions/sessionPreviewDockContext";
import { useSessionTasksDock } from "@/components/sessions/sessionTasksDockContext";
import { useSessionTerminalDock } from "@/components/sessions/sessionTerminalDockContext";
import {
  workspaceScopeLabel,
  workspaceScopesEqual,
  type WorkspaceScope,
} from "@/lib/workspaceScope";
import type { WorkspaceView } from "@/lib/workspaceRoutes";

interface IssueSessionSplitLayoutProps {
  scope: WorkspaceScope;
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
 * Header + toolbar wrapper for issue and freeform session tabs. Terminal / Preview /
 * Environment / Tasks buttons toggle workspace-level docks (rendered beside the
 * sessions panel by ProjectSessionsWorkspace) instead of navigating away.
 */
export function IssueSessionSplitLayout({
  scope,
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
  const issueIdentifier = scope.kind === "issue" ? scope.issueIdentifier : null;
  const workspaceLabel = workspaceScopeLabel(scope);
  const dock = useSessionTerminalDock();
  const terminalOpen = workspaceScopesEqual(dock?.openScope, scope);
  const previewDock = useSessionPreviewDock();
  const previewOpen = workspaceScopesEqual(previewDock?.openScope, scope);
  const environmentDock = useSessionEnvironmentDock();
  const environmentOpen = workspaceScopesEqual(environmentDock?.openScope, scope);
  const tasksDock = useSessionTasksDock();
  const tasksOpen = workspaceScopesEqual(tasksDock?.openScope, scope);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center">{headerStart}</div>
        <IssueWorkingTreeToolbar
          projectSlug={scope.projectSlug}
          issueIdentifier={issueIdentifier}
          threadId={scope.kind === "thread" ? scope.threadId : null}
          workspaceLabel={workspaceLabel}
          view={view}
          leading={toolbarLeading}
          trailing={toolbarTrailing}
          showOpenIssue={showOpenIssue}
          pathActionsEnabled={pathActionsEnabled}
          terminalOpen={terminalOpen}
          onTerminalToggle={dock ? () => dock.toggleTerminal(scope) : undefined}
          previewOpen={previewOpen}
          onPreviewToggle={previewDock ? () => previewDock.togglePreview(scope) : undefined}
          environmentOpen={environmentOpen}
          onEnvironmentToggle={
            environmentDock ? () => environmentDock.toggleEnvironment(scope) : undefined
          }
          tasksOpen={tasksOpen}
          onTasksToggle={tasksDock ? () => tasksDock.toggleTasks(scope) : undefined}
          onOpenKnowledgeBase={onOpenKnowledgeBase}
          changedDocCount={changedDocCount}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1.5">{children}</div>
    </div>
  );
}
