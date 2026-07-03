import { describe, expect, it } from "vitest";

import { combineDiffStats, diffStatsFromPatch } from "@/lib/diffStats";

describe("diffStats", () => {
  it("counts additions and deletions while ignoring file headers", () => {
    expect(diffStatsFromPatch("+++ b/a.ts\n--- a/a.ts\n+new\n-old\n context")).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("combines stats", () => {
    expect(combineDiffStats([{ additions: 1, deletions: 2 }, { additions: 3, deletions: 4 }])).toEqual({
      additions: 4,
      deletions: 6,
    });
  });
});
