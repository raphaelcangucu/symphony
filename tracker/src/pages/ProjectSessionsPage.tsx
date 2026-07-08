import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";
import { agentSectionFromSearchParams } from "@/lib/workspaceRoutes";

export function ProjectSessionsPage() {
  const { projectSlug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const exec = searchParams.get("exec")?.trim() || null;
  const section = agentSectionFromSearchParams(searchParams);
  const activeAuthoringIdentifier = exec && section === "authoring" ? exec : null;
  const activeExecutionIdentifier = exec && section === "execution" ? exec : null;

  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  return (
    <ProjectSessionsPanel
      projectSlug={projectSlug}
      activeExecutionIdentifier={activeExecutionIdentifier}
      activeAuthoringIdentifier={activeAuthoringIdentifier}
    />
  );
}
