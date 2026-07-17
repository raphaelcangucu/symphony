import { describe, expect, it } from "vitest";

import { sessionLogIssueTopic, sessionLogTopic } from "@/services/session-log";

describe("sessionLogTopic", () => {
  it("keys the channel by numeric session id", () => {
    expect(sessionLogTopic(42)).toBe("session_log:42");
    expect(sessionLogTopic("9001")).toBe("session_log:9001");
  });

  it("rejects blank session ids", () => {
    expect(() => sessionLogTopic("")).toThrow(/session id/);
    expect(() => sessionLogTopic("   ")).toThrow(/session id/);
  });
});

describe("sessionLogIssueTopic", () => {
  it("keeps the legacy per-issue topic shape", () => {
    expect(sessionLogIssueTopic("advising", "CDE-1180")).toBe("session_log:advising:CDE-1180");
  });
});
