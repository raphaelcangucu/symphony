import type { WorkspaceRepository } from "@/types/repository";
import type { WorkspaceRepoState } from "@/types/worktrees";

export interface WorkspaceCloneRepoOption {
  /** Directory name sent to the API (`branches` / `clone_branches` keys). */
  key: string;
  label: string;
  defaultBranch: string | null;
  /** GitHub `owner/repo` used to filter remote branch suggestions. */
  githubFullName: string | null;
}

const FALLBACK_BRANCHES = ["pre-release", "main", "master"] as const;

export function workspaceCloneRepoOptions(
  inventoryRepos: readonly WorkspaceRepoState[],
  configuredRepos: readonly WorkspaceRepository[] | undefined,
): WorkspaceCloneRepoOption[] {
  const configured = configuredRepos ?? [];
  const configuredByPath = new Map(
    configured
      .map((repo) => {
        const key = repo.workspacePath.trim();
        return key ? ([key, repo] as const) : null;
      })
      .filter((entry): entry is readonly [string, WorkspaceRepository] => entry !== null),
  );

  if (inventoryRepos.length > 0) {
    return inventoryRepos.map((repo) => {
      const match = configuredByPath.get(repo.name);
      return {
        key: repo.name,
        label: repo.name,
        defaultBranch: repo.defaultBranch ?? repo.branch ?? match?.selectedBranch ?? match?.defaultBranch ?? null,
        githubFullName: match?.fullName?.trim() || null,
      };
    });
  }

  return configured
    .map((repo) => {
      const key = repo.workspacePath.trim();
      if (!key) return null;
      return {
        key,
        label: key,
        defaultBranch: repo.selectedBranch ?? repo.defaultBranch ?? null,
        githubFullName: repo.fullName.trim() || null,
      };
    })
    .filter((repo): repo is WorkspaceCloneRepoOption => repo !== null);
}

export function buildCloneBranchOverrides(
  repos: readonly WorkspaceCloneRepoOption[],
  branches: Record<string, string>,
): Record<string, string> | undefined {
  if (repos.length === 0) return undefined;

  const overrides = Object.fromEntries(
    repos.flatMap((repo) => {
      const branch = branches[repo.key]?.trim();
      return branch ? [[repo.key, branch]] : [];
    }),
  );

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** Maps UI branch values to API clone_branches / clone_branch payloads. */
export function resolveCloneBranchApiPayload(
  branches: Record<string, string>,
  options: { defaultCloneBranch?: string | null } = {},
): { cloneBranches?: Record<string, string>; cloneBranch?: string } {
  const overrides = Object.fromEntries(
    Object.entries(branches).flatMap(([key, branch]) => {
      const trimmed = branch.trim();
      if (!trimmed || key === "__default__") return [];
      return [[key, trimmed]];
    }),
  );

  if (Object.keys(overrides).length > 0) {
    return { cloneBranches: overrides };
  }

  const global = branches.__default__?.trim();
  const fallback = options.defaultCloneBranch?.trim();
  if (global) return { cloneBranch: global };
  if (fallback) return { cloneBranch: fallback };
  return {};
}

/** Static suggestions when GitHub branch list is empty or failed. */
export function fallbackBranchSuggestions(defaultBranch: string | null | undefined): string[] {
  const values = [defaultBranch?.trim() || null, ...FALLBACK_BRANCHES].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(values)];
}

export function branchNamesForRepo(
  remoteBranches: readonly { name: string; repo: string | null }[],
  repo: WorkspaceCloneRepoOption,
): string[] {
  const fullName = repo.githubFullName?.trim().toLowerCase() || null;
  const key = repo.key.trim().toLowerCase();

  const matched = remoteBranches
    .filter((branch) => {
      const remoteRepo = branch.repo?.trim().toLowerCase() || "";
      if (!remoteRepo || !branch.name.trim()) return false;
      if (fullName && remoteRepo === fullName) return true;
      return remoteRepo === key || remoteRepo.endsWith(`/${key}`);
    })
    .map((branch) => branch.name.trim());

  if (matched.length > 0) return [...new Set(matched)].sort((left, right) => left.localeCompare(right));
  return fallbackBranchSuggestions(repo.defaultBranch);
}
