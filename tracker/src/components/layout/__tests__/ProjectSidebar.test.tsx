import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSidebar, resolveTrackerAssetPath } from "@/components/layout/ProjectSidebar";
import { SidebarTreeProvider } from "@/components/layout/sidebar/SidebarTreeContext";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import {
  LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_PREFERENCES_STORAGE_KEY,
} from "@/lib/sidebarPreferences";
import { listAssistantThreads } from "@/services/assistantThreads";
import { listIssues } from "@/services/issues";
import { listProjectSessions } from "@/services/projectSessions";
import { listProjects } from "@/services/projects";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { Project } from "@/types/project";
import type { ProjectSessionRow } from "@/types/project-session";

vi.mock("@/components/theme/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme toggle</button>,
}));

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/hooks/useRecents", () => ({
  useRecents: () => ({ sessions: [], loading: false, error: null }),
}));
vi.mock("@/services/assistantThreads", () => ({ listAssistantThreads: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
vi.mock("@/services/projectSessions", () => ({ listProjectSessions: vi.fn() }));
vi.mock("@/services/projects", () => ({ listProjects: vi.fn() }));
vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));
vi.mock("@/services/worktrees", () => ({
  fetchWorkspaceInventory: vi.fn(),
  subscribeWorkspaceInventory: vi.fn(),
}));

vi.mock("@/components/layout/sidebar/SidebarNewSessionFlow", () => ({
  SidebarNewSessionFlow: () => null,
}));

vi.mock("@/components/layout/sidebar/SidebarSearchLauncher", () => ({
  SidebarSearchLauncher: () => null,
}));

vi.mock("@/components/layout/sidebar/SidebarContextMenu", () => ({
  SidebarContextMenu: ({ children }: { children: ReactNode }) => children,
}));

const activeProject: Project = {
  id: "active-1",
  name: "Active Project",
  slug: "active-project",
  description: "Shipping now",
  issueCount: 2,
  tracker: { kind: "local", config: {} },
  archivedAt: null,
};

const removedProject: Project = {
  id: "removed-1",
  name: "Removed Project",
  slug: "removed-project",
  description: "No longer active",
  issueCount: 1,
  tracker: { kind: "local", config: {} },
  archivedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function sidebarSession(
  issueIdentifier: string,
  aggregateStatus: string | null = "active",
): ProjectSessionRow {
  return {
    id: `execution:${issueIdentifier}`,
    title: issueIdentifier,
    kind: "execution",
    scope: "issue_session",
    href: `/projects/active-project/sessions/${issueIdentifier}`,
    updatedAt: "2026-07-13T12:00:00Z",
    aggregateStatus,
    agentKind: "codex",
    issueIdentifier,
    workspacePath: "/active",
    workspaceId: "workspace:active",
    pinned: false,
    archived: false,
  };
}

function renderProjectSidebar(initialEntry = "/projects") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarTreeProvider>
        <ProjectSidebar />
      </SidebarTreeProvider>
    </MemoryRouter>,
  );
}

function readVersionedPreferences(): { collapsed?: boolean; expandedProjectIds?: string[] } {
  const raw = window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as { collapsed?: boolean; expandedProjectIds?: string[] };
}

