import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { DEFAULT_ISSUE_TAB, isIssueTab, issuePath, workspaceBasePath, type IssueTab } from "@/lib/workspaceRoutes";
import { archiveIssue, deleteIssue, forceSyncIssue, getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

export function IssueDetailRoute() {
  const { identifier = "", tab: tabParam } = useParams();
  const { projectSlug, view, issues, setIssues, agentExecutions, loading, trackerKind } = useWorkspace();
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

  function removeFromBoard(target: Issue) {
    setIssues((current) => current.filter((candidate) => candidate.identifier !== target.identifier));
  }

  async function handleArchive(target: Issue) {
    try {
      await archiveIssue(projectSlug, target.identifier);
      removeFromBoard(target);
      toast.success(`${target.identifier} archived`);
      goToBase();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to archive issue");
    }
  }

  async function handleDelete(target: Issue) {
    try {
      await deleteIssue(projectSlug, target.identifier);
      removeFromBoard(target);
      toast.success(`${target.identifier} deleted`);
      goToBase();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to delete issue");
    }
  }

  async function handleForceSync(target: Issue) {
    try {
      const refreshed = await forceSyncIssue(projectSlug, target.identifier);
      setIssues((current) =>
        current.map((candidate) => (candidate.identifier === refreshed.identifier ? refreshed : candidate)),
      );
      if (fetchedIssue?.identifier === refreshed.identifier) setFetchedIssue(refreshed);
      toast.success(`${target.identifier} synced from remote`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to sync issue from remote");
    }
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
      view={view}
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
      onArchive={handleArchive}
      onDelete={handleDelete}
      onForceSync={trackerKind === "local" ? undefined : handleForceSync}
    />
  );
}
