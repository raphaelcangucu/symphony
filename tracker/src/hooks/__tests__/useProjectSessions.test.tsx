import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { listIssues } from "@/services/issues";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
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

  it("streams inventory entries without blocking issue loading", async () => {
    vi.mocked(listIssues).mockResolvedValue([issue("DEMO-1", "Saved launcher work")]);
    vi.mocked(subscribeWorkspaceInventory).mockImplementation((_slug, handlers) => {
      const entry: WorkspaceInventoryEntry = {
        path: "/tmp/demo-workspace",
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
      };
      queueMicrotask(() => {
        handlers.onEntry(entry);
        handlers.onTotals({ count: 1, sizeBytes: 1024, reclaimableBytes: 0 });
        handlers.onDone?.();
      });
      return () => undefined;
    });

    const { result } = renderHook(() => useProjectSessions("demo"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups.saved).toHaveLength(1);
    await waitFor(() => expect(result.current.isInventoryLoading).toBe(false));
    expect(result.current.inventory?.entries).toHaveLength(1);
  });
});
