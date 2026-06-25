import { describe, expect, it } from "vitest";

import type { PullRequest } from "@/types/pull-request";

import { hasFailingChecks, hasMergeConflicts } from "../pr-meta";

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    number: 1, title: null, url: null, state: "open", repo: null, origin: "auto", rawState: null, isDraft: false,
    merged: false, headRef: null, baseRef: null, author: null, createdAt: null,
    updatedAt: null, mergedAt: null, mergeable: null, checksState: null, pipelines: [], statuses: [],
    conversation: [], baseBehindBy: null, monitor: null, ...overrides,
  };
}

describe("hasFailingChecks", () => {
  it("is true when any job conclusion is a failure", () => {
    const value = pr({
      pipelines: [{ name: "CI", url: null, jobs: [{ name: "t", status: "COMPLETED", conclusion: "FAILURE", url: null, startedAt: null, completedAt: null }] }],
    });
    expect(hasFailingChecks(value)).toBe(true);
  });

  it("is false when all jobs succeeded or were skipped", () => {
    const value = pr({
      pipelines: [{ name: "CI", url: null, jobs: [{ name: "t", status: "COMPLETED", conclusion: "SUCCESS", url: null, startedAt: null, completedAt: null }] }],
    });
    expect(hasFailingChecks(value)).toBe(false);
  });
});

describe("hasMergeConflicts", () => {
  it("is true for an open PR GitHub reports as CONFLICTING", () => {
    expect(hasMergeConflicts(pr({ state: "open", mergeable: "CONFLICTING" }))).toBe(true);
  });

  it("is true for a draft PR with conflicts", () => {
    expect(hasMergeConflicts(pr({ state: "draft", mergeable: "CONFLICTING" }))).toBe(true);
  });

  it("is false when mergeable is MERGEABLE, UNKNOWN, or null", () => {
    expect(hasMergeConflicts(pr({ state: "open", mergeable: "MERGEABLE" }))).toBe(false);
    expect(hasMergeConflicts(pr({ state: "open", mergeable: "UNKNOWN" }))).toBe(false);
    expect(hasMergeConflicts(pr({ state: "open", mergeable: null }))).toBe(false);
  });

  it("is false for merged/closed PRs even if mergeable is stale CONFLICTING", () => {
    expect(hasMergeConflicts(pr({ state: "merged", mergeable: "CONFLICTING" }))).toBe(false);
    expect(hasMergeConflicts(pr({ state: "closed", mergeable: "CONFLICTING" }))).toBe(false);
  });
});
