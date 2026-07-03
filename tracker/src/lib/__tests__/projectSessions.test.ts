import { describe, expect, it } from "vitest";

import { groupProjectSessions, sessionBucketFor } from "@/lib/projectSessions";
import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";

function execution(
  issueIdentifier: string,
  status: AgentExecutionStatus,
  overrides: Partial<AgentExecution> = {},
): AgentExecution {
  return {
    issueIdentifier,
    status,
    agentKind: "codex",
    sessionId: `sess-${issueIdentifier}`,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-02T10:00:00Z",
    turnCount: 1,
    runtimeSeconds: 60,
    startedAt: "2026-07-02T09:59:00Z",
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
    ...overrides,
  };
}

describe("projectSessions", () => {
  it("maps statuses to buckets", () => {
    expect(sessionBucketFor("live")).toBe("active");
    expect(sessionBucketFor("retrying")).toBe("active");
    expect(sessionBucketFor("waiting")).toBe("waiting");
    expect(sessionBucketFor("idle")).toBe("waiting");
    expect(sessionBucketFor("saved")).toBe("saved");
    expect(sessionBucketFor("error")).toBe("recent");
    expect(sessionBucketFor("aborted")).toBe("recent");
  });

  it("joins executions to project issues and groups newest first", () => {
    const issues = [
      { identifier: "DEMO-1", title: "Older live" },
      { identifier: "DEMO-2", title: "Saved work" },
      { identifier: "DEMO-3", title: "Newer live" },
    ];

    const grouped = groupProjectSessions(
      [
        execution("DEMO-1", "live", { lastEventAt: "2026-07-02T10:00:00Z" }),
        execution("OTHER-9", "live"),
        execution("DEMO-2", "saved"),
        execution("DEMO-3", "retrying", { lastEventAt: "2026-07-02T11:00:00Z" }),
      ],
      issues,
    );

    expect(grouped.active.map((session) => session.issueIdentifier)).toEqual(["DEMO-3", "DEMO-1"]);
    expect(grouped.saved.map((session) => session.issueIdentifier)).toEqual(["DEMO-2"]);
    expect(grouped.active.find((session) => session.issueIdentifier === "OTHER-9")).toBeUndefined();
  });
});
