import { Navigate, useParams } from "react-router-dom";

import { projectAuthoringSessionPath, projectNewIssueWorkspacePath } from "@/lib/workspaceRoutes";

/**
 * Legacy host for `/assistant/new-issue` and `/assistant/issue/:issueId`.
 * Prefer the App-level redirect components; this remains for any direct imports.
 */
export function IssueAssistantRoute() {
  const { projectSlug = "", issueId } = useParams();
  if (!projectSlug.trim()) {
    return <Navigate to="/projects" replace />;
  }
  if (issueId?.trim()) {
    return <Navigate to={projectAuthoringSessionPath(projectSlug, issueId)} replace />;
  }
  return <Navigate to={projectNewIssueWorkspacePath(projectSlug)} replace />;
}
