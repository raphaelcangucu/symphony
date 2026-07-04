import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { ProjectSessionsPanel } from "@/components/sessions/ProjectSessionsPanel";

export function ProjectSessionsPage() {
  const { projectSlug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const activeExecutionIdentifier = searchParams.get("exec")?.trim() || null;

  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  return <ProjectSessionsPanel projectSlug={projectSlug} activeExecutionIdentifier={activeExecutionIdentifier} />;
}
