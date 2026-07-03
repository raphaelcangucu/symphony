import { Navigate, useParams } from "react-router-dom";

import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";

export function ProjectSessionsPage() {
  const { projectSlug = "" } = useParams();
  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  return <ProjectSessionsPanel projectSlug={projectSlug} />;
}
