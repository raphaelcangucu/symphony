import { describe, expect, it } from "vitest";

import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

describe("normalizeIssueIdentifier", () => {
  it("strips a leading GitHub hash from issue identifiers", () => {
    expect(normalizeIssueIdentifier("#508")).toBe("508");
    expect(normalizeIssueIdentifier(" #508 ")).toBe("508");
  });

  it("preserves non-GitHub tracker identifiers", () => {
    expect(normalizeIssueIdentifier("MAC-1")).toBe("MAC-1");
  });
});
