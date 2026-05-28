import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { BoardView } from "@/components/board/BoardView";
import { BoardFiltersDrawer } from "@/components/board/BoardFiltersDrawer";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardFiltersDrawerProvider } from "@/components/board/useBoardFiltersDrawer";
import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssueBoard } from "@/hooks/useIssueBoard";
import { useTrackerPolling } from "@/hooks/useTrackerPolling";
import { filtersFromSearchParams } from "@/lib/issueFilters";
import { getProject } from "@/services/projects";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";
import type { WorkflowStatusName } from "@/types/workflow-status";

export function ProjectBoardPage() {
  const { projectSlug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const [project, setProject] = useState<Project | null>(null);
  const statusNames = useMemo(() => project?.workflowStatuses?.map((status) => status.name), [project]);
  const { issues, board, loading, error, refetch, moveIssueOptimistically, setIssues } = useIssueBoard(
    projectSlug,
    filters,
    statusNames,
  );
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  const trackerKind = project?.tracker?.kind ?? "local";

  useTrackerPolling({ kind: trackerKind, refetch });

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

  const knownLogins = useMemo(() => {
    const logins = new Set<string>();
    for (const issue of issues) {
      if (issue.assignee) logins.add(issue.assignee);
      if (issue.creator) logins.add(issue.creator);
    }
    return Array.from(logins);
  }, [issues]);

  useEffect(() => {
    if (!projectSlug.trim()) return;
    void getProject(projectSlug).then(setProject).catch(() => setProject(null));
  }, [projectSlug]);

  if (!projectSlug) return <Navigate to="/projects" replace />;

  return (
    <BoardFiltersDrawerProvider>
      <div className="min-h-screen">
        <ProjectHeader
          projectSlug={projectSlug}
          onIssueCreated={(issue) => setIssues((current) => [...current, issue])}
          rightSlot={<BoardFiltersTrigger />}
          trackerKind={trackerKind}
          onRefresh={refetch}
        />
        <BoardFiltersDrawer knownLogins={knownLogins} />
        <BoardPaletteShortcuts />
        {loading ? (
          <div className="grid grid-cols-3 gap-4 p-6">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : null}
        {error ? (
          <div className="m-6 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
        ) : null}
        {!loading ? (
          <BoardView
            board={board}
            statuses={statusNames}
            onSelectIssue={setSelectedIssue}
            onMoveIssue={handleMoveIssue}
          />
        ) : null}
        <IssueDrawer
          projectSlug={projectSlug}
          issue={selectedIssue}
          open={selectedIssue !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedIssue(null);
          }}
        />
      </div>
    </BoardFiltersDrawerProvider>
  );
}
