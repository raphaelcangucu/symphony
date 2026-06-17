import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import {
  DEFAULT_ISSUE_TAB,
  isIssueTab,
  issueAgentTabPath,
  issuePath,
  workspaceBasePath,
  type IssueTab,
} from "@/lib/workspaceRoutes";
import { archiveIssue, deleteIssue, forceSyncIssue, getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

export function IssueDetailRoute() {
  const { t } = useTranslation();
  const { identifier = "", tab: tabParam } = useParams();
  const { projectSlug, view, issues, setIssues, agentExecutions, loading, trackerKind, project } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const tab: IssueTab = isIssueTab(tabParam) ? tabParam : DEFAULT_ISSUE_TAB;
  const issueFromList = issues.find((candidate) => candidate.identifier === identifier) ?? null;
  const [fetchedIssue, setFetchedIssue] = useState<Issue | null>(null);
  // Tracks the (project, issue) we've already requested so unrelated board churn
  // (realtime upserts, polling refreshes, agent-execution updates) can't re-fire
  // the full fetch before the first request resolves.
  const requestedKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const matchedFetched = fetchedIssue?.identifier === identifier ? fetchedIssue : null;
  // Prefer the freshly fetched issue: it carries remote-only data (e.g. Jira
  // attachments) that the board list endpoint omits. Fall back to the cached
  // list entry for an instant first paint while the full fetch is in flight.
  const issue = matchedFetched ?? issueFromList;

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
      toast.success(t("issue.route.archived", { identifier: target.identifier }));
      goToBase();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.archiveFailed"));
    }
  }

  async function handleDelete(target: Issue) {
    try {
      await deleteIssue(projectSlug, target.identifier);
      removeFromBoard(target);
      toast.success(t("issue.route.deleted", { identifier: target.identifier }));
      goToBase();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.deleteFailed"));
    }
  }

  function handleIssueUpdated(updated: Issue) {
    setIssues((current) =>
      current.map((candidate) => (candidate.identifier === updated.identifier ? updated : candidate)),
    );
    if (fetchedIssue?.identifier === updated.identifier) setFetchedIssue(updated);
  }

  async function handleForceSync(target: Issue) {
    try {
      const refreshed = await forceSyncIssue(projectSlug, target.identifier);
      setIssues((current) =>
        current.map((candidate) => (candidate.identifier === refreshed.identifier ? refreshed : candidate)),
      );
      if (fetchedIssue?.identifier === refreshed.identifier) setFetchedIssue(refreshed);
      toast.success(t("issue.route.synced", { identifier: target.identifier }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.syncFailed"));
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!identifier || loading) return;

    const requestKey = `${projectSlug}::${identifier}`;
    // Fetch the full issue exactly once per open issue. Live changes flow back in
    // through the board list and handleIssueUpdated, so re-running this effect for
    // other reasons must not trigger another GET request.
    if (requestedKeyRef.current === requestKey) return;
    requestedKeyRef.current = requestKey;

    void getIssue(projectSlug, identifier)
      .then((loaded) => {
        // Ignore stale results from an issue the user already navigated away from.
        if (!mountedRef.current || requestedKeyRef.current !== requestKey) return;
        setFetchedIssue(loaded);
      })
      .catch(() => {
        if (!mountedRef.current || requestedKeyRef.current !== requestKey) return;
        // Allow a later render to retry this issue (e.g. once the board loads).
        requestedKeyRef.current = null;
        // Keep showing the cached list entry if we have one; only bounce back to
        // the board when there is nothing at all to display.
        if (!issueFromList) {
          toast.error(t("issue.route.notFound", { identifier }));
          navigate({ pathname: basePath, search: location.search }, { replace: true });
        }
      });
  }, [identifier, issueFromList, loading, projectSlug, basePath, location.search, navigate]);

  return (
    <IssueDrawer
      projectSlug={projectSlug}
      view={view}
      issue={issue}
      execution={issue ? agentExecutions.get(issue.identifier) : undefined}
      workflowMarkdown={project?.setup?.workflowMarkdown ?? null}
      open
      onOpenChange={(open) => {
        if (!open) goToBase();
      }}
      tab={tab}
      onTabChange={(nextTab) => {
        navigate({ pathname: issuePath(projectSlug, view, identifier, nextTab), search: location.search }, { replace: true });
      }}
      onOpenAgentExecution={() => {
        navigate(
          {
            pathname: issueAgentTabPath(projectSlug, view, identifier, "execution"),
            search: location.search,
          },
          { replace: true },
        );
      }}
      onArchive={handleArchive}
      onDelete={handleDelete}
      onForceSync={trackerKind === "local" ? undefined : handleForceSync}
      onIssueUpdated={handleIssueUpdated}
    />
  );
}
