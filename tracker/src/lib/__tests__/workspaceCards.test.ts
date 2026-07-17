import { describe, expect, it } from "vitest";

import {
  buildWorkspaceCards,
  canArchiveSessionRow,
  countLiveWritersForWorkspace,
  flattenWorkspaceCardsByRecency,
  formatBytes,
  linkedSessionThreadIds,
} from "@/lib/workspaceCards";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "DEMO-1",
    status: "live",
    agentKind: "codex",
    sessionId: "sess-1",
    executionSessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-02T10:00:00Z",
    turnCount: 3,
    runtimeSeconds: 120,
    startedAt: "2026-07-02T09:58:00Z",
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

function issue(identifier: string, title: string): Issue {
  return {
    id: identifier,
    identifier,
    projectSlug: "demo",
    status: "Todo",
    title,
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    attachments: [],
  };
}

function session(overrides: Partial<RecentSession>): RecentSession {
  return {
    id: "chat:1",
    kind: "chat",
    scope: "issue_session",
    agentKind: "codex",
    projectSlug: "demo",
    projectName: "Demo",
    title: "Session",
    identifier: null,
    threadId: 1,
    status: "Active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-02T11:00:00Z",
    ...overrides,
  };
}

function inventoryEntry(overrides: Partial<WorkspaceInventoryEntry>): WorkspaceInventoryEntry {
  return {
    path: "/ws/demo/DEMO-1",
    displayName: null,
    kind: "issue",
    issueIdentifier: "DEMO-1",
    name: null,
    classification: "active",
    reclaimable: false,
    workPresent: false,
    executionStatus: null,
    removable: true,
    sizeBytes: 1024,
    repos: [],
    childWorktrees: [],
    ...overrides,
  };
}

