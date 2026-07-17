import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useSidebarTree } from "@/hooks/useSidebarTree";
import { listIssues } from "@/services/issues";
import { listProjects } from "@/services/projects";
import { listProjectSessions } from "@/services/projectSessions";
import { listRecents } from "@/services/recents";
import { subscribeWorkspaceInventory } from "@/services/worktrees";
import type { AgentExecution } from "@/types/agent-execution";
import type { Project } from "@/types/project";
import type { ProjectSessionRow } from "@/types/project-session";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/hooks/useRecents", () => ({
  useRecents: vi.fn(() => ({ sessions: [], loading: false, refetch: async () => undefined })),
}));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/projects", () => ({ listProjects: vi.fn() }));
vi.mock("@/services/projectSessions", () => ({ listProjectSessions: vi.fn() }));
vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));
vi.mock("@/services/worktrees", () => ({ subscribeWorkspaceInventory: vi.fn() }));

function project(slug: string, updatedAt?: string): Project {
  return {
    id: slug,
    slug,
    name: slug.toUpperCase(),
    description: null,
    tracker: { kind: "local", config: {} },
    archivedAt: null,
    updatedAt,
  };
}

function session(id: string): ProjectSessionRow {
  return {
    id,
    title: `Session ${id}`,
    kind: "chat",
    scope: "project",
    href: `/projects/alpha/sessions/${id}`,
    updatedAt: "2026-07-14T12:00:00Z",
    aggregateStatus: "idle",
    agentKind: "cursor",
    issueIdentifier: null,
    workspacePath: "/repo/alpha",
    workspaceId: "workspace:alpha:main",
    pinned: false,
    archived: false,
  };
}

function execution(issueIdentifier: string): AgentExecution {
  return {
    issueIdentifier,
    status: "live",
    agentKind: "codex",
    sessionId: `session-${issueIdentifier}`,
    executionSessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-14T12:00:00Z",
    turnCount: 1,
    runtimeSeconds: null,
    startedAt: "2026-07-14T12:00:00Z",
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useSidebarTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map(),
    });
    vi.mocked(listProjects).mockResolvedValue([project("alpha"), project("beta")]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [session("thread:1")],
      nextCursor: null,
      projectActivityAt: "2026-07-14T12:00:00Z",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("loads only project roots on mount", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper });

    await waitFor(() => expect(result.current.projectsLoading).toBe(false));

    expect(listProjects).toHaveBeenCalledOnce();
    expect(listProjectSessions).not.toHaveBeenCalled();
    expect(listIssues).not.toHaveBeenCalled();
    expect(listRecents).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
  });

  it("loads an expanded branch from the limited sessions endpoint without legacy sources", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper });
    await waitFor(() => expect(result.current.projectsLoading).toBe(false));

    act(() => result.current.toggleProjectExpanded("alpha"));

    await waitFor(() => expect(listProjectSessions).toHaveBeenCalledOnce());
    expect(listProjectSessions).toHaveBeenCalledWith({
      projectSlug: "alpha",
      limit: 20,
      includeArchived: false,
    });
    expect(listIssues).not.toHaveBeenCalled();
    expect(listRecents).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    expect(result.current.tree[0].sessions.map(({ id }) => id)).toEqual(["thread:1"]);
    expect(result.current.tree[0].workspaces).toEqual([]);
  });

  it("overlays live execution status onto sessions with the same issue identifier", async () => {
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map([["ALPHA-1", execution("ALPHA-1")]]),
    });
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [{ ...session("thread:1"), issueIdentifier: "ALPHA-1" }],
      nextCursor: null,
      projectActivityAt: "2026-07-14T12:00:00Z",
    });
    const { result } = renderHook(() => useSidebarTree(), { wrapper });
    await waitFor(() => expect(result.current.projectsLoading).toBe(false));

    act(() => result.current.toggleProjectExpanded("alpha"));

    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    expect(result.current.tree[0].sessions[0]).toMatchObject({
      issueIdentifier: "ALPHA-1",
      aggregateStatus: "active",
    });
  });

  it("sorts unpinned roots by updated activity before branches load", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project("alpha", "2026-07-13T12:00:00Z"),
      project("beta", "2026-07-14T12:00:00Z"),
    ]);
    const { result } = renderHook(() => useSidebarTree(), { wrapper });

    await waitFor(() => expect(result.current.projectsLoading).toBe(false));

    expect(result.current.tree.map((node) => node.id)).toEqual(["beta", "alpha"]);
  });

  it("appends the next session page with the branch cursor", async () => {
    vi.mocked(listProjectSessions)
      .mockResolvedValueOnce({
        sessions: [session("thread:1")],
        nextCursor: "cursor-2",
        projectActivityAt: "2026-07-14T12:00:00Z",
      })
      .mockResolvedValueOnce({
        sessions: [session("thread:2")],
        nextCursor: null,
        projectActivityAt: "2026-07-14T13:00:00Z",
      });
    const { result } = renderHook(() => useSidebarTree(), { wrapper });
    await waitFor(() => expect(result.current.projectsLoading).toBe(false));
    act(() => result.current.toggleProjectExpanded("alpha"));
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));

    act(() => result.current.showAllSessions("alpha"));

    await waitFor(() =>
      expect(listProjectSessions).toHaveBeenLastCalledWith({
        projectSlug: "alpha",
        limit: 20,
        cursor: "cursor-2",
        includeArchived: false,
      }),
    );
    await waitFor(() =>
      expect(result.current.tree[0].sessions.map(({ id }) => id)).toEqual([
        "thread:1",
        "thread:2",
      ]),
    );
  });
});
