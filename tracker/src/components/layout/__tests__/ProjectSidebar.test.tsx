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
import { listProjects } from "@/services/projects";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

vi.mock("@/components/theme/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme toggle</button>,
}));

vi.mock("@/hooks/useAgentExecutions", () => ({ useAgentExecutions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ listAssistantThreads: vi.fn() }));
vi.mock("@/services/issues", () => ({ listIssues: vi.fn() }));
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

function handlersFor(slug: string) {
  const call = [...vi.mocked(subscribeWorkspaceInventory).mock.calls]
    .reverse()
    .find(([value]) => value === slug);
  if (!call) throw new Error(`No inventory subscription for ${slug}`);
  return call[1];
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
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(listIssues).mockResolvedValue([]);
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

  it("uses the tracker favicon artwork as the sidebar brand icon", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();

    expect(await screen.findByAltText("Symphony Tracker icon")).toHaveAttribute(
      "src",
      resolveTrackerAssetPath(import.meta.env.BASE_URL, "favicon.svg"),
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
    expect(screen.queryByRole("heading", { name: "Recents" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Boards" })).toBeNull();
    expect(screen.queryByText("Recents")).toBeNull();
    expect(screen.queryByText("Boards")).toBeNull();
  });

  it("expands the route-selected project", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject, removedProject]);
    vi.mocked(listIssues).mockResolvedValue([issue("active-project")]);

    renderProjectSidebar("/projects/active-project/board");

    const selected = await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(selected).toHaveAttribute("aria-expanded", "true"));
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
    expect(screen.queryByText("Symphony Tracker")).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByText("Symphony Tracker")).toBeTruthy();
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
    expect(screen.queryByText("Symphony Tracker")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Collapsed sidebar" })).toBeTruthy();
  });

  it("keeps the current project and activity accessible through collapsed rail tooltips", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(listIssues).mockResolvedValue([issue("active-project", "ACTIVE-1")]);

    renderProjectSidebar("/projects/active-project/board");
    await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(listIssues).toHaveBeenCalled());

    act(() => {
      handlersFor("active-project").onEntry(inventory("/active", "ACTIVE-1"));
      handlersFor("active-project").onDone?.();
    });

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

  it("keeps a single scroll region for the project tree", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    renderProjectSidebar();
    await screen.findByRole("treeitem", { name: /^Active Project,/ });

    expect(document.querySelectorAll("[data-sidebar-tree-scroll-container='true']")).toHaveLength(
      1,
    );
  });

  it("does not clear loaded branch snapshots when projects reload", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(listIssues).mockResolvedValue([issue("active-project", "ACTIVE-1")]);

    renderProjectSidebar("/projects/active-project/board");
    await screen.findByRole("treeitem", { name: /^Active Project,/ });
    await waitFor(() => expect(subscribeWorkspaceInventory).toHaveBeenCalled());

    act(() => {
      handlersFor("active-project").onEntry(inventory("/active", "ACTIVE-1"));
      handlersFor("active-project").onDone?.();
    });

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /^ACTIVE-1,/ })).toBeTruthy();
    });

    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);
    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("treeitem", { name: /^ACTIVE-1,/ })).toBeTruthy();
    expect(listIssues).toHaveBeenCalledTimes(1);
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
