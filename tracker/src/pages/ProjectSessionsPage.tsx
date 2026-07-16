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
  // `exec` wins over `new=1` so issue-bound deep links are never shadowed.
  const activeNewIssue =
    searchParams.get("new") === "1" && !activeAuthoringIdentifier && !activeExecutionIdentifier;

  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  return (
    <ProjectSessionsPanel
      projectSlug={projectSlug}
      activeExecutionIdentifier={activeExecutionIdentifier}
      activeAuthoringIdentifier={activeAuthoringIdentifier}
      activeNewIssue={activeNewIssue}
    />
  );
}
