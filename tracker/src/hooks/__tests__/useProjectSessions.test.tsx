import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetProjectSessionsCacheForTests } from "@/hooks/projectSessionsCache";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { listIssues } from "@/services/issues";
import { listProjectSessions } from "@/services/projectSessions";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { ProjectSessionsPage } from "@/types/project-session";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/projectSessions", () => ({ listProjectSessions: vi.fn() }));
vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));
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

describe("useProjectSessions", () => {
  const refetchExecutions = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectSessionsCacheForTests();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map([["DEMO-1", execution("DEMO-1")]]),
      refetch: refetchExecutions,
    });
    vi.mocked(listProjectSessions).mockResolvedValue(emptySessionsPage());
    vi.mocked(listRecents).mockResolvedValue([]);
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
    expect(listProjectSessions).toHaveBeenCalledWith({
      projectSlug: "demo",
      limit: 20,
      includeArchived: false,
    });
    expect(listRecents).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
  });

  it("dedupes in-flight project sessions fetches for the same slug", async () => {
    vi.mocked(listIssues).mockResolvedValue([]);
    let resolve!: (value: ProjectSessionsPage) => void;
    const pending = new Promise<ProjectSessionsPage>((resolvePromise) => {
      resolve = resolvePromise;
    });
    vi.mocked(listProjectSessions).mockReturnValue(pending);

    const first = renderHook(() => useProjectSessions("demo"));
    const second = renderHook(() => useProjectSessions("demo"));

    expect(listProjectSessions).toHaveBeenCalledOnce();

    resolve(emptySessionsPage());
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
  });

  it("includes chat sessions from the paginated sessions API", async () => {
    vi.mocked(useAgentExecutions).mockReturnValue({ executions: new Map(), refetch: refetchExecutions });
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [
        {
          id: "thread:1",
          title: "Issue chat",
          kind: "chat",
          href: "/projects/demo/workspaces/1",
          updatedAt: "2026-07-02T10:00:00Z",
          aggregateStatus: "active",
          agentKind: "cursor",
          issueIdentifier: "DEMO-2",
          workspacePath: "/tmp/demo",
          workspaceId: "1",
          pinned: false,
          archived: false,
        },
      ],
      nextCursor: null,
      projectActivityAt: null,
    });

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.relatedSessions.map((session) => session.title)).toEqual(["Issue chat"]);
    expect(listRecents).not.toHaveBeenCalled();
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
