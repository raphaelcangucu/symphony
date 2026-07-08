import { useIssueComments, type UseIssueCommentsResult } from "@/hooks/useIssueComments";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import { useIssueEditor } from "@/hooks/useIssueEditor";
import { useIssueEvidence, type UseIssueEvidenceResult } from "@/hooks/useIssueEvidence";
import { useIssuePullRequests, type UseIssuePullRequestsResult } from "@/hooks/useIssuePullRequests";
import { useIssueUpdater } from "@/hooks/useIssueUpdater";
import { useLabSettings } from "@/hooks/useLabSettings";
import type { Issue } from "@/types/issue";

interface UseIssueDrawerDataArgs {
  projectSlug: string;
  issue: Issue | null;
  open: boolean;
  onIssueUpdated?: (updated: Issue) => void;
}

export interface UseIssueDrawerDataResult {
  lab: ReturnType<typeof useLabSettings>;
  pr: UseIssuePullRequestsResult;
  comments: UseIssueCommentsResult;
  evidence: UseIssueEvidenceResult;
  commitEvidence: ReturnType<typeof useIssueCommitEvidence>;
  editor: ReturnType<typeof useIssueEditor>;
  issueUpdater: ReturnType<typeof useIssueUpdater>;
}

/**
 * Bundles every data domain the issue drawer needs (PRs, comments, evidence,
 * commit evidence, editor targets, lab settings, updater) behind one hook so
 * the drawer component focuses on layout and tab routing.
 */
export function useIssueDrawerData({
  projectSlug,
  issue,
  open,
  onIssueUpdated,
}: UseIssueDrawerDataArgs): UseIssueDrawerDataResult {
  const identifier = issue?.identifier ?? null;
  const enabled = open && Boolean(issue);

  const lab = useLabSettings(enabled);
  const pr = useIssuePullRequests({ projectSlug, identifier, enabled });
  const comments = useIssueComments({ projectSlug, identifier, enabled });
  const evidence = useIssueEvidence({ projectSlug, identifier, enabled });
  const commitEvidence = useIssueCommitEvidence({ projectSlug, identifier, enabled });
  const editor = useIssueEditor({ projectSlug, identifier, enabled });
  const issueUpdater = useIssueUpdater({ projectSlug, issue, onUpdated: onIssueUpdated });

  return { lab, pr, comments, evidence, commitEvidence, editor, issueUpdater };
}
