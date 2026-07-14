import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import {
  SIDEBAR_CORE_SOURCE_TIMEOUT_MS,
  SIDEBAR_HTTP_REQUEST_TIMEOUT_MS,
  SIDEBAR_INVENTORY_COMPLETION_TIMEOUT_MS,
  useSidebarTree,
} from "@/hooks/useSidebarTree";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import {
  defaultSidebarPreferences,
  SIDEBAR_PREFERENCES_STORAGE_KEY,
} from "@/lib/sidebarPreferences";
import { listAssistantThreads } from "@/services/assistantThreads";
import { listIssues } from "@/services/issues";
import { listProjects } from "@/services/projects";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { AssistantThread } from "@/types/assistant-thread";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ listAssistantThreads: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/projects", () => ({ listProjects: vi.fn() }));
vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));
vi.mock("@/services/worktrees", () => ({
  fetchWorkspaceInventory: vi.fn(),
  subscribeWorkspaceInventory: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function project(slug: string): Project {
  return {
    id: slug,
    slug,
    name: slug.toUpperCase(),
    description: null,
    tracker: { kind: "local", config: {} },
    archivedAt: null,
  };
}

function issue(slug: string, identifier = `${slug.toUpperCase()}-1`): Issue {
  return {
    id: identifier,
    identifier,
    projectSlug: slug,
    status: "Todo",
    title: identifier,
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-13T12:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
    attachments: [],
  };
}

function inventory(path: string, issueIdentifier: string): WorkspaceInventoryEntry {
  return {
    path,
    displayName: null,
    kind: "issue",
    issueIdentifier,
    name: null,
    classification: "active",
    reclaimable: false,
    workPresent: true,
    executionStatus: null,
    removable: true,
    sizeBytes: 10,
    repos: [],
    childWorktrees: [],
  };
}

function thread(slug: string, id = 1, workspacePath: string | null = null): AssistantThread {
  return {
    id,
    scope: "project_session",
    agentKind: "cursor",
    projectSlug: slug,
    projectName: slug.toUpperCase(),
    issueIdentifier: null,
    workspacePath,
    labels: [],
    needsReview: false,
    title: `Thread ${id}`,
    status: "active",
    preview: null,
    updatedAt: "2026-07-13T12:00:00Z",
  };
}

function recent(
  slug: string,
  id = 1,
  overrides: Partial<RecentSession> = {},
): RecentSession {
  return {
    id: `chat:${id}`,
    kind: "chat",
    scope: "project_session",
    agentKind: "cursor",
    projectSlug: slug,
    projectName: slug.toUpperCase(),
    title: `Recent ${id}`,
    identifier: null,
    threadId: id,
    status: "Active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-13T11:00:00Z",
    ...overrides,
  };
}

function wrapper(initialEntry = "/") {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

function strictWrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <MemoryRouter>{children}</MemoryRouter>
    </StrictMode>
  );
}

function handlersFor(slug: string) {
  const call = [...vi.mocked(subscribeWorkspaceInventory).mock.calls]
    .reverse()
    .find(([value]) => value === slug);
  if (!call) throw new Error(`No inventory subscription for ${slug}`);
  return call[1];
}

async function loadRoots(result: { current: ReturnType<typeof useSidebarTree> }) {
  await waitFor(() => expect(result.current.projectsLoading).toBe(false));
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSidebarTree", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(listProjects).mockResolvedValue([project("alpha"), project("beta")]);
    vi.mocked(listIssues).mockImplementation(async (slug) => [issue(slug)]);
    vi.mocked(listRecents).mockResolvedValue([]);
    vi.mocked(listAssistantThreads).mockResolvedValue([]);
    vi.mocked(fetchWorkspaceInventory).mockResolvedValue({
      entries: [],
      totals: { count: 0, sizeBytes: 0, reclaimableBytes: 0 },
    });
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(vi.fn());
  });

  it("loads only project roots on mount", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);

    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(useAgentExecutions).toHaveBeenCalled();
    expect(listIssues).not.toHaveBeenCalled();
    expect(listRecents).not.toHaveBeenCalled();
    expect(listAssistantThreads).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
  });

  it("waits for roots before loading valid persisted expansions and removes unknown slugs", async () => {
    const roots = deferred<Project[]>();
    vi.mocked(listProjects).mockReturnValue(roots.promise);
    localStorage.setItem(
      SIDEBAR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...defaultSidebarPreferences(),
        expandedProjectIds: ["alpha", "missing"],
      }),
    );

    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    expect(listIssues).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();

    await act(async () => roots.resolve([project("alpha"), project("beta")]));
    await waitFor(() => expect(listIssues).toHaveBeenCalledWith("alpha"));

    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(subscribeWorkspaceInventory).toHaveBeenCalledTimes(1);
    expect(result.current.preferences.expandedProjectIds).toEqual(["alpha"]);
  });

  it("loads every branch source exactly once on first expansion and becomes ready after inventory", async () => {
    const core = deferred<Issue[]>();
    vi.mocked(listIssues).mockReturnValue(core.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);

    act(() => result.current.toggleProjectExpanded("alpha"));
    expect(listIssues).toHaveBeenCalledOnce();
    expect(listRecents).toHaveBeenCalledWith(100);
    expect(listAssistantThreads).toHaveBeenCalledWith({
      projectSlug: "alpha",
      scopes: ["project_session", "project_explore", "issue", "issue_session"],
      limit: 100,
      includeArchived: false,
    });
    expect(subscribeWorkspaceInventory).toHaveBeenCalledOnce();

    act(() => handlersFor("alpha").onEntry(inventory("/alpha", "ALPHA-1")));
    expect(result.current.tree[0].loadState).toBe("loading");
    expect(result.current.tree[0].workspaces).toHaveLength(1);

    await act(async () => core.resolve([issue("alpha")]));
    expect(result.current.tree[0].loadState).toBe("loading");
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
  });

  it("falls back once on a tagged stream failure", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onError?.());
    await waitFor(() => expect(fetchWorkspaceInventory).toHaveBeenCalledWith("alpha"));
    expect(fetchWorkspaceInventory).toHaveBeenCalledOnce();
    act(() => handlersFor("alpha").onError?.());
    expect(fetchWorkspaceInventory).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
  });

  it("retains a prior snapshot and reports stale when inventory fallback fails", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => {
      handlersFor("alpha").onEntry(inventory("/cached", "ALPHA-1"));
      handlersFor("alpha").onDone?.();
    });
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    const cachedProject = result.current.tree[0];

    const fallback = deferred<never>();
    vi.mocked(fetchWorkspaceInventory).mockReturnValue(fallback.promise);
    const reload = result.current.reloadProjectBranch("alpha");
    act(() => handlersFor("alpha").onEntry(inventory("/partial", "ALPHA-2")));
    act(() => handlersFor("alpha").onError?.());
    await act(async () => fallback.reject(new Error("inventory unavailable")));
    await act(async () => reload);

    await waitFor(() => expect(result.current.tree[0].loadState).toBe("stale"));
    expect(fetchWorkspaceInventory).toHaveBeenCalledOnce();
    expect(result.current.tree[0].error).toContain("inventory unavailable");
    expect(result.current.tree[0].workspaces[0].inventory?.path).toBe("/cached");
    expect(cachedProject.workspaces[0].inventory?.path).toBe("/cached");
  });

  it("does not promote interrupted initial partial inventory to a completed snapshot", async () => {
    vi.mocked(fetchWorkspaceInventory).mockRejectedValue(new Error("fallback failed"));
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onEntry(inventory("/partial", "ALPHA-1")));
    act(() => handlersFor("alpha").onError?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("error"));
    expect(result.current.tree[0].workspaces[0].inventory?.path).toBe("/partial");

    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => result.current.toggleProjectExpanded("alpha"));
    expect(result.current.tree[0].loadState).toBe("loading");
  });

  it("times out an unterminated inventory stream and resolves reload after fallback settles", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const fallback = deferred<{
      entries: WorkspaceInventoryEntry[];
      totals: { count: number; sizeBytes: number; reclaimableBytes: number };
    }>();
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(unsubscribe);
    vi.mocked(fetchWorkspaceInventory).mockReturnValue(fallback.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await flushMicrotasks();
    expect(result.current.projectsLoading).toBe(false);
    act(() => result.current.toggleProjectExpanded("alpha"));

    let reloadSettled = false;
    act(() => {
      void result.current.reloadProjectBranch("alpha").then(() => {
        reloadSettled = true;
      });
    });
    await act(async () => vi.advanceTimersByTimeAsync(SIDEBAR_INVENTORY_COMPLETION_TIMEOUT_MS));
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(fetchWorkspaceInventory).toHaveBeenCalledOnce();
    expect(reloadSettled).toBe(false);

    await act(async () =>
      fallback.resolve({
        entries: [inventory("/fallback", "ALPHA-1")],
        totals: { count: 1, sizeBytes: 10, reclaimableBytes: 0 },
      }),
    );
    expect(reloadSettled).toBe(true);
    expect(result.current.tree[0].loadState).toBe("ready");
  });

  it("logically times out a pending core source and ignores its late result", async () => {
    vi.useFakeTimers();
    const pendingIssues = deferred<Issue[]>();
    vi.mocked(listIssues).mockReturnValue(pendingIssues.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await flushMicrotasks();
    expect(result.current.projectsLoading).toBe(false);
    act(() => result.current.toggleProjectExpanded("alpha"));
    let reloadSettled = false;
    act(() => {
      void result.current.reloadProjectBranch("alpha").then(() => {
        reloadSettled = true;
      });
    });
    act(() => handlersFor("alpha").onDone?.());
    await act(async () => vi.advanceTimersByTimeAsync(SIDEBAR_CORE_SOURCE_TIMEOUT_MS));

    expect(reloadSettled).toBe(true);
    expect(result.current.tree[0].loadState).toBe("error");
    expect(result.current.tree[0].error).toContain("issues");
    expect(result.current.tree[0].error).toContain("timed out");
    const timedOutTree = result.current.tree;
    await act(async () => pendingIssues.resolve([issue("alpha", "ALPHA-LATE")]));
    expect(result.current.tree).toBe(timedOutTree);
  });

  it("settles pending core completion immediately when collapsed", async () => {
    vi.mocked(listIssues).mockReturnValue(new Promise<Issue[]>(() => undefined));
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    let reloadSettled = false;
    act(() => {
      void result.current.reloadProjectBranch("alpha").then(() => {
        reloadSettled = true;
      });
    });
    act(() => result.current.toggleProjectExpanded("alpha"));
    await act(async () => Promise.resolve());
    expect(reloadSettled).toBe(true);
  });

  it("times out a permanently pending inventory fallback and ignores its late result", async () => {
    vi.useFakeTimers();
    const fallback = deferred<{
      entries: WorkspaceInventoryEntry[];
      totals: { count: number; sizeBytes: number; reclaimableBytes: number };
    }>();
    vi.mocked(fetchWorkspaceInventory).mockReturnValue(fallback.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await flushMicrotasks();
    expect(result.current.projectsLoading).toBe(false);
    act(() => result.current.toggleProjectExpanded("alpha"));
    let reloadSettled = false;
    act(() => {
      void result.current.reloadProjectBranch("alpha").then(() => {
        reloadSettled = true;
      });
    });
    act(() => handlersFor("alpha").onError?.());
    await act(async () => vi.advanceTimersByTimeAsync(SIDEBAR_HTTP_REQUEST_TIMEOUT_MS));

    expect(reloadSettled).toBe(true);
    expect(result.current.tree[0].loadState).toBe("error");
    expect(result.current.tree[0].error).toContain("workspace inventory");
    expect(result.current.tree[0].error).toContain("timed out");
    const timedOutTree = result.current.tree;
    await act(async () =>
      fallback.resolve({
        entries: [inventory("/late-fallback", "ALPHA-1")],
        totals: { count: 1, sizeBytes: 10, reclaimableBytes: 0 },
      }),
    );
    expect(result.current.tree).toBe(timedOutTree);
  });

  it("times out a permanently pending root reload and ignores its late result", async () => {
    vi.useFakeTimers();
    const roots = deferred<Project[]>();
    vi.mocked(listProjects).mockReturnValue(roots.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    let reloadSettled = false;
    act(() => {
      void result.current.reloadProjects().then(() => {
        reloadSettled = true;
      });
    });
    await act(async () => vi.advanceTimersByTimeAsync(SIDEBAR_HTTP_REQUEST_TIMEOUT_MS));

    expect(reloadSettled).toBe(true);
    expect(result.current.projectsLoading).toBe(false);
    expect(result.current.projectsError).toContain("timed out");
    const timedOutTree = result.current.tree;
    await act(async () => roots.resolve([project("alpha")]));
    expect(result.current.tree).toBe(timedOutTree);
  });

  it("keeps successful core sources when one source fails", async () => {
    vi.mocked(listIssues).mockRejectedValue(new Error("issues offline"));
    vi.mocked(listAssistantThreads).mockResolvedValue([thread("alpha", 4)]);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onDone?.());

    await waitFor(() => expect(result.current.tree[0].loadState).toBe("error"));
    expect(result.current.tree[0].error).toContain("issues");
    expect(result.current.tree[0].unassignedSessions.map((session) => session.id)).toContain(
      "thread:4",
    );
  });

  it("combines simultaneous core and inventory errors deterministically", async () => {
    vi.mocked(listIssues).mockRejectedValue(new Error("issues failed"));
    vi.mocked(listAssistantThreads).mockRejectedValue(new Error("threads failed"));
    vi.mocked(fetchWorkspaceInventory).mockRejectedValue(new Error("inventory failed"));
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onError?.());

    await waitFor(() => expect(result.current.tree[0].loadState).toBe("error"));
    expect(result.current.tree[0].error).toContain("issues");
    expect(result.current.tree[0].error).toContain("threads");
    expect(result.current.tree[0].error).toContain("workspace inventory");
  });

  it("reuses one global recents request for concurrent project expansion", async () => {
    const sharedRecents = deferred<RecentSession[]>();
    vi.mocked(listRecents).mockReturnValue(sharedRecents.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    expect(listRecents).toHaveBeenCalledOnce();
    await act(async () => sharedRecents.resolve([]));
    act(() => {
      handlersFor("alpha").onDone?.();
      handlersFor("beta").onDone?.();
    });
  });

  it("clears rejected shared recents so cached reopen retries", async () => {
    vi.mocked(listRecents)
      .mockRejectedValueOnce(new Error("recents unavailable"))
      .mockResolvedValueOnce([recent("alpha", 22)]);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("error"));

    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    expect(listRecents).toHaveBeenCalledTimes(2);
    expect(result.current.tree[0].unassignedSessions.map((session) => session.id)).toContain(
      "thread:22",
    );
  });

  it("requests fresh recents on explicit branch refresh", async () => {
    vi.mocked(listRecents)
      .mockResolvedValueOnce([recent("alpha", 30)])
      .mockResolvedValueOnce([recent("alpha", 31)]);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));

    let reload!: Promise<void>;
    act(() => {
      reload = result.current.reloadProjectBranch("alpha");
    });
    act(() => handlersFor("alpha").onDone?.());
    await act(async () => reload);
    expect(listRecents).toHaveBeenCalledTimes(2);
    expect(result.current.tree[0].unassignedSessions.map((session) => session.id)).toEqual([
      "thread:31",
    ]);
  });

  it("handles synchronous subscription failure and cleans every branch defensively", async () => {
    const alphaUnsubscribe = vi.fn(() => {
      throw new Error("close failed");
    });
    const betaUnsubscribe = vi.fn();
    vi.mocked(subscribeWorkspaceInventory)
      .mockImplementationOnce((_slug, handlers) => {
        handlers.onError?.();
        return alphaUnsubscribe;
      })
      .mockImplementationOnce(() => betaUnsubscribe);
    const { result, unmount } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    await waitFor(() => expect(fetchWorkspaceInventory).toHaveBeenCalledWith("alpha"));
    expect(fetchWorkspaceInventory).toHaveBeenCalledOnce();
    expect(() => unmount()).not.toThrow();
    expect(betaUnsubscribe).toHaveBeenCalledOnce();
  });

  it("falls back when subscribe throws synchronously", async () => {
    vi.mocked(subscribeWorkspaceInventory).mockImplementationOnce(() => {
      throw new Error("EventSource unavailable");
    });
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));

    await waitFor(() => expect(fetchWorkspaceInventory).toHaveBeenCalledWith("alpha"));
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
  });

  it("ignores a late fallback result after collapse and a late core result after unmount", async () => {
    const fallback = deferred<{
      entries: WorkspaceInventoryEntry[];
      totals: { count: number; sizeBytes: number; reclaimableBytes: number };
    }>();
    const core = deferred<Issue[]>();
    vi.mocked(fetchWorkspaceInventory).mockReturnValue(fallback.promise);
    vi.mocked(listIssues).mockReturnValue(core.promise);
    const { result, unmount } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onError?.());
    act(() => result.current.toggleProjectExpanded("alpha"));
    unmount();

    await act(async () =>
      fallback.resolve({
        entries: [inventory("/late", "ALPHA-1")],
        totals: { count: 1, sizeBytes: 10, reclaimableBytes: 0 },
      }),
    );
    await act(async () => core.resolve([issue("alpha", "ALPHA-LATE")]));
  });

  it("ignores late fallback resolve and reject after mounted collapse", async () => {
    const alphaFallback = deferred<{
      entries: WorkspaceInventoryEntry[];
      totals: { count: number; sizeBytes: number; reclaimableBytes: number };
    }>();
    const betaFallback = deferred<never>();
    vi.mocked(fetchWorkspaceInventory).mockImplementation((slug) =>
      slug === "alpha" ? alphaFallback.promise : betaFallback.promise,
    );
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    act(() => {
      handlersFor("alpha").onError?.();
      handlersFor("beta").onError?.();
    });
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    const collapsedTree = result.current.tree;

    await act(async () =>
      alphaFallback.resolve({
        entries: [inventory("/late-alpha", "ALPHA-1")],
        totals: { count: 1, sizeBytes: 10, reclaimableBytes: 0 },
      }),
    );
    await act(async () => betaFallback.reject(new Error("late beta failure")));
    expect(result.current.tree).toBe(collapsedTree);
  });

  it("surfaces preference updater programming errors", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    expect(() =>
      act(() =>
        result.current.updatePreferences(() => {
          throw new Error("bad updater");
        }),
      ),
    ).toThrow("bad updater");
  });

  it("does not duplicate durable mount work in StrictMode", async () => {
    localStorage.setItem(
      SIDEBAR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...defaultSidebarPreferences(),
        expandedProjectIds: ["alpha"],
      }),
    );
    const { result } = renderHook(() => useSidebarTree(), { wrapper: strictWrapper });
    await loadRoots(result);
    await waitFor(() => expect(subscribeWorkspaceInventory).toHaveBeenCalledOnce());
    expect(listProjects).toHaveBeenCalledOnce();
    expect(listIssues).toHaveBeenCalledOnce();
  });

  it("collapses immediately, unsubscribes, ignores late callbacks, and refreshes cached data on reopen", async () => {
    const unsubscribe = vi.fn();
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(unsubscribe);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    const oldHandlers = handlersFor("alpha");
    act(() => oldHandlers.onEntry(inventory("/cached", "ALPHA-1")));
    act(() => oldHandlers.onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));

    act(() => result.current.toggleProjectExpanded("alpha"));
    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => oldHandlers.onEntry(inventory("/late", "ALPHA-1")));

    act(() => result.current.toggleProjectExpanded("alpha"));
    expect(result.current.tree[0].loadState).toBe("stale");
    expect(result.current.tree[0].workspaces[0].inventory?.path).toBe("/cached");
    expect(listIssues).toHaveBeenCalledTimes(2);
    expect(subscribeWorkspaceInventory).toHaveBeenCalledTimes(2);
  });

  it("keeps expanded projects isolated and late generations cannot overwrite", async () => {
    const firstAlpha = deferred<Issue[]>();
    const secondAlpha = deferred<Issue[]>();
    vi.mocked(listIssues)
      .mockImplementationOnce(() => firstAlpha.promise)
      .mockImplementationOnce(async () => [issue("beta")])
      .mockImplementationOnce(() => secondAlpha.promise);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    act(() => handlersFor("beta").onDone?.());
    await waitFor(() => expect(result.current.tree[1].loadState).toBe("ready"));

    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => result.current.toggleProjectExpanded("alpha"));
    await act(async () => secondAlpha.resolve([issue("alpha", "ALPHA-NEW")]));
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    await act(async () => firstAlpha.resolve([issue("alpha", "ALPHA-OLD")]));

    expect(result.current.tree[0].workspaces.some((node) => node.issueIdentifier === "ALPHA-OLD")).toBe(false);
    expect(result.current.tree[1].loadState).toBe("ready");
  });

  it("reuses an unaffected project node when another project receives a draft entry", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    act(() => {
      handlersFor("alpha").onDone?.();
      handlersFor("beta").onDone?.();
    });
    await waitFor(() => expect(result.current.tree.every((node) => node.loadState === "ready")).toBe(true));
    const betaNode = result.current.tree[1];

    act(() => {
      void result.current.reloadProjectBranch("alpha");
    });
    act(() => handlersFor("alpha").onEntry(inventory("/alpha-draft", "ALPHA-1")));

    expect(result.current.tree[1]).toBe(betaNode);
    expect(result.current.tree[0].workspaces[0].inventory?.path).toBe("/alpha-draft");
  });

  it("creates immutable snapshots for inventory callbacks and stale generations", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    const firstHandlers = handlersFor("alpha");
    act(() => firstHandlers.onEntry(inventory("/first", "ALPHA-1")));
    const firstTree = result.current.tree;
    const firstProject = firstTree[0];
    const firstWorkspaces = firstProject.workspaces;

    act(() => firstHandlers.onEntry(inventory("/second", "ALPHA-2")));
    const secondTree = result.current.tree;
    expect(secondTree).not.toBe(firstTree);
    expect(secondTree[0]).not.toBe(firstProject);
    expect(secondTree[0].workspaces).not.toBe(firstWorkspaces);
    expect(firstWorkspaces.map((workspace) => workspace.inventory?.path)).toEqual(["/first"]);
    expect(secondTree[0].workspaces.map((workspace) => workspace.inventory?.path)).toEqual([
      "/first",
      "/second",
    ]);

    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => result.current.toggleProjectExpanded("alpha"));
    const currentTree = result.current.tree;
    act(() => firstHandlers.onEntry(inventory("/late", "ALPHA-3")));
    expect(result.current.tree).toBe(currentTree);
    expect(secondTree[0].workspaces.map((workspace) => workspace.inventory?.path)).toEqual([
      "/first",
      "/second",
    ]);
  });

  it("auto-expands the route project and merges the workspace ancestor after branch data arrives", async () => {
    vi.mocked(listAssistantThreads).mockResolvedValue([thread("alpha", 7, "/alpha")]);
    const { result } = renderHook(() => useSidebarTree(), {
      wrapper: wrapper("/projects/alpha/sessions/7"),
    });
    await waitFor(() => expect(listIssues).toHaveBeenCalledWith("alpha"));
    act(() => handlersFor("alpha").onEntry(inventory("/alpha", "ALPHA-1")));
    act(() => handlersFor("alpha").onDone?.());

    await waitFor(() =>
      expect(result.current.preferences.expandedWorkspaceIds).toContain(
        "workspace:alpha:/alpha",
      ),
    );
  });

  it("keeps other projects and prior snapshots when one branch refresh fails", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded("alpha");
      result.current.toggleProjectExpanded("beta");
    });
    act(() => {
      handlersFor("alpha").onEntry(inventory("/alpha", "ALPHA-1"));
      handlersFor("alpha").onDone?.();
      handlersFor("beta").onDone?.();
    });
    await waitFor(() => expect(result.current.tree.every((node) => node.loadState === "ready")).toBe(true));

    vi.mocked(listIssues).mockRejectedValueOnce(new Error("offline"));
    let reload!: Promise<void>;
    act(() => {
      reload = result.current.reloadProjectBranch("alpha");
    });
    act(() => handlersFor("alpha").onDone?.());
    await act(async () => reload);
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("stale"));
    expect(result.current.tree[0].error).toContain("offline");
    expect(result.current.tree[1].loadState).toBe("ready");
  });

  it("preserves roots and branch cache when a project root reload fails", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => {
      handlersFor("alpha").onEntry(inventory("/alpha", "ALPHA-1"));
      handlersFor("alpha").onDone?.();
    });
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));
    const previousTree = result.current.tree;

    vi.mocked(listProjects).mockRejectedValueOnce(new Error("projects offline"));
    await act(async () => result.current.reloadProjects());

    expect(result.current.projectsError).toContain("projects offline");
    expect(result.current.tree).toBe(previousTree);
    expect(result.current.tree.map((node) => node.projectSlug)).toEqual(["alpha", "beta"]);
    expect(result.current.tree[0].workspaces[0].inventory?.path).toBe("/alpha");
  });

  it("passes recents and threads to Task5 canonical dedupe", async () => {
    vi.mocked(listRecents).mockResolvedValue([
      recent("alpha", 7),
      recent("alpha", 8, { scope: "freeform" }),
      recent("beta", 9),
    ]);
    vi.mocked(listAssistantThreads).mockResolvedValue([
      thread("alpha", 7),
      thread("alpha", 10),
    ]);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    act(() => handlersFor("alpha").onDone?.());
    await waitFor(() => expect(result.current.tree[0].loadState).toBe("ready"));

    expect(result.current.tree[0].unassignedSessions.map((session) => session.id)).toEqual([
      "thread:10",
      "thread:7",
    ]);
    expect(
      result.current.tree[0].unassignedSessions.find((session) => session.id === "thread:7")
        ?.title,
    ).toBe("Thread 7");
  });

  it("uses latest root generation, reloads roots only on project events, and evicts removed branches", async () => {
    const first = deferred<Project[]>();
    const unsubscribe = vi.fn();
    vi.mocked(listProjects).mockReturnValueOnce(first.promise).mockResolvedValueOnce([project("alpha")]);
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(unsubscribe);
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await act(async () => result.current.reloadProjects());
    await act(async () => first.resolve([project("beta")]));
    expect(result.current.tree.map((node) => node.projectSlug)).toEqual(["alpha"]);

    act(() => result.current.toggleProjectExpanded("alpha"));
    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(3));
    expect(listIssues).toHaveBeenCalledOnce();

    vi.mocked(listProjects).mockResolvedValueOnce([]);
    await act(async () => result.current.reloadProjects());
    expect(result.current.tree).toEqual([]);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("cleans subscriptions on unmount and ignores late root promises", async () => {
    const roots = deferred<Project[]>();
    const unsubscribe = vi.fn();
    vi.mocked(listProjects).mockResolvedValueOnce([project("alpha")]).mockReturnValueOnce(roots.promise);
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(unsubscribe);
    const { result, unmount } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    void result.current.reloadProjects();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await act(async () => roots.resolve([project("beta")]));
  });

  it("reveals overflow immutably and survives denied preference storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied");
    });
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    const before = result.current.preferences;
    act(() => {
      result.current.showAllWorkspaces("alpha");
      result.current.showAllSessions("workspace:alpha:/alpha");
      result.current.updatePreferences((current) => ({
        ...current,
        sort: "name",
      }));
    });
    expect(result.current.preferences).not.toBe(before);
    expect(result.current.preferences.revealedProjectIds).toContain("alpha");
    expect(result.current.preferences.revealedWorkspaceIds).toContain("workspace:alpha:/alpha");
    expect(result.current.preferences.sort).toBe("name");
    expect(result.current.preferencesStorageError).toBe(
      "Sidebar preferences could not be saved.",
    );
    setItem.mockRestore();
  });

  it("refreshes only expanded branches when includeArchived changes", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => result.current.toggleProjectExpanded("alpha"));
    expect(listIssues).toHaveBeenCalledOnce();

    act(() =>
      result.current.updatePreferences((current) => ({
        ...current,
        filters: { ...current.filters, showArchived: true },
      })),
    );
    await waitFor(() => expect(listIssues).toHaveBeenCalledTimes(2));
    expect(listAssistantThreads).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectSlug: "alpha", includeArchived: true }),
    );
    expect(listAssistantThreads).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectSlug: "beta" }),
    );
  });

  it("does not request malformed or unknown project slugs", async () => {
    const { result } = renderHook(() => useSidebarTree(), { wrapper: wrapper() });
    await loadRoots(result);
    act(() => {
      result.current.toggleProjectExpanded(" ");
      result.current.toggleProjectExpanded("missing");
    });
    await expect(result.current.reloadProjectBranch("")).resolves.toBeUndefined();
    await expect(result.current.reloadProjectBranch("missing")).resolves.toBeUndefined();
    expect(listIssues).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
  });
});
