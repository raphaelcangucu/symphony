import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { listIssues } from "@/services/issues";
import { listRecents } from "@/services/recents";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));

function execution(issueIdentifier: string): AgentExecution {
  return {
    issueIdentifier,
    status: "saved",
    agentKind: "codex",
    sessionId: `sess-${issueIdentifier}`,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-02T10:00:00Z",
    turnCount: 2,
    runtimeSeconds: 90,
    startedAt: "2026-07-02T09:58:30Z",
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
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
    createdAt: "2026-07-02T09:00:00Z",
    updatedAt: "2026-07-02T09:00:00Z",
    attachments: [],
  };
}

function recent(overrides: Partial<RecentSession> = {}): RecentSession {
  return {
    id: "chat:1",
    kind: "chat",
    scope: "issue",
    agentKind: "cursor",
    projectSlug: "demo",
    projectName: "Demo",
    title: "Issue chat",
    identifier: "DEMO-2",
    threadId: 1,
    status: "Active",
    statusKind: "active",
    preview: "hello",
    updatedAt: "2026-07-02T10:00:00Z",
    ...overrides,
  };
}

describe("useProjectSessions", () => {
  const refetchExecutions = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map([["DEMO-1", execution("DEMO-1")]]),
      refetch: refetchExecutions,
    });
    vi.mocked(listRecents).mockResolvedValue([]);
  });

  it("joins project issues with execution snapshots", async () => {
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups.saved).toMatchObject([
      { issueIdentifier: "DEMO-1", title: "Saved launcher work" },
    ]);
  });

  it("includes recent assistant sessions for the project", async () => {
    vi.mocked(useAgentExecutions).mockReturnValue({ executions: new Map(), refetch: refetchExecutions });
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);
    vi.mocked(listRecents).mockResolvedValue([
      recent(),
      recent({ id: "chat:2", projectSlug: "other", title: "Other project" }),
    ]);

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.relatedSessions.map((session) => session.title)).toEqual(["Issue chat"]);
  });
});
