import { describe, expect, it } from "vitest";

import {
  branchNamesForRepo,
  buildCloneBranchOverrides,
  fallbackBranchSuggestions,
  resolveCloneBranchApiPayload,
  workspaceCloneRepoOptions,
} from "@/lib/workspaceCloneRepos";

describe("workspaceCloneRepoOptions", () => {
  it("prefers inventory repos and attaches GitHub full names from config", () => {
    const options = workspaceCloneRepoOptions(
      [
        {
          name: "advising",
          path: "/tmp/advising",
          branch: "main",
          defaultBranch: "main",
          dirty: false,
          upstream: true,
          aheadCount: 0,
          sizeBytes: 0,
        },
      ],
      [
        {
          fullName: "civitaslearning/advising",
          workspacePath: "advising",
          role: "primary",
          selectedBranch: "pre-release",
        },
      ],
    );

    expect(options).toEqual([
      {
        key: "advising",
        label: "advising",
        defaultBranch: "main",
        githubFullName: "civitaslearning/advising",
      },
    ]);
  });

  it("falls back to configured project repositories when inventory is empty", () => {
    const options = workspaceCloneRepoOptions([], [
      {
        fullName: "civitaslearning/advising",
        workspacePath: "advising",
        role: "primary",
        selectedBranch: "pre-release",
        defaultBranch: "main",
      },
    ]);

    expect(options).toEqual([
      {
        key: "advising",
        label: "advising",
        defaultBranch: "pre-release",
        githubFullName: "civitaslearning/advising",
      },
    ]);
  });
});

describe("buildCloneBranchOverrides", () => {
  it("returns only non-empty branch overrides keyed by workspace directory", () => {
    const overrides = buildCloneBranchOverrides(
      [{ key: "advising", label: "advising", defaultBranch: "main", githubFullName: null }],
      { advising: " pre-release ", other: "  " },
    );

    expect(overrides).toEqual({ advising: "pre-release" });
  });
});

describe("branchNamesForRepo", () => {
  it("filters remote branches by github full name", () => {
    const names = branchNamesForRepo(
      [
        { name: "pre-release", repo: "civitaslearning/advising" },
        { name: "main", repo: "civitaslearning/other" },
        { name: "feature/x", repo: "civitaslearning/advising" },
      ],
      {
        key: "advising",
        label: "advising",
        defaultBranch: "main",
        githubFullName: "civitaslearning/advising",
      },
    );

    expect(names).toEqual(["feature/x", "pre-release"]);
  });

  it("falls back to static suggestions when remote list has no match", () => {
    expect(
      branchNamesForRepo([], {
        key: "advising",
        label: "advising",
        defaultBranch: "pre-release",
        githubFullName: "civitaslearning/advising",
      }),
    ).toEqual(fallbackBranchSuggestions("pre-release"));
  });
});

describe("resolveCloneBranchApiPayload", () => {
  it("prefers per-repo overrides over the global fallback key", () => {
    expect(
      resolveCloneBranchApiPayload({
        advising: "feature/x",
        __default__: "pre-release",
      }),
    ).toEqual({ cloneBranches: { advising: "feature/x" } });
  });

  it("maps the global fallback key to cloneBranch", () => {
    expect(resolveCloneBranchApiPayload({ __default__: "pre-release" })).toEqual({
      cloneBranch: "pre-release",
    });
  });
});
