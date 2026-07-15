import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetProjectSessionsCacheForTests } from "@/hooks/projectSessionsCache";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { useRecents } from "@/hooks/useRecents";
import { listIssues } from "@/services/issues";
import { listProjectSessions } from "@/services/projectSessions";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { ProjectSessionsPage } from "@/types/project-session";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/hooks/useRecents", () => ({ useRecents: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/projectSessions", () => ({ listProjectSessions: vi.fn() }));
vi.mock("@/services/worktrees", () => ({
  fetchWorkspaceInventory: vi.fn(),
  subscribeWorkspaceInventory: vi.fn(),
}));

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

function emptySessionsPage(): ProjectSessionsPage {
  return { sessions: [], nextCursor: null, projectActivityAt: null };
}

function recent(projectSlug: string, id = "thread:1"): RecentSession {
  return {
    id,
    kind: "chat",
    scope: "project_session",
    agentKind: "cursor",
    projectSlug,
    projectName: projectSlug.toUpperCase(),
    title: "Issue chat",
    identifier: null,
    threadId: 1,
    status: "Active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-02T10:00:00Z",
  };
}

describe("useProjectSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectSessionsCacheForTests();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map([["DEMO-1", execution("DEMO-1")]]),
    });
    vi.mocked(useRecents).mockReturnValue({
      sessions: [],
      loading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(listProjectSessions).mockResolvedValue(emptySessionsPage());
    vi.mocked(subscribeWorkspaceInventory).mockImplementation((_slug, handlers) => {
      handlers.onDone?.();
      return () => undefined;
    });
    vi.mocked(fetchWorkspaceInventory).mockResolvedValue({
      entries: [],
      totals: { count: 0, sizeBytes: 0, reclaimableBytes: 0 },
    });
  });

  it("joins project issues with execution snapshots", async () => {
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups.saved).toMatchObject([
      { issueIdentifier: "DEMO-1", title: "Saved launcher work" },
    ]);
    expect(listProjectSessions).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
  });

  it("includes related sessions from the shared recents snapshot", async () => {
    vi.mocked(useAgentExecutions).mockReturnValue({ executions: new Map() });
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);
    vi.mocked(useRecents).mockReturnValue({
      sessions: [recent("demo"), recent("other", "thread:2")],
      loading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.relatedSessions.map((session) => session.title)).toEqual(["Issue chat"]);
    expect(listProjectSessions).not.toHaveBeenCalled();
  });

  it("does not open workspace inventory on initial load", async () => {
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.inventory).toBeNull();
    expect(result.current.isInventoryLoading).toBe(false);
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
    expect(fetchWorkspaceInventory).not.toHaveBeenCalled();
  });
});
