import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import { upsertIssue } from "@/components/board/board-utils";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardQuickFilters } from "@/components/board/BoardQuickFilters";
import { ProjectAssistantMenu } from "@/components/layout/ProjectAssistantMenu";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { WorkspaceProvider, useWorkspace } from "@/components/layout/WorkspaceContext";
import { WarmUpBanner } from "@/components/devenv/WarmUpBanner";
import { Button } from "@/components/ui/button";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { buildWarmUpBootstrapPrompt, stashProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { assistantPath, isBoardPath, projectSettingsPath } from "@/lib/workspaceRoutes";

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
  const { t } = useTranslation();
  const { projectSlug, project, trackerKind, reloadProject, refreshing, setIssues } = useWorkspace();
  const pollingActive = useWindowFocus();
  const navigate = useNavigate();
  const location = useLocation();
  const showBoardFilters = isBoardPath(location.pathname);
  const warmUpStatus = project?.warmUpStatus ?? "never";
  const showWarmUpBanner = Boolean(project) && warmUpStatus !== "succeeded";

  const handlePrepareEnv = () => {
    stashProjectAssistantHandoff({
      projectSlug,
      message: buildWarmUpBootstrapPrompt(projectSlug),
      createdAt: Date.now(),
    });
    navigate(assistantPath(projectSlug));
  };

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
              aria-label={t("layout.editProject")}
              title={t("layout.editProject")}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <ProjectAssistantMenu projectSlug={projectSlug} />
            {showBoardFilters ? <BoardFiltersTrigger /> : null}
          </>
        }
        trackerKind={trackerKind}
        syncState={project?.syncState ?? null}
        onRefresh={() => void reloadProject()}
        refreshing={refreshing}
        pollingActive={pollingActive}
        onIssueCreated={(issue) => setIssues((current) => upsertIssue(current, issue))}
      />
      {showBoardFilters ? <BoardPaletteShortcuts /> : null}
      {showBoardFilters ? <BoardQuickFilters /> : null}
      {showWarmUpBanner ? (
        <WarmUpBanner status={warmUpStatus} onPrepare={handlePrepareEnv} className="mx-4 mt-3" />
      ) : null}
      <Outlet />
    </div>
  );
}
