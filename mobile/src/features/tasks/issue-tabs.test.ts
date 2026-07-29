import { describe, expect, it } from "vitest";

import { ISSUE_TABS } from "./issue-tabs";

describe("issue tabs", () => {
  it("keeps only the five task sections approved for mobile", () => {
    expect(ISSUE_TABS.map((tab) => tab.id)).toEqual([
      "summary",
      "pr",
      "comments",
      "evidence",
      "sessions",
    ]);
  });
});
