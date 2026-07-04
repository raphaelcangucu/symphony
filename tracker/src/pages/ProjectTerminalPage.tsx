import { Navigate, useParams } from "react-router-dom";

import { ProjectTerminalPanel } from "@/components/terminal/ProjectTerminalPanel";

export function ProjectTerminalPage() {
  const { projectSlug = "" } = useParams();
  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  return <ProjectTerminalPanel projectSlug={projectSlug} />;
}
