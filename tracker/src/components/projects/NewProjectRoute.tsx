import { useLocation, useNavigate } from "react-router-dom";

import { useProjectsIndex } from "@/components/projects/ProjectsIndexContext";
import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import { PROJECTS_PATH } from "@/lib/workspaceRoutes";

export function NewProjectRoute() {
  const { onProjectCreated } = useProjectsIndex();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <ProjectWorkspaceWizard
      open
      onOpenChange={(open) => {
        if (!open) navigate({ pathname: PROJECTS_PATH, search: location.search });
      }}
      onCreated={(project) => {
        onProjectCreated(project);
        navigate({ pathname: PROJECTS_PATH, search: location.search });
      }}
    />
  );
}
