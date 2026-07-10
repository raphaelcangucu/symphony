import { Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import { upsertIssue } from "@/components/board/board-utils";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardQuickFilters } from "@/components/board/BoardQuickFilters";
import { SessionQuickOpenLauncher } from "@/components/launcher/SessionQuickOpenLauncher";
import { ProjectAssistantMenu } from "@/components/layout/ProjectAssistantMenu";
import { ProjectEditorMenu } from "@/components/layout/ProjectEditorMenu";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import {
  ProjectSessionsChromeSetterContext,
  type ProjectSessionsChromeState,
} from "@/components/layout/ProjectSessionsChromeContext";
import { WorkspaceProvider, useWorkspace } from "@/components/layout/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import {
  isBoardPath,
  projectExploreAssistantPath,
  projectSessionsPath,
  projectSettingsPath,
} from "@/lib/workspaceRoutes";

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
  const [sessionsChrome, setSessionsChrome] = useState<ProjectSessionsChromeState | null>(null);
  const showBoardFilters = isBoardPath(location.pathname);
  const showProjectEditor = location.pathname === projectExploreAssistantPath(projectSlug);
  const sessionsPath = projectSessionsPath(projectSlug);
  const showProjectSessionsChrome =
    location.pathname === sessionsPath || location.pathname.startsWith(`${sessionsPath}/`);

  return (
    <ProjectSessionsChromeSetterContext.Provider value={setSessionsChrome}>
      <div className="min-h-screen">
        <ProjectHeader
          projectSlug={projectSlug}
          title={project?.name}
          sessionsCount={showProjectSessionsChrome ? sessionsChrome?.count : null}
          rightSlot={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 px-0"
                onClick={() => navigate(projectSettingsPath(projectSlug))}
                disabled={!project}
                aria-label={t("layout.editProject")}
                title={t("layout.editProject")}
              >
                <Settings className="h-4 w-4" />
              </Button>
              {showProjectEditor ? <ProjectEditorMenu projectSlug={projectSlug} /> : null}
              <div aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
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
        <SessionQuickOpenLauncher />
        {showBoardFilters ? <BoardPaletteShortcuts /> : null}
        {showBoardFilters ? <BoardQuickFilters /> : null}
        <Outlet />
      </div>
    </ProjectSessionsChromeSetterContext.Provider>
  );
}
