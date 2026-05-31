import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { issueAssistantPath } from "@/lib/workspaceRoutes";

export function IssueAssistantRoute() {
  const { issueId } = useParams();
  const navigate = useNavigate();
  const { projectSlug, view } = useWorkspace();
  const identifier = issueId?.trim() ? issueId : undefined;

  const handleIssueCreated = useCallback(
    (issue: { identifier: string }) => {
      navigate(issueAssistantPath(projectSlug, issue.identifier));
    },
    [navigate, projectSlug],
  );

  return (
    <IssueAuthoringPanel
      projectSlug={projectSlug}
      identifier={identifier}
      view={view}
      onIssueCreated={handleIssueCreated}
    />
  );
}
