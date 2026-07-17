import { describe, expect, it } from "vitest";

import { resolveExecutionSessionId } from "@/lib/resolveExecutionSessionId";

describe("resolveExecutionSessionId", () => {
  it("returns the execution session id for a matching issue", () => {
    expect(
      resolveExecutionSessionId(
        [
          { issueIdentifier: "CDE-1", executionSessionId: null },
          { issueIdentifier: "CDE-1180", executionSessionId: 9001 },
        ],
        "CDE-1180",
      ),
    ).toBe(9001);
  });

  it("returns null when the issue has no execution session id", () => {
    expect(
      resolveExecutionSessionId(
        [{ issueIdentifier: "CDE-1180", executionSessionId: null }],
        "CDE-1180",
      ),
    ).toBeNull();
  });

  it("returns null for blank identifiers", () => {
    expect(
      resolveExecutionSessionId(
        [{ issueIdentifier: "CDE-1180", executionSessionId: 1 }],
        "  ",
      ),
    ).toBeNull();
  });
});
