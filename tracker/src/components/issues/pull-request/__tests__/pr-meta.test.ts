import { describe, expect, it } from "vitest";

import type { PullRequest } from "@/types/pull-request";

import { hasFailingChecks } from "../pr-meta";

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    number: 1, title: null, url: null, state: "open", rawState: null, isDraft: false,
    merged: false, headRef: null, baseRef: null, author: null, createdAt: null,
    updatedAt: null, mergedAt: null, checksState: null, pipelines: [], statuses: [],
    conversation: [], ...overrides,
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
