import { useLocation, useNavigate } from "react-router-dom";

import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { workspaceBasePath } from "@/lib/workspaceRoutes";
import type { WorkflowStatusName } from "@/types/workflow-status";

export function NewIssueRoute() {
  const { projectSlug, view, workflowStatuses, setIssues } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const statusNames = workflowStatuses?.map((status) => status.name);
  const requestedStatus = new URLSearchParams(location.search).get("status");
  const defaultStatus =
    requestedStatus && (statusNames?.includes(requestedStatus) ?? false)
      ? (requestedStatus as WorkflowStatusName)
      : undefined;

  function close() {
    navigate({ pathname: workspaceBasePath(projectSlug, view), search: stripStatus(location.search) });
  }

  return (
    <IssueCreateDialog
      projectSlug={projectSlug}
      statuses={statusNames}
      defaultStatus={defaultStatus}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onCreated={(issue) => {
        setIssues((current) => [...current, issue]);
        close();
      }}
    />
  );
}

function stripStatus(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("status");
  const next = params.toString();
  return next ? `?${next}` : "";
}
