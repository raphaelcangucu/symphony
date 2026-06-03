import { Settings } from "lucide-react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router-dom";

import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { ProjectAssistantMenu } from "@/components/layout/ProjectAssistantMenu";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { WorkspaceProvider, useWorkspace } from "@/components/layout/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { projectSettingsPath } from "@/lib/workspaceRoutes";

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
  const { projectSlug, project, trackerKind, refetch, refreshing, setIssues } = useWorkspace();
  const pollingActive = useWindowFocus();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <ProjectHeader
        projectSlug={projectSlug}
        title={project?.name}
        rightSlot={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate(projectSettingsPath(projectSlug))}
              disabled={!project}
              aria-label="Edit project"
              title="Edit project"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <ProjectAssistantMenu projectSlug={projectSlug} />
            <BoardFiltersTrigger />
          </>
        }
        trackerKind={trackerKind}
        onRefresh={() => void refetch()}
        refreshing={refreshing}
        pollingActive={pollingActive}
        onIssueCreated={(issue) => setIssues((current) => [...current, issue])}
      />
      <BoardPaletteShortcuts />
      <Outlet />
    </div>
  );
}
