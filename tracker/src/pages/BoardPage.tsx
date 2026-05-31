import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { BoardView } from "@/components/board/BoardView";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrackerPolling } from "@/hooks/useTrackerPolling";
import { issuePath } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

export function BoardPage() {
  const {
    projectSlug,
    view,
    board,
    statusNames,
    workflowStatuses,
    loading,
    error,
    issues,
    trackerKind,
    agentExecutions,
    collapsed,
    toggleCollapse,
    moveIssueOptimistically,
    setIssues,
    refetch,
  } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  useTrackerPolling({ kind: trackerKind, refetch });

  const openIssue = useCallback(
    (issue: Issue) => {
      navigate({ pathname: issuePath(projectSlug, view, issue.identifier), search: location.search });
    },
    [navigate, projectSlug, view, location.search],
  );

  const handleMoveIssue = useCallback(
    (identifier: string, status: WorkflowStatusName, position: number) => {
      if (trackerKind !== "local") {
        const current = issues.find((issue) => issue.identifier === identifier);
        if (current && current.status === status) return;
      }
      return moveIssueOptimistically(identifier, status, position);
    },
    [trackerKind, issues, moveIssueOptimistically],
  );

  return (
    <>
      {loading ? (
        <div className="flex gap-3 px-6 py-5">
          <Skeleton className="h-[70vh] w-80 rounded-2xl" />
          <Skeleton className="h-[70vh] w-80 rounded-2xl" />
          <Skeleton className="h-[70vh] w-80 rounded-2xl" />
          <Skeleton className="h-[70vh] w-80 rounded-2xl" />
        </div>
      ) : null}
      {error ? (
        <div className="m-6 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      ) : null}
      {!loading ? (
        <BoardView
          board={board}
          statuses={statusNames}
          workflowStatuses={workflowStatuses}
          projectSlug={projectSlug}
          onIssueCreated={(issue) => setIssues((current) => [...current, issue])}
          onSelectIssue={openIssue}
          onMoveIssue={handleMoveIssue}
          collapsedStatuses={collapsed}
          onToggleCollapse={toggleCollapse}
          agentExecutions={agentExecutions}
        />
      ) : null}
      <Outlet />
    </>
  );
}
