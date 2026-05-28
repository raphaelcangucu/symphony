import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { BoardView } from "@/components/board/BoardView";
import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssueBoard } from "@/hooks/useIssueBoard";
import type { Issue } from "@/types/issue";

export function ProjectBoardPage() {
  const { projectSlug = "" } = useParams();
  const { board, loading, error, moveIssueOptimistically, setIssues } = useIssueBoard(projectSlug);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  if (!projectSlug) return <Navigate to="/projects" replace />;

  return (
    <div className="min-h-screen">
      <ProjectHeader
        projectSlug={projectSlug}
        onIssueCreated={(issue) => setIssues((current) => [...current, issue])}
      />
      {loading ? (
        <div className="grid grid-cols-3 gap-4 p-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : null}
      {error ? <div className="m-6 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div> : null}
      {!loading ? <BoardView board={board} onSelectIssue={setSelectedIssue} onMoveIssue={moveIssueOptimistically} /> : null}
      <IssueDrawer
        projectSlug={projectSlug}
        issue={selectedIssue}
        open={selectedIssue !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedIssue(null);
        }}
      />
    </div>
  );
}
