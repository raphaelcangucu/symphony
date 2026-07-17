import { describe, expect, it } from "vitest";

import {
  findIssueInventoryEntry,
  mergeCloneBranchDefaults,
  resolveDefaultCloneBranches,
} from "@/lib/defaultCloneBranches";
import type { WorkspaceCloneRepoOption } from "@/lib/workspaceCloneRepos";
import type { PullRequest } from "@/types/pull-request";
import type { WorkspaceInventoryEntry, WorkspaceRepoState } from "@/types/worktrees";

const advisingRepo: WorkspaceCloneRepoOption = {
  key: "advising",
  label: "advising",
  defaultBranch: "main",
  githubFullName: "civitaslearning/advising",
};

const webRepo: WorkspaceCloneRepoOption = {
  key: "web",
  label: "web",
  defaultBranch: "main",
  githubFullName: "civitaslearning/web",
};

function inventoryRepo(name: string, branch: string | null): WorkspaceRepoState {
  return {
    name,
    path: `/tmp/${name}`,
    branch,
    defaultBranch: "main",
    dirty: false,
    upstream: true,
    aheadCount: 0,
    sizeBytes: 0,
  };
}

function pullRequest(overrides: Partial<PullRequest> & Pick<PullRequest, "number" | "headRef" | "repo">): PullRequest {
  return {
    title: null,
    url: null,
    state: "open",
    origin: "auto",
    rawState: "OPEN",
    isDraft: false,
    merged: false,
    baseRef: "main",
    author: null,
    createdAt: null,
    updatedAt: "2026-07-16T12:00:00.000Z",
    mergedAt: null,
    mergeable: "MERGEABLE",
    checksState: null,
    pipelines: [],
    statuses: [],
    conversation: [],
    baseBehindBy: null,
    monitor: null,
    ...overrides,
  };
}

describe("resolveDefaultCloneBranches", () => {
  it("uses working-tree branches for issue and parent targets", () => {
    expect(
      resolveDefaultCloneBranches({
        target: "issue",
        repos: [advisingRepo, webRepo],
        inventoryRepos: [
          inventoryRepo("advising", "CDE-1180-advisor-groups-placeholder"),
          inventoryRepo("web", "feature/web"),
        ],
        pullRequests: [
          pullRequest({
            number: 1,
            repo: "civitaslearning/advising",
            headRef: "pr-branch-should-not-win",
          }),
        ],
      }),
    ).toEqual({
      advising: "CDE-1180-advisor-groups-placeholder",
      web: "feature/web",
    });

    expect(
      resolveDefaultCloneBranches({
        target: "parent",
        repos: [advisingRepo],
        inventoryRepos: [inventoryRepo("advising", "parent-tree-branch")],
        pullRequests: [],
      }),
    ).toEqual({ advising: "parent-tree-branch" });
  });

  it("uses open PR head refs for isolated target", () => {
    expect(
      resolveDefaultCloneBranches({
        target: "isolated",
        repos: [advisingRepo, webRepo],
        inventoryRepos: [inventoryRepo("advising", "working-tree-branch")],
        pullRequests: [
          pullRequest({
            number: 9,
            repo: "civitaslearning/advising",
            headRef: "CDE-1180-advisor-groups-placeholder",
          }),
        ],
      }),
    ).toEqual({ advising: "CDE-1180-advisor-groups-placeholder" });
  });

  it("prefers non-draft open PRs and the most recently updated match", () => {
    expect(
      resolveDefaultCloneBranches({
        target: "isolated",
        repos: [advisingRepo],
        inventoryRepos: [],
        pullRequests: [
          pullRequest({
            number: 1,
            repo: "civitaslearning/advising",
            headRef: "older-open",
            updatedAt: "2026-07-01T00:00:00.000Z",
          }),
          pullRequest({
            number: 2,
            repo: "civitaslearning/advising",
            headRef: "draft-newer",
            isDraft: true,
            updatedAt: "2026-07-16T20:00:00.000Z",
          }),
          pullRequest({
            number: 3,
            repo: "civitaslearning/advising",
            headRef: "newer-open",
            updatedAt: "2026-07-16T12:00:00.000Z",
          }),
          pullRequest({
            number: 4,
            repo: "civitaslearning/advising",
            headRef: "closed-head",
            state: "closed",
            updatedAt: "2026-07-17T00:00:00.000Z",
          }),
        ],
      }),
    ).toEqual({ advising: "newer-open" });
  });

  it("skips repos without a usable branch source", () => {
    expect(
      resolveDefaultCloneBranches({
        target: "issue",
        repos: [advisingRepo],
        inventoryRepos: [inventoryRepo("advising", "   ")],
        pullRequests: [],
      }),
    ).toEqual({});

    expect(
      resolveDefaultCloneBranches({
        target: "isolated",
        repos: [advisingRepo],
        inventoryRepos: [],
        pullRequests: [],
      }),
    ).toEqual({});
  });
});

describe("mergeCloneBranchDefaults", () => {
  it("applies defaults only to keys the user has not edited", () => {
    expect(
      mergeCloneBranchDefaults(
        { advising: "typed-by-user", web: "old-default" },
        { advising: "from-tree", web: "from-tree-web", api: "from-tree-api" },
        new Set(["advising"]),
      ),
    ).toEqual({
      advising: "typed-by-user",
      web: "from-tree-web",
      api: "from-tree-api",
    });
  });

  it("clears non-dirty keys when the new default removes them", () => {
    expect(
      mergeCloneBranchDefaults({ advising: "stale", web: "keep-me" }, { web: "keep-me" }, new Set(["web"])),
    ).toEqual({ web: "keep-me" });
  });
});

describe("findIssueInventoryEntry", () => {
  it("finds the canonical issue working tree by identifier", () => {
    const entries: WorkspaceInventoryEntry[] = [
      {
        path: "/tmp/parallel",
        displayName: null,
        kind: "issue_parallel",
        issueIdentifier: "CDE-1180",
        name: null,
        classification: "active",
        reclaimable: false,
        workPresent: true,
        executionStatus: null,
        removable: true,
        sizeBytes: 1,
        repos: [inventoryRepo("advising", "parallel-branch")],
        childWorktrees: [],
      },
      {
        path: "/tmp/canonical",
        displayName: null,
        kind: "issue",
        issueIdentifier: "CDE-1180",
        name: null,
        classification: "active",
        reclaimable: false,
        workPresent: true,
        executionStatus: null,
        removable: true,
        sizeBytes: 1,
        repos: [inventoryRepo("advising", "canonical-branch")],
        childWorktrees: [],
      },
    ];

    expect(findIssueInventoryEntry(entries, "CDE-1180")?.path).toBe("/tmp/canonical");
    expect(findIssueInventoryEntry(entries, "#CDE-1180")?.repos[0]?.branch).toBe("canonical-branch");
    expect(findIssueInventoryEntry(entries, "OTHER-1")).toBeNull();
  });
});
