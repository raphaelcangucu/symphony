import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "@/components/layout/Layout";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { MD_MEDIA_QUERY } from "@/hooks/useMediaQuery";
import { listAssistantThreads } from "@/services/assistantThreads";
import { listIssues } from "@/services/issues";
import { listProjects } from "@/services/projects";
import { listRecents } from "@/services/recents";
import { fetchWorkspaceInventory, subscribeWorkspaceInventory } from "@/services/worktrees";
import type { Project } from "@/types/project";

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

// Desktop and drawer each mount ProjectSidebar shells. After md-close +
// open-only drawer mount (#1), they are not both interactive after resize.
// These stay stubbed so drawer Escape/backdrop assertions are not racing
// nested NewSession/Search dialog hosts while the drawer is open on a
// mobile viewport (desktop shell remains CSS-hidden but still mounted).
vi.mock("@/components/layout/sidebar/SidebarNewSessionFlow", () => ({
  SidebarNewSessionFlow: () => null,
}));

vi.mock("@/components/layout/sidebar/SidebarSearchLauncher", () => ({
  SidebarSearchLauncher: () => null,
}));

vi.mock("@/components/layout/sidebar/SidebarContextMenu", () => ({
  SidebarContextMenu: ({ children }: { children: ReactNode }) => children,
}));

const OPEN_LABEL = "Open project navigation";
const SIDEBAR_MOBILE_DRAWER_CONTENT_ID = "sidebar-mobile-drawer-content";

const activeProject: Project = {
  id: "active-1",
  name: "Active Project",
  slug: "active-project",
  description: "Shipping now",
  issueCount: 2,
  tracker: { kind: "local", config: {} },
  archivedAt: null,
};

type MatchMediaListener = (event: MediaQueryListEvent) => void;

let matchMediaListeners: MatchMediaListener[] = [];
let mdMatches = false;

function setMdMatches(matches: boolean) {
  mdMatches = matches;
  matchMediaListeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
}

function installMatchMediaMock() {
  matchMediaListeners = [];
  mdMatches = false;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      media: query,
      get matches() {
        return query === MD_MEDIA_QUERY ? mdMatches : false;
      },
      addEventListener: (eventName: string, listener: MatchMediaListener) => {
        if (eventName === "change") {
          matchMediaListeners.push(listener);
        }
      },
      removeEventListener: (_eventName: string, listener: MatchMediaListener) => {
        matchMediaListeners = matchMediaListeners.filter((current) => current !== listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
      onchange: null,
    })),
  });
}

function renderMobileShell(initialEntry = "/projects") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="projects" element={<div>Projects page</div>} />
          <Route path="projects/:projectSlug/*" element={<div>Project page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function openMobileDrawer(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: OPEN_LABEL });
  await user.click(trigger);
  return screen.findByRole("dialog");
}

describe("SidebarMobileDrawer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    window.localStorage.clear();
    installMatchMediaMock();
    vi.mocked(useAgentExecutions).mockReturnValue({
      executions: new Map(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(listIssues).mockResolvedValue([]);
    vi.mocked(listRecents).mockResolvedValue([]);
    vi.mocked(listAssistantThreads).mockResolvedValue([]);
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(fetchWorkspaceInventory).mockResolvedValue({
      entries: [],
      totals: { count: 0, sizeBytes: 0, reclaimableBytes: 0 },
    });
    vi.mocked(subscribeWorkspaceInventory).mockReturnValue(vi.fn());
  });

  afterEach(() => {
    matchMediaListeners = [];
    mdMatches = false;
  });

  it("shows a mobile navigation trigger with an accessible name and dialog controls", async () => {
    renderMobileShell();

    const trigger = await screen.findByRole("button", { name: OPEN_LABEL });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", SIDEBAR_MOBILE_DRAWER_CONTENT_ID);
    const mobileShell = trigger.closest("[class*='md:hidden']");
    expect(mobileShell).toBeTruthy();
    expect(mobileShell!.className).toMatch(/md:hidden/);
  });

  it("opens the same sidebar content in a left Sheet", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    const trigger = await screen.findByRole("button", { name: OPEN_LABEL });

    const dialog = await openMobileDrawer(user);
    expect(dialog).toHaveAttribute("data-side", "left");
    expect(dialog).toHaveAttribute("id", SIDEBAR_MOBILE_DRAWER_CONTENT_ID);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(dialog).getByRole("button", { name: "Close project navigation" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("treeitem", { name: /^Active Project,/ }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("tree", { name: "Projects" })).toBeTruthy();
    expect(within(dialog).getByRole("navigation", { name: "Sidebar utilities" })).toBeTruthy();
  });

  it("moves focus inside the drawer and exposes a modal focus trap", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    await screen.findByRole("button", { name: OPEN_LABEL });

    const dialog = await openMobileDrawer(user);
    expect(dialog).toHaveAttribute("role", "dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    const focused = document.activeElement as HTMLElement;
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(focused);
  });

  it("closes on Escape and backdrop click", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    await screen.findByRole("button", { name: OPEN_LABEL });

    await openMobileDrawer(user);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openMobileDrawer(user);
    const overlay = document.querySelector(".fixed.inset-0.z-50");
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes after successful navigation", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    await screen.findByRole("button", { name: OPEN_LABEL });

    const dialog = await openMobileDrawer(user);
    const project = within(dialog).getByRole("treeitem", { name: /^Active Project,/ });
    await user.click(within(project).getByRole("button", { name: /open active project/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preserves expanded tree preferences across close and reopen", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    await screen.findByRole("button", { name: OPEN_LABEL });

    let dialog = await openMobileDrawer(user);
    const project = within(dialog).getByRole("treeitem", { name: /^Active Project,/ });
    expect(project).toHaveAttribute("aria-expanded", "false");

    const expand = within(project).getByRole("button", { name: /expand active project/i });
    await user.click(expand);
    await waitFor(() => expect(project).toHaveAttribute("aria-expanded", "true"));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openMobileDrawer(user);
    expect(
      within(dialog).getByRole("treeitem", { name: /^Active Project,/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the desktop sidebar mounted only at md and above", async () => {
    renderMobileShell();
    await screen.findByRole("button", { name: OPEN_LABEL });

    const desktopAside = document.querySelector("aside.hidden.md\\:flex, aside[class*='hidden'][class*='md:flex']");
    expect(desktopAside).toBeTruthy();
    expect(desktopAside!.className).toMatch(/\bhidden\b/);
    expect(desktopAside!.className).toMatch(/\bmd:flex\b/);
  });

  it("closes the drawer when the viewport crosses to md", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    const trigger = await screen.findByRole("button", { name: OPEN_LABEL });

    await openMobileDrawer(user);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector('[data-sidebar-variant="drawer"]')).toBeTruthy();

    act(() => setMdMatches(true));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-sidebar-variant="drawer"]')).toBeNull();
    expect(document.querySelector('[data-sidebar-variant="desktop"]')).toBeTruthy();
  });

  it("does not create a second project fetch or cache instance for the drawer", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: OPEN_LABEL });

    const dialog = await openMobileDrawer(user);
    await within(dialog).findByRole("treeitem", { name: /^Active Project,/ });

    expect(listProjects).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });
    expect(listProjects).toHaveBeenCalledTimes(1);
  });
});
