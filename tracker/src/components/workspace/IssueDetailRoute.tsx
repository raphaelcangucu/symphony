import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { DEFAULT_ISSUE_TAB, isIssueTab, issuePath, workspaceBasePath, type IssueTab } from "@/lib/workspaceRoutes";
import { getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

export function IssueDetailRoute() {
  const { identifier = "", tab: tabParam } = useParams();
  const { projectSlug, view, issues, agentExecutions, loading } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const tab: IssueTab = isIssueTab(tabParam) ? tabParam : DEFAULT_ISSUE_TAB;
  const issueFromList = issues.find((candidate) => candidate.identifier === identifier) ?? null;
  const [fetchedIssue, setFetchedIssue] = useState<Issue | null>(null);
  const issue = issueFromList ?? (fetchedIssue?.identifier === identifier ? fetchedIssue : null);

  const basePath = workspaceBasePath(projectSlug, view);

  function goToBase(replace = false) {
    navigate({ pathname: basePath, search: location.search }, { replace });
  }

  useEffect(() => {
    if (!identifier || issueFromList || loading) return;
    if (fetchedIssue?.identifier === identifier) return;

    let active = true;
    void getIssue(projectSlug, identifier)
      .then((loaded) => {
        if (active) setFetchedIssue(loaded);
      })
      .catch(() => {
        if (!active) return;
        toast.error(`Issue ${identifier} was not found`);
        navigate({ pathname: basePath, search: location.search }, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [identifier, issueFromList, loading, fetchedIssue, projectSlug, basePath, location.search, navigate]);

  return (
    <IssueDrawer
      projectSlug={projectSlug}
      issue={issue}
      execution={issue ? agentExecutions.get(issue.identifier) : undefined}
      open
      onOpenChange={(open) => {
        if (!open) goToBase();
      }}
      tab={tab}
      onTabChange={(nextTab) => {
        navigate({ pathname: issuePath(projectSlug, view, identifier, nextTab), search: location.search }, { replace: true });
      }}
    />
  );
}
