import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { BoardView } from "@/components/board/BoardView";
import { upsertIssue } from "@/components/board/board-utils";
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
    agentExecutions,
    collapsed,
    toggleCollapse,
    moveIssueOptimistically,
    setIssues,
    reloadProject,
    trackerKind,
  } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  // Poll reloadProject (not just issue refetch) so board data and the
  // project's sync health badge refresh on the same cadence.
  useTrackerPolling({ kind: trackerKind, refetch: () => void reloadProject() });

  const openIssue = useCallback(
    (issue: Issue) => {
      navigate({ pathname: issuePath(projectSlug, view, issue.identifier), search: location.search });
    },
    [navigate, projectSlug, view, location.search],
  );

  const handleMoveIssue = useCallback(
    (identifier: string, status: WorkflowStatusName, position: number) =>
      moveIssueOptimistically(identifier, status, position),
    [moveIssueOptimistically],
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
      {!loading ? (
        <BoardView
          board={board}
          statuses={statusNames}
          workflowStatuses={workflowStatuses}
          projectSlug={projectSlug}
          onIssueCreated={(issue) => setIssues((current) => upsertIssue(current, issue))}
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
