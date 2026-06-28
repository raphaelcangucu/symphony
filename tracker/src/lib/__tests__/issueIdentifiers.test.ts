import { describe, expect, it } from "vitest";

import { issueDisplayIdentifier, normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

describe("normalizeIssueIdentifier", () => {
  it("strips a leading GitHub hash from issue identifiers", () => {
    expect(normalizeIssueIdentifier("#508")).toBe("508");
    expect(normalizeIssueIdentifier(" #508 ")).toBe("508");
  });

  it("preserves non-GitHub tracker identifiers", () => {
    expect(normalizeIssueIdentifier("MAC-1")).toBe("MAC-1");
  });
});

describe("issueDisplayIdentifier", () => {
  it("prefers the external display identifier once reconciled", () => {
    expect(issueDisplayIdentifier({ identifier: "MAC-5", displayIdentifier: "front#547" })).toBe("front#547");
  });

  it("falls back to the canonical identifier when display is missing or blank", () => {
    expect(issueDisplayIdentifier({ identifier: "MAC-1", displayIdentifier: null })).toBe("MAC-1");
    expect(issueDisplayIdentifier({ identifier: "MAC-1", displayIdentifier: "   " })).toBe("MAC-1");
    expect(issueDisplayIdentifier({ identifier: "MAC-1" })).toBe("MAC-1");
  });
});
