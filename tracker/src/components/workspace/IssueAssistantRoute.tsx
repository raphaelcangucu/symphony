import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { issueAssistantPath } from "@/lib/workspaceRoutes";

export function IssueAssistantRoute() {
  const { issueId } = useParams();
  const navigate = useNavigate();
  const { issues, projectSlug, view } = useWorkspace();
  const identifier = issueId?.trim() ? issueId : undefined;
  const normalizedIdentifier = normalizeIssueIdentifier(identifier);
  const issue = useMemo(
    () =>
      normalizedIdentifier
        ? issues.find((candidate) => normalizeIssueIdentifier(candidate.identifier) === normalizedIdentifier) ?? null
        : null,
    [issues, normalizedIdentifier],
  );

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
      issue={issue}
      view={view}
      onIssueCreated={handleIssueCreated}
    />
  );
}