describe("buildWorkspaceCards", () => {
  it("merges execution, authoring, parallel sessions, and inventory into one card per issue", () => {
    const result = buildWorkspaceCards({
      executions: [execution()],
      issues: [issue("DEMO-1", "Fix login race")],
      relatedSessions: [
        session({ id: "chat:2", scope: "issue", identifier: "DEMO-1", threadId: 2, title: "Authoring" }),
        session({ id: "chat:3", scope: "issue_session", identifier: "DEMO-1", threadId: 3, title: "Parallel pass" }),
      ],
      inventory: [
        inventoryEntry({
          repos: [
            {
              name: "backend",
              path: "/ws/demo/DEMO-1/backend",
              branch: "feat/demo-1",
              defaultBranch: "main",
              dirty: true,
              upstream: false,
              aheadCount: 2,
              sizeBytes: 512,
            },
          ],
        }),
      ],
    });

    expect(result.activeCards).toHaveLength(1);
    const card = result.activeCards[0];
    expect(card.issueIdentifier).toBe("DEMO-1");
    expect(card.title).toBe("Fix login race");
    expect(card.execution?.status).toBe("live");
    expect(card.authoring?.issueIdentifier).toBe("DEMO-1");
    // Threads are the source of truth: authoring and parallel threads are both
    // plain session rows; the execution has no session id, so no row is invented.
    expect(card.sessions.map((entry) => entry.title)).toEqual(["Authoring", "Parallel pass"]);
    expect(card.inventory?.repos[0].branch).toBe("feat/demo-1");
  });

  it("dedups the execution thread against its issue_execution session row", () => {
    const result = buildWorkspaceCards({
      executions: [execution({ executionSessionId: 42, sessionId: "42" })],
      issues: [issue("DEMO-1", "Fix login race")],
      relatedSessions: [
        session({
          id: "thread:42",
          scope: "issue_execution",
          identifier: "DEMO-1",
          threadId: 42,
          title: "Orchestrator run",
          statusKind: "running",
        }),
      ],
      inventory: [],
    });

    const card = result.activeCards[0];
    expect(card.sessions).toHaveLength(1);
    expect(card.sessions[0]).toMatchObject({ threadId: 42, title: "Orchestrator run" });
  });

  it("synthesizes exactly one session row when the execution thread is missing from recents", () => {
    const result = buildWorkspaceCards({
      executions: [execution({ executionSessionId: 42, sessionId: "42", status: "saved" })],
      issues: [issue("DEMO-1", "Saved launcher work")],
      relatedSessions: [],
      inventory: [],
    });

    const card = [...result.activeCards, ...result.waitingCards][0];
    expect(card.sessions).toHaveLength(1);
    expect(card.sessions[0]).toMatchObject({
      threadId: 42,
      scope: "issue_execution",
      title: "Saved launcher work",
      statusKind: "closed",
    });
  });

  it("never invents a session row for an execution without a session id", () => {
    const result = buildWorkspaceCards({
      executions: [execution({ executionSessionId: null })],
      issues: [issue("DEMO-1", "Fix login race")],
      relatedSessions: [],
      inventory: [],
    });

    expect(result.activeCards[0].sessions).toHaveLength(0);
  });

  it("splits issues into active and waiting sections by execution bucket", () => {
    const result = buildWorkspaceCards({
      executions: [
        execution({ issueIdentifier: "DEMO-1", status: "live" }),
        execution({ issueIdentifier: "DEMO-2", status: "waiting", sessionId: "sess-2" }),
      ],
      issues: [issue("DEMO-1", "Live work"), issue("DEMO-2", "Waiting work")],
      relatedSessions: [],
      inventory: [],
    });

    expect(result.activeCards.map((card) => card.issueIdentifier)).toEqual(["DEMO-1"]);
    expect(result.waitingCards.map((card) => card.issueIdentifier)).toEqual(["DEMO-2"]);
  });

  it("routes project and standalone inventories to project cards and orphans to the orphan section", () => {
    const result = buildWorkspaceCards({
      executions: [],
      issues: [],
      relatedSessions: [session({ id: "chat:4", scope: "project_session", title: "Project chat" })],
      inventory: [
        inventoryEntry({ path: "/ws/demo", kind: "project", issueIdentifier: null }),
        inventoryEntry({
          path: "/ws/demo/__ws_spike",
          kind: "standalone",
          issueIdentifier: null,
          name: "spike",
        }),
        inventoryEntry({
          path: "/ws/demo/OLD-9",
          kind: "issue",
          issueIdentifier: "OLD-9",
          classification: "orphan",
          reclaimable: true,
        }),
      ],
    });

    expect(result.projectCards.map((card) => card.kind)).toEqual(["project", "standalone"]);
    expect(result.projectCards[0].sessions.map((entry) => entry.title)).toEqual(["Project chat"]);
    expect(result.orphanCards.map((card) => card.issueIdentifier)).toEqual(["OLD-9"]);
    expect(result.chatSessions).toHaveLength(0);
  });

  it("keeps project workspace chats visible as plain chats when the inventory is unavailable", () => {
    const result = buildWorkspaceCards({
      executions: [],
      issues: [],
      relatedSessions: [session({ id: "chat:5", scope: "project_session", title: "Homeless chat" })],
      inventory: [],
    });

    expect(result.chatSessions.map((entry) => entry.title)).toEqual(["Homeless chat"]);
  });
});

