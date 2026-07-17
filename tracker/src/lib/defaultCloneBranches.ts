import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { WorkspaceCloneRepoOption } from "@/lib/workspaceCloneRepos";
import type { PullRequest } from "@/types/pull-request";
import type { WorkspaceInventoryEntry, WorkspaceRepoState } from "@/types/worktrees";

export type CloneBranchWorkspaceTarget = "issue" | "parent" | "isolated";

export type DefaultCloneBranchPullRequest = Pick<
  PullRequest,
  "repo" | "headRef" | "state" | "isDraft" | "merged" | "updatedAt"
>;

interface ResolveDefaultCloneBranchesArgs {
  target: CloneBranchWorkspaceTarget;
  repos: readonly WorkspaceCloneRepoOption[];
  inventoryRepos?: readonly WorkspaceRepoState[] | null;
  pullRequests?: readonly DefaultCloneBranchPullRequest[] | null;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function repoMatchesPullRequest(repo: WorkspaceCloneRepoOption, pullRequest: DefaultCloneBranchPullRequest): boolean {
  const prRepo = pullRequest.repo?.trim().toLowerCase() || "";
  if (!prRepo) return false;

  const fullName = repo.githubFullName?.trim().toLowerCase() || null;
  const key = repo.key.trim().toLowerCase();
  if (fullName && prRepo === fullName) return true;
  return prRepo === key || prRepo.endsWith(`/${key}`);
}

function updatedAtMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectPullRequestHeadRef(
  repo: WorkspaceCloneRepoOption,
  pullRequests: readonly DefaultCloneBranchPullRequest[],
): string | null {
  const matches = pullRequests.filter(
    (pullRequest) =>
      !pullRequest.merged &&
      pullRequest.state === "open" &&
      Boolean(nonBlank(pullRequest.headRef)) &&
      repoMatchesPullRequest(repo, pullRequest),
  );

  if (matches.length === 0) return null;

  const ranked = [...matches].sort((left, right) => {
    if (left.isDraft !== right.isDraft) return left.isDraft ? 1 : -1;
    return updatedAtMs(right.updatedAt) - updatedAtMs(left.updatedAt);
  });

  return nonBlank(ranked[0]?.headRef);
}

function branchFromInventory(
  repo: WorkspaceCloneRepoOption,
  inventoryRepos: readonly WorkspaceRepoState[],
): string | null {
  const key = repo.key.trim().toLowerCase();
  const match = inventoryRepos.find((entry) => entry.name.trim().toLowerCase() === key);
  return nonBlank(match?.branch);
}

/** Defaults for the per-repo branch fields in StartIssueSessionDialog. */
export function resolveDefaultCloneBranches({
  target,
  repos,
  inventoryRepos = [],
  pullRequests = [],
}: ResolveDefaultCloneBranchesArgs): Record<string, string> {
  const inventory = inventoryRepos ?? [];
  const prs = pullRequests ?? [];

  return Object.fromEntries(
    repos.flatMap((repo) => {
      const branch =
        target === "isolated"
          ? selectPullRequestHeadRef(repo, prs)
          : branchFromInventory(repo, inventory);
      return branch ? [[repo.key, branch]] : [];
    }),
  );
}

/**
 * Applies computed defaults while preserving keys the user has already edited.
 * Non-dirty keys missing from `defaults` are removed so a target switch can clear
 * stale prefill.
 */
export function mergeCloneBranchDefaults(
  current: Record<string, string>,
  defaults: Record<string, string>,
  dirtyKeys: ReadonlySet<string>,
): Record<string, string> {
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(current)) {
    if (dirtyKeys.has(key)) next[key] = value;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (dirtyKeys.has(key)) continue;
    next[key] = value;
  }

  return next;
}

/** Canonical issue working tree (`kind=issue`), not parallel siblings. */
export function findIssueInventoryEntry(
  entries: readonly WorkspaceInventoryEntry[],
  issueIdentifier: string | null | undefined,
): WorkspaceInventoryEntry | null {
  const normalized = normalizeIssueIdentifier(issueIdentifier);
  if (!normalized) return null;

  return (
    entries.find(
      (entry) =>
        entry.kind === "issue" &&
        normalizeIssueIdentifier(entry.issueIdentifier) === normalized,
    ) ?? null
  );
}
