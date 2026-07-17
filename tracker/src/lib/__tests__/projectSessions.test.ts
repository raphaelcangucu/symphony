import { describe, expect, it } from "vitest";

import {
  groupProjectSessions,
  mergeExecutionsFromSessionRows,
  sessionBucketFor,
} from "@/lib/projectSessions";
import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
import type { ProjectSessionRow as SessionApiRow } from "@/types/project-session";

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
    executionSessionId: null,
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

  it("synthesizes executions from autonomous exec: session rows missing from the live map", () => {
    const live = new Map([["DEMO-1", execution("DEMO-1", "live")]]);
    const sessions: SessionApiRow[] = [
      {
        id: "exec:CDE-1180",
        title: "Adjust placeholder",
        kind: "execution",
        href: "/projects/advising/workspaces?exec=CDE-1180&surface=autonomous",
        updatedAt: "2026-07-16T21:00:00Z",
        aggregateStatus: "live",
        agentKind: "cursor",
        issueIdentifier: "CDE-1180",
        workspacePath: "/tmp/CDE-1180",
        workspaceId: null,
        pinned: false,
        archived: false,
      },
      {
        id: "thread:8006",
        title: "Thread execution",
        kind: "execution",
        href: "/projects/advising/workspaces/8006",
        updatedAt: "2026-07-16T20:00:00Z",
        aggregateStatus: "active",
        agentKind: "codex",
        issueIdentifier: "CDE-1131",
        workspacePath: null,
        workspaceId: null,
        pinned: false,
        archived: false,
      },
    ];

    const merged = mergeExecutionsFromSessionRows(live, sessions);

    expect(merged.get("DEMO-1")?.status).toBe("live");
    expect(merged.get("CDE-1180")).toMatchObject({
      issueIdentifier: "CDE-1180",
      status: "live",
      agentKind: "cursor",
      lastEventAt: "2026-07-16T21:00:00Z",
    });
    expect(merged.has("CDE-1131")).toBe(false);
  });
});
