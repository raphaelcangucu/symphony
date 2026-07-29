import { describe, expect, it } from "vitest";

import { pullRequestHealth } from "./issue-pr-state";

describe("pull request health", () => {
  it("separates passing, pending, and failing checks with merge blockers", () => {
    const health = pullRequestHealth({
      checksState: "failure",
      mergeable: "conflicting",
      pipelines: [
        {
          name: "CI",
          url: null,
          jobs: [
            { name: "Build", status: "completed", conclusion: "success", url: null },
            { name: "Review", status: "in_progress", conclusion: null, url: null },
            { name: "Lint", status: "completed", conclusion: "failure", url: null },
          ],
        },
      ],
      statuses: [],
    });

    expect(health.checks.map((check) => [check.label, check.tone])).toEqual([
      ["Build", "success"],
      ["Review", "warning"],
      ["Lint", "failure"],
    ]);
    expect(health.tone).toBe("failure");
    expect(health.problemCount).toBe(2);
  });
});
