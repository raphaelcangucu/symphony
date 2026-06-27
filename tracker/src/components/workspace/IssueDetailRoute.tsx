import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { resolveIssueGroup } from "@/components/issues/issue-detail/issueGroup";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import {
  isHiddenIssueTab,
  issueAgentTabPath,
  issuePath,
  resolveIssueTab,
  workspaceBasePath,
  type IssueTab,
} from "@/lib/workspaceRoutes";
import {
  archiveIssue,
  clearIssueParent,
  createSubtask,
  deleteIssue,
  forceSyncIssue,
  getIssue,
  groupIssue,
  setIssueParent,
  ungroupIssue,
} from "@/services/issues";
import { deleteJiraAttachment } from "@/services/attachments";
import type { Issue } from "@/types/issue";

export function IssueDetailRoute() {
  const { t } = useTranslation();
  const { identifier = "", tab: tabParam } = useParams();
  const { projectSlug, view, issues, setIssues, agentExecutions, loading, trackerKind, project } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const tab: IssueTab = resolveIssueTab(tabParam);
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

  const group = issue ? resolveIssueGroup(issue, issues) : null;
  const subtasks = issue ? collectSubtasks(issue.identifier, issues) : [];
  const parentCandidates = issue ? collectParentCandidates(issue, issues) : [];
  const groupLeadCandidates = issue ? collectGroupLeadCandidates(issue, issues) : [];

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

  async function handleRemoveAttachment(attachmentId: string): Promise<boolean> {
    if (!issue) return false;
    try {
      await deleteJiraAttachment(projectSlug, attachmentId);
      const refreshed = await getIssue(projectSlug, issue.identifier);
      handleIssueUpdated(refreshed);
      toast.success(t("issue.route.attachmentRemoved"));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.attachmentRemoveFailed"));
      return false;
    }
  }

  function upsertIssue(next: Issue) {
    setIssues((current) => {
      const exists = current.some((candidate) => candidate.identifier === next.identifier);
      return exists
        ? current.map((candidate) => (candidate.identifier === next.identifier ? next : candidate))
        : [...current, next];
    });
  }

  async function handleCreateSubtask(title: string): Promise<boolean> {
    if (!issue) return false;
    try {
      const child = await createSubtask(projectSlug, issue.identifier, { title });
      upsertIssue(child);
      toast.success(t("issue.route.subtaskCreated", { identifier: child.identifier }));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.subtaskCreateFailed"));
      return false;
    }
  }

  async function handleSetParent(parentIdentifier: string): Promise<boolean> {
    if (!issue) return false;
    try {
      const updated = await setIssueParent(projectSlug, issue.identifier, parentIdentifier);
      handleIssueUpdated(updated);
      toast.success(t("issue.route.parentSet", { identifier: parentIdentifier }));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.parentSetFailed"));
      return false;
    }
  }

  async function handleClearParent(): Promise<boolean> {
    if (!issue) return false;
    try {
      const updated = await clearIssueParent(projectSlug, issue.identifier);
      handleIssueUpdated(updated);
      toast.success(t("issue.route.parentCleared"));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.parentClearFailed"));
      return false;
    }
  }

  async function handleSetGroupLead(leadIdentifier: string): Promise<boolean> {
    if (!issue) return false;
    try {
      const updated = await groupIssue(projectSlug, issue.identifier, leadIdentifier);
      handleIssueUpdated(updated);
      toast.success(t("issue.route.groupLeadSet", { identifier: leadIdentifier }));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.groupLeadSetFailed"));
      return false;
    }
  }

  async function handleClearGroupLead(): Promise<boolean> {
    if (!issue) return false;
    try {
      await ungroupIssue(projectSlug, issue.identifier);
      const refreshed = await getIssue(projectSlug, issue.identifier);
      handleIssueUpdated(refreshed);
      toast.success(t("issue.route.groupLeadCleared"));
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.route.groupLeadClearFailed"));
      return false;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!identifier || !isHiddenIssueTab(tabParam)) return;
    navigate({ pathname: issuePath(projectSlug, view, identifier, tab), search: location.search }, { replace: true });
  }, [identifier, tab, tabParam, projectSlug, view, location.search, navigate]);

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
      subtasks={subtasks}
      subtaskExecutions={agentExecutions}
      parentCandidates={parentCandidates}
      groupLeadCandidates={groupLeadCandidates}
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
      onRemoveAttachment={trackerKind === "jira" ? handleRemoveAttachment : undefined}
      onIssueUpdated={handleIssueUpdated}
      group={group}
      onOpenIssue={(targetIdentifier) => {
        navigate({ pathname: issuePath(projectSlug, view, targetIdentifier), search: location.search });
      }}
      onCreateSubtask={handleCreateSubtask}
      onSetParent={handleSetParent}
      onClearParent={issue?.parentIdentifier ? handleClearParent : undefined}
      onSetGroupLead={handleSetGroupLead}
      onClearGroupLead={issue?.groupLeadIdentifier ? handleClearGroupLead : undefined}
    />
  );
}

/** Children whose parentIdentifier points at this issue, ordered like the board. */
function collectSubtasks(parentIdentifier: string, issues: readonly Issue[]): Issue[] {
  const parentKey = normalizeIssueIdentifier(parentIdentifier);
  if (!parentKey) return [];

  return issues
    .filter(
      (candidate) =>
        candidate.parentIdentifier != null &&
        normalizeIssueIdentifier(candidate.parentIdentifier) === parentKey,
    )
    .sort((left, right) => left.position - right.position);
}

/**
 * Valid parents for an issue: every other issue except itself and its own
 * (transitive) descendants — picking one of those would create a cycle, which
 * the backend rejects too.
 */
function collectParentCandidates(issue: Issue, issues: readonly Issue[]): Issue[] {
  const blocked = collectDescendantKeys(issue.identifier, issues);
  blocked.add(normalizeIssueIdentifier(issue.identifier));
  return issues.filter((candidate) => !blocked.has(normalizeIssueIdentifier(candidate.identifier)));
}

/** Valid group leads: every other issue (backend rejects nested/lead-member). */
function collectGroupLeadCandidates(issue: Issue, issues: readonly Issue[]): Issue[] {
  const selfKey = normalizeIssueIdentifier(issue.identifier);
  return issues.filter((candidate) => normalizeIssueIdentifier(candidate.identifier) !== selfKey);
}

function collectDescendantKeys(identifier: string, issues: readonly Issue[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const candidate of issues) {
    if (candidate.parentIdentifier == null) continue;
    const parentKey = normalizeIssueIdentifier(candidate.parentIdentifier);
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(normalizeIssueIdentifier(candidate.identifier));
    childrenByParent.set(parentKey, list);
  }

  const descendants = new Set<string>();
  const stack = [normalizeIssueIdentifier(identifier)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null) continue;
    for (const child of childrenByParent.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      stack.push(child);
    }
  }

  return descendants;
}
