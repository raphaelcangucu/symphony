import { useParams } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";

export function IssueAssistantRoute() {
  const { issueId } = useParams();
  const { projectSlug, view } = useWorkspace();
  const identifier = issueId?.trim() ? issueId : undefined;

  return <IssueAuthoringPanel projectSlug={projectSlug} identifier={identifier} view={view} />;
}
