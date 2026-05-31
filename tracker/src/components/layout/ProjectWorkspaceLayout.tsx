import { Bot } from "lucide-react";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";

import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { WorkspaceProvider, useWorkspace } from "@/components/layout/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { assistantPath } from "@/lib/workspaceRoutes";

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
  const pollingActive = useWindowFocus();

  return (
    <div className="min-h-screen">
      <ProjectHeader
        projectSlug={projectSlug}
        view={view}
        rightSlot={
          <>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to={assistantPath(projectSlug)}>
                <Bot className="h-4 w-4" />
                Assistant
              </Link>
            </Button>
            <BoardFiltersTrigger />
          </>
        }
        trackerKind={trackerKind}
        onRefresh={() => void refetch()}
        refreshing={refreshing}
        pollingActive={pollingActive}
      />
      <BoardPaletteShortcuts />
      <Outlet />
    </div>
  );
}