describe("ProjectSidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    window.localStorage.clear();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map(),
    });
    vi.mocked(listIssues).mockResolvedValue([]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [],
      nextCursor: null,
      projectActivityAt: null,
    });
    vi.mocked(listRecents).mockResolvedValue([]);
    vi.mocked(listAssistantThreads).mockResolvedValue([]);
    vi.mocked(fetchWorkspaceInventory).mockResolvedValue({
      entries: [],
      totals: { count: 0, sizeBytes: 0, reclaimableBytes: 0 },
    });
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(vi.fn());
  });

  it("reloads active project links when projects change", async () => {
    vi.mocked(listProjects)
      .mockResolvedValueOnce([activeProject, removedProject])
      .mockResolvedValueOnce([activeProject]);

    renderProjectSidebar();

    expect(await screen.findByRole("treeitem", { name: /^Active Project,/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /^Removed Project,/ })).toBeTruthy();

    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /^Removed Project,/ })).toBeNull());
    expect(screen.getByRole("treeitem", { name: /^Active Project,/ })).toBeTruthy();
  });

  it("uses the color logo as the expanded sidebar brand mark in light mode", async () => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();

    expect(await screen.findByRole("img", { name: "Dev10x" })).toHaveAttribute(
      "src",
      resolveTrackerAssetPath(import.meta.env.BASE_URL, "dev10x_logo_color.png"),
    );
  });

  it("uses the square icon when the sidebar is collapsed", async () => {
    window.localStorage.setItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();

    expect(await screen.findByAltText("Dev10x icon")).toHaveAttribute(
      "src",
      resolveTrackerAssetPath(import.meta.env.BASE_URL, "dev10x_icon.png"),
    );
  });

  it("keeps the newer reload result when the initial load resolves later", async () => {
    const mountLoad = deferred<Project[]>();
    const eventReload = deferred<Project[]>();
    vi.mocked(listProjects).mockReturnValueOnce(mountLoad.promise).mockReturnValueOnce(eventReload.promise);

    renderProjectSidebar();
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));

    await act(async () => {
      eventReload.resolve([activeProject]);
      await eventReload.promise;
    });
    expect(await screen.findByRole("treeitem", { name: /^Active Project,/ })).toBeTruthy();

    await act(async () => {
      mountLoad.resolve([removedProject]);
      await mountLoad.promise;
    });

    expect(screen.getByRole("treeitem", { name: /^Active Project,/ })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: /^Removed Project,/ })).toBeNull();
  });

  it("removes the projects changed listener on unmount", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    const { unmount } = renderProjectSidebar();
    await screen.findByRole("treeitem", { name: /^Active Project,/ });

    unmount();
    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
  });

  it("renders utility nav followed by one Projects tree without Recents or Boards", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();
    await screen.findByRole("treeitem", { name: /^Active Project,/ });

    const utility = screen.getByRole("navigation", { name: "Sidebar utilities" });
    const tree = screen.getByRole("tree", { name: "Projects" });
    expect(
      utility.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("tree", { name: "Projects" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Open projects page" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(screen.queryByRole("heading", { name: "Recents" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Boards" })).toBeNull();
    expect(screen.queryByText("Recents")).toBeNull();
    expect(screen.queryByText("Boards")).toBeNull();
  });

  it("expands the route-selected project", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject, removedProject]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [sidebarSession("ACTIVE-PROJECT-1")],
      nextCursor: null,
      projectActivityAt: null,
    });

    renderProjectSidebar("/projects/active-project/board");

    const selected = await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(selected).toHaveAttribute("aria-expanded", "true"));
    expect(listProjectSessions).toHaveBeenCalledWith({
      projectSlug: "active-project",
      limit: 7,
      includeArchived: false,
    });
    expect(listIssues).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();
    expect(screen.getByRole("treeitem", { name: /^Removed Project,/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("migrates legacy collapse into versioned preferences when toggled", async () => {
    window.localStorage.setItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    expect(window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY)).toBeNull();
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(screen.queryByText("Dev10x")).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("img", { name: "Dev10x" })).toBeTruthy();
    await waitFor(() => {
      const stored = window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!) as {
        version?: number;
        collapsed?: boolean;
      };
      expect(parsed.version).toBe(1);
      expect(parsed.collapsed).toBe(false);
      expect(readVersionedPreferences().collapsed).toBe(false);
    });
  });

  it("restores collapsed state from the legacy storage key on mount", async () => {
    window.localStorage.setItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar("/projects/active-project/board");
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(screen.queryByText("Dev10x")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Collapsed sidebar" })).toBeTruthy();
  });

  it("keeps the current project and activity accessible through collapsed rail tooltips", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [sidebarSession("ACTIVE-1")],
      nextCursor: null,
      projectActivityAt: null,
    });

    renderProjectSidebar("/projects/active-project/board");
    await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(listProjectSessions).toHaveBeenCalled());
    expect(listIssues).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    const rail = screen.getByRole("navigation", { name: "Collapsed sidebar" });
    const current = within(rail).getByRole("link", { name: /Active Project/ });
    expect(current.getAttribute("aria-label") ?? "").toMatch(/Active Project/);
    expect(current.getAttribute("aria-label") ?? "").toMatch(
      /Active|Idle|Error|Attention|Stale|Needs attention/i,
    );

    await user.hover(current);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent ?? "").toMatch(/Active Project/);
    expect(tooltip.textContent ?? "").toMatch(
      /Active|Idle|Error|Attention|Stale|Needs attention/i,
    );
  });

  it("contains sidebar overflow while keeping Projects as the sole scroll region", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();
    await screen.findByRole("treeitem", { name: /^Active Project,/ });

    const projectsTree = screen.getByRole("tree", { name: "Projects" });
    const sidebar = projectsTree.closest("aside");
    if (!sidebar) throw new Error("Expected the Projects tree to be inside the sidebar");

    expect(sidebar).toHaveClass("min-h-0", "overflow-hidden");
    expect(projectsTree).toHaveClass("overflow-y-auto");
    expect([...sidebar.querySelectorAll(".overflow-y-auto")]).toEqual([projectsTree]);
    expect(document.querySelectorAll("[data-sidebar-tree-scroll-container='true']")).toHaveLength(
      1,
    );
  });

  it("reloads idle project branches when search opens", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [],
      nextCursor: null,
      projectActivityAt: null,
    });

    renderProjectSidebar();
    expect(await screen.findByRole("treeitem", { name: /^Active Project,/ })).toBeTruthy();

    const callsBefore = vi.mocked(listProjectSessions).mock.calls.length;
    expect(callsBefore).toBe(0);

    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(vi.mocked(listProjectSessions).mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(vi.mocked(listProjectSessions)).toHaveBeenCalledWith({
      projectSlug: "active-project",
      limit: 7,
      includeArchived: false,
    });
  });

  it("does not clear loaded branch snapshots when projects reload", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(listProjectSessions).mockResolvedValue({
      sessions: [sidebarSession("ACTIVE-1")],
      nextCursor: null,
      projectActivityAt: null,
    });

    renderProjectSidebar("/projects/active-project/board");
    await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(listProjectSessions).toHaveBeenCalled());
    expect(listIssues).not.toHaveBeenCalled();
    expect(subscribeWorkspaceInventory).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /^ACTIVE-1,/ })).toBeTruthy();
    });

    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);
    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("treeitem", { name: /^ACTIVE-1,/ })).toBeTruthy();
    expect(listProjectSessions).toHaveBeenCalledTimes(1);
  });
});

describe("resolveTrackerAssetPath", () => {
  it("keeps public assets under the configured tracker base path", () => {
    expect(resolveTrackerAssetPath("/tracker/", "favicon.svg")).toBe("/tracker/favicon.svg");
  });

  it("keeps root-based development assets absolute", () => {
    expect(resolveTrackerAssetPath("/", "favicon.svg")).toBe("/favicon.svg");
  });

  it("normalizes missing trailing and leading asset slashes", () => {
    expect(resolveTrackerAssetPath("/tracker", "/favicon.svg")).toBe("/tracker/favicon.svg");
  });

  it("rejects empty asset names", () => {
    expect(() => resolveTrackerAssetPath("/tracker/", "")).toThrow("Tracker asset name must not be empty");
  });
});