describe("flattenWorkspaceCardsByRecency", () => {
  it("merges all card sections and free chats into one recency-ordered list", () => {
    const result = buildWorkspaceCards({
      executions: [
        execution({
          issueIdentifier: "DEMO-1",
          status: "live",
          lastEventAt: "2026-07-02T10:00:00Z",
        }),
        execution({
          issueIdentifier: "DEMO-2",
          status: "waiting",
          sessionId: "sess-2",
          lastEventAt: "2026-07-02T08:00:00Z",
        }),
      ],
      issues: [issue("DEMO-1", "Live work"), issue("DEMO-2", "Waiting work")],
      relatedSessions: [
        session({
          id: "chat:free",
          scope: "freeform",
          title: "Free chat",
          updatedAt: "2026-07-02T12:00:00Z",
        }),
      ],
      inventory: [
        inventoryEntry({
          path: "/ws/demo",
          kind: "project",
          issueIdentifier: null,
          sizeBytes: 2048,
        }),
        inventoryEntry({
          path: "/ws/demo/OLD-9",
          kind: "issue",
          issueIdentifier: "OLD-9",
          classification: "orphan",
          reclaimable: true,
        }),
      ],
    });

    const flat = flattenWorkspaceCardsByRecency(result);
    expect(flat.map((item) => item.key)).toEqual([
      "chat:chat:free",
      "issue:DEMO-1",
      "issue:DEMO-2",
      "orphan:/ws/demo/OLD-9",
      "project",
    ]);
    expect(flat[0]?.kind).toBe("chat");
    expect(flat.filter((item) => item.kind === "card").map((item) => item.card.issueIdentifier)).toEqual([
      "DEMO-1",
      "DEMO-2",
      "OLD-9",
      null,
    ]);
  });

  it("does not pin the project workspace above newer issue activity", () => {
    const result = buildWorkspaceCards({
      executions: [
        execution({
          issueIdentifier: "DEMO-1",
          lastEventAt: "2026-07-02T15:00:00Z",
        }),
      ],
      issues: [issue("DEMO-1", "Newer issue")],
      relatedSessions: [],
      inventory: [inventoryEntry({ path: "/ws/demo", kind: "project", issueIdentifier: null })],
    });

    const flat = flattenWorkspaceCardsByRecency(result);
    expect(flat.map((item) => item.key)).toEqual(["issue:DEMO-1", "project"]);
  });
});

describe("buildWorkspaceCards orphans", () => {
  it("keeps orphan parallel trees out of the active section", () => {
    const result = buildWorkspaceCards({
      executions: [],
      issues: [issue("DEMO-1", "Fix login race")],
      relatedSessions: [],
      inventory: [
        inventoryEntry({
          path: "/ws/demo/DEMO-1__p1",
          kind: "issue_parallel",
          classification: "orphan",
          reclaimable: true,
        }),
      ],
    });

    expect(result.activeCards).toHaveLength(0);
    expect(result.orphanCards.map((card) => card.kind)).toEqual(["issue_parallel"]);
  });
});

describe("linkedSessionThreadIds", () => {
  it("includes the orchestrator execution session id", () => {
    const result = buildWorkspaceCards({
      executions: [execution({ executionSessionId: 42, sessionId: "42", status: "saved" })],
      issues: [issue("DEMO-1", "Saved launcher work")],
      relatedSessions: [],
      inventory: [],
    });
    const card = [...result.activeCards, ...result.waitingCards].find(
      (entry) => entry.issueIdentifier === "DEMO-1",
    );
    expect(card).toBeTruthy();
    expect(linkedSessionThreadIds(card!)).toEqual([42]);
  });
});

describe("canArchiveSessionRow", () => {
  it("blocks archiving an active orchestrator execution thread", () => {
    expect(
      canArchiveSessionRow(
        session({ scope: "issue_execution", threadId: 42, statusKind: "running" }),
      ),
    ).toBe(false);
    expect(
      canArchiveSessionRow(
        session({ scope: "issue_execution", threadId: 42, statusKind: "waiting" }),
      ),
    ).toBe(false);
  });

  it("allows archiving inactive executions and regular threads", () => {
    expect(
      canArchiveSessionRow(
        session({ scope: "issue_execution", threadId: 42, statusKind: "closed" }),
      ),
    ).toBe(true);
    expect(canArchiveSessionRow(session({ scope: "issue", threadId: 9 }))).toBe(true);
    expect(canArchiveSessionRow(session({ scope: "issue_session", threadId: 9 }))).toBe(true);
  });

  it("requires a thread id", () => {
    expect(canArchiveSessionRow(session({ threadId: null }))).toBe(false);
  });
});

describe("countLiveWritersForWorkspace", () => {
  it("flags a workspace with 2+ live sessions writing to the same tree", () => {
    const count = countLiveWritersForWorkspace(
      [
        { workspacePath: "/t/CDE-1180", aggregateStatus: "active" },
        { workspacePath: "/t/CDE-1180", aggregateStatus: "active" },
        { workspacePath: "/t/CDE-1180", aggregateStatus: "idle" },
      ],
      "/t/CDE-1180",
    );
    expect(count).toBe(2);
  });
});

describe("formatBytes", () => {
  it("formats byte sizes with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3.6 * 1024 ** 3)).toBe("3.6 GB");
  });
});
