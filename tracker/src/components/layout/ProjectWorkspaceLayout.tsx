import { Navigate, Outlet, useParams } from "react-router-dom";

import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { WorkspaceProvider, useWorkspace } from "@/components/layout/WorkspaceContext";

export function ProjectWorkspaceLayout() {
  const { projectSlug = "" } = useParams();

  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;

  return (
    <WorkspaceProvider>
      <WorkspaceChrome />
    </WorkspaceProvider>
  );
}

function WorkspaceChrome() {
  const { projectSlug, view, trackerKind, refetch, refreshing } = useWorkspace();

  return (
    <div className="min-h-screen">
      <ProjectHeader
        projectSlug={projectSlug}
        view={view}
        rightSlot={<BoardFiltersTrigger />}
        trackerKind={trackerKind}
        onRefresh={() => void refetch()}
        refreshing={refreshing}
      />
      <BoardPaletteShortcuts />
      <Outlet />
    </div>
  );
}
