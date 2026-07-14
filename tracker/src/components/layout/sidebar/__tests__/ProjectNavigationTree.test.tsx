import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectNavigationTree,
  type ProjectNavigationTreeProps,
} from "@/components/layout/sidebar/ProjectNavigationTree";
import { SidebarContextMenu } from "@/components/layout/sidebar/SidebarContextMenu";
import {
  sidebarTreeIndent,
  syntheticRowId,
} from "@/components/layout/sidebar/sidebarVisibleRows";
import { initTestI18n } from "@/i18n/testUtils";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceKind,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:1",
    projectSlug: "macro",
    workspaceId: "workspace:macro:main",
    sessionKind: "chat",
    title: "Inflation review",
    subtitle: "MAC-1",
    href: "/projects/macro/sessions/1",
    statusKind: "running",
    aggregateStatus: "attention",
    agentKind: "cursor",
    updatedAt: new Date().toISOString(),
    threadId: 1,
    issueIdentifier: "MAC-1",
    archived: false,
    unread: true,
    needsReview: true,
    labels: ["macro"],
    issueLabelNames: ["economics"],
    pinned: false,
    ...overrides,
  };
}

function workspace(overrides: Partial<SidebarWorkspaceNode> = {}): SidebarWorkspaceNode {
  const id = overrides.id ?? "workspace:macro:main";
  return {
    kind: "workspace",
    id,
    projectSlug: "macro",
    workspaceKind: "project",
    title: "main",
    subtitle: "/repo/main",
    href: "/projects/macro/sessions",
    branchSummary: "feature/sidebar",
    aggregateStatus: "active",
    updatedAt: new Date().toISOString(),
    inventory: null,
    issueIdentifier: null,
    sessions: [session({ workspaceId: id })],
    overflowSessions: [],
    pinned: false,
    ...overrides,
  };
}

function project(overrides: Partial<SidebarProjectNode> = {}): SidebarProjectNode {
  return {
    kind: "project",
    id: "macro",
    projectSlug: "macro",
    title: "Macro Markets",
    subtitle: "2 workspaces",
    href: "/projects/macro/board",
    archived: false,
    aggregateStatus: "active",
    updatedAt: new Date().toISOString(),
    loadState: "ready",
    error: null,
    workspaces: [workspace()],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

const selection = {
  projectSlug: "macro",
  workspaceId: "workspace:macro:main",
  sessionId: "thread:1",
} as const;

afterEach(() => cleanup());

function callbacks() {
  return {
    toggleProject: vi.fn(),
    toggleWorkspace: vi.fn(),
    openNode: vi.fn(),
    contextMenuOpened: vi.fn(),
    onRequestNodeAction: vi.fn(),
    retryProject: vi.fn(),
    showAllWorkspaces: vi.fn(),
    showAllSessions: vi.fn(),
  };
}

function StatefulTree({
  initialTree = [project()],
  initialProjects = ["macro"],
  initialWorkspaces = ["workspace:macro:main"],
  currentSelection = selection,
  spies = callbacks(),
  renderContextMenu,
}: {
  initialTree?: readonly SidebarProjectNode[];
  initialProjects?: readonly string[];
  initialWorkspaces?: readonly string[];
  currentSelection?: ProjectNavigationTreeProps["currentSelection"];
  spies?: ReturnType<typeof callbacks>;
  renderContextMenu?: ProjectNavigationTreeProps["renderContextMenu"];
}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set(initialProjects));
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(new Set(initialWorkspaces));
  return (
    <ProjectNavigationTree
      tree={initialTree}
      expandedProjectIds={expandedProjects}
      expandedWorkspaceIds={expandedWorkspaces}
      currentSelection={currentSelection}
      toggleProject={(id) => {
        spies.toggleProject(id);
        setExpandedProjects((current) => {
          const next = new Set(current);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        });
      }}
      toggleWorkspace={(id) => {
        spies.toggleWorkspace(id);
        setExpandedWorkspaces((current) => {
          const next = new Set(current);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        });
      }}
      openNode={spies.openNode}
      renderContextMenu={
        renderContextMenu ??
        ((node, trigger) =>
          cloneElement(trigger, {
            onClick: (event) => {
              trigger.props.onClick?.(event);
              spies.contextMenuOpened(node, event.currentTarget);
            },
            onContextMenu: (event) => {
              trigger.props.onContextMenu?.(event);
              spies.contextMenuOpened(node, event.currentTarget);
            },
          }))
      }
      onRequestNodeAction={spies.onRequestNodeAction}
      retryProject={spies.retryProject}
      showAllWorkspaces={spies.showAllWorkspaces}
      showAllSessions={spies.showAllSessions}
    />
  );
}

describe("ProjectNavigationTree", () => {
  it("renders nested accessible levels, selection, status text, and one roving tab stop", () => {
    render(<StatefulTree />);

    const tree = screen.getByRole("tree", { name: "Projects" });
    const rows = within(tree).getAllByRole("treeitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual(["1", "2", "3"]);
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(rows[1]).toHaveAttribute("aria-expanded", "true");
    expect(rows[2]).not.toHaveAttribute("aria-expanded");
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([rows[2]]);
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(tree).toHaveAttribute("data-sidebar-tree-scroll-container", "true");
    expect(tree.querySelectorAll("[data-sidebar-tree-scroll-container]")).toHaveLength(0);
    expect(rows[2]).toHaveAccessibleName(/Inflation review.*(Running|Em execução)/i);
    expect(rows[2]).toHaveAttribute("title", expect.stringContaining("Inflation review"));
    expect(screen.getAllByText(/Running|Em execução/).length).toBeGreaterThan(0);
    expect(screen.getByText("Cursor")).toBeVisible();
    expect(screen.getByText("Unread")).toBeVisible();
    expect(screen.getByText("Review")).toBeVisible();
  });

  it("renders project and workspace summaries with aggregate status text", () => {
    render(<StatefulTree />);

    const projectRow = screen.getByRole("treeitem", { name: /Macro Markets/ });
    expect(projectRow).toHaveAccessibleName(/1 workspace/);
    expect(projectRow).toHaveAccessibleName(/Ativo|Active/);
    expect(within(projectRow).getByText("1 workspace")).toBeVisible();

    const workspaceRow = screen.getByRole("treeitem", { name: /main/ });
    expect(workspaceRow).toHaveAccessibleName(/Project/);
    expect(workspaceRow).toHaveAccessibleName(/feature\/sidebar/);
    expect(workspaceRow).toHaveAccessibleName(/1 session/);
    expect(workspaceRow).toHaveAccessibleName(/Ativo|Active/);
  });

  it.each([
    ["project", "Project"],
    ["issue", "Issue"],
    ["standalone", "Standalone"],
    ["parallel", "Parallel"],
    ["orphan", "Orphan"],
  ] as const)("renders %s workspace kind as %s instead of its raw enum", (workspaceKind, label) => {
    const kindWorkspace = workspace({
      id: `workspace:macro:${workspaceKind}`,
      title: "Kind workspace",
      workspaceKind: workspaceKind as SidebarWorkspaceKind,
      sessions: [],
    });
    render(
      <StatefulTree
        initialTree={[project({ workspaces: [kindWorkspace], subtitle: "1 workspace" })]}
        initialWorkspaces={[kindWorkspace.id]}
      />,
    );

    const row = screen.getByRole("treeitem", { name: /^Kind workspace,/ });
    expect(row).toHaveAccessibleName(new RegExp(label));
  });

  it("keeps embedded row controls outside tab order and isolates keyboard activation", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const projectRow = screen.getByRole("treeitem", { name: /Macro Markets/ });
    const rowButtons = within(projectRow).getAllByRole("button", {
      name: /Macro Markets/,
    });

    expect(projectRow).toHaveAttribute("tabindex", "-1");
    expect(rowButtons).toHaveLength(3);
    expect(rowButtons.every((button) => button.tabIndex === -1)).toBe(true);
    expect(
      screen
        .getAllByRole("treeitem")
        .filter((row) => row.tabIndex === 0),
    ).toHaveLength(1);

    const chevron = within(projectRow).getByRole("button", {
      name: "Collapse Macro Markets",
    });
    chevron.focus();
    await user.keyboard("{Enter}");
    expect(spies.toggleProject).toHaveBeenCalledOnce();
    expect(spies.openNode).not.toHaveBeenCalled();

    const menu = within(projectRow).getByRole("button", {
      name: "More actions for Macro Markets",
    });
    menu.focus();
    await user.keyboard(" ");
    expect(spies.contextMenuOpened).toHaveBeenCalledWith(
      expect.objectContaining({ id: "macro" }),
      menu,
    );
    expect(spies.openNode).not.toHaveBeenCalled();
  });

  it("opens the wrapped Radix context menu from pointer and tree Shift+F10", async () => {
    const user = userEvent.setup();
    const renderContextMenu: ProjectNavigationTreeProps["renderContextMenu"] = (
      node,
      trigger,
    ) => (
      <SidebarContextMenu
        node={node}
        capabilityContext={{
          editorTarget: null,
          terminalTarget: null,
          workspacePath: null,
          branchName: null,
          workspaceRemovable: false,
          issueCapabilities: null,
          threadCapabilities: null,
        }}
        onRunAction={vi.fn().mockResolvedValue({ ok: true })}
        onUtilityAction={vi.fn()}
        onCommittedWarning={vi.fn()}
      >
        {trigger}
      </SidebarContextMenu>
    );
    render(<StatefulTree renderContextMenu={renderContextMenu} />);
    const row = screen.getByRole("treeitem", { name: /^Macro Markets,/ });
    const trigger = within(row).getByRole("button", {
      name: "More actions for Macro Markets",
    });

    fireEvent.pointerDown(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    row.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("preserves row focus on pointer controls and continues arrow navigation from controls", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const sessionRow = screen.getByRole("treeitem", { name: /Inflation review/ });
    const menu = within(sessionRow).getByRole("button", {
      name: "More actions for Inflation review",
    });
    expect(menu).toHaveAttribute("data-sidebar-tree-owner-id", "thread:1");
    sessionRow.focus();

    await user.pointer([{ target: menu, keys: "[MouseLeft]" }]);
    expect(sessionRow).toHaveFocus();
    expect(spies.contextMenuOpened).toHaveBeenCalledOnce();

    menu.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();
    expect(spies.openNode).not.toHaveBeenCalled();
  });

  it("preserves focus on content pointer activation and delegates menu keys from every control", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const projectRow = screen.getByRole("treeitem", { name: /^Macro Markets,/ });
    const controls = [
      within(projectRow).getByRole("button", { name: "Collapse Macro Markets" }),
      within(projectRow).getByRole("button", { name: "Open Macro Markets" }),
      within(projectRow).getByRole("button", { name: "More actions for Macro Markets" }),
    ];

    projectRow.focus();
    await user.pointer([{ target: controls[1], keys: "[MouseLeft]" }]);
    expect(projectRow).toHaveFocus();
    expect(spies.openNode).toHaveBeenCalledOnce();

    for (const control of controls) {
      control.focus();
      await user.keyboard("{Shift>}{F10}{/Shift}");
    }
    expect(spies.contextMenuOpened).toHaveBeenCalledTimes(3);
    expect(
      spies.contextMenuOpened.mock.calls.every(
        ([, trigger]) =>
          trigger ===
          within(projectRow).getByRole("button", {
            name: "More actions for Macro Markets",
          }),
      ),
    ).toBe(true);
  });

  it("delegates Escape from embedded controls only while a menu is open", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const projectRow = screen.getByRole("treeitem", { name: /^Macro Markets,/ });
    const controls = within(projectRow).getAllByRole("button", { name: /Macro Markets/ });

    for (const control of controls) {
      control.focus();
      await user.keyboard("{Escape}");
    }
    expect(spies.contextMenuOpened).not.toHaveBeenCalled();
    expect(spies.openNode).not.toHaveBeenCalled();
    expect(spies.toggleProject).not.toHaveBeenCalled();
  });

  it("keeps content, chevron, and menu actions isolated", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const projectRow = screen.getByRole("treeitem", { name: /Macro Markets/ });

    await user.click(within(projectRow).getByRole("button", { name: "Open Macro Markets" }));
    expect(spies.openNode).toHaveBeenLastCalledWith("/projects/macro/board");
    expect(spies.toggleProject).not.toHaveBeenCalled();
    expect(spies.contextMenuOpened).not.toHaveBeenCalled();

    projectRow.focus();
    await user.click(within(projectRow).getByRole("button", { name: "Collapse Macro Markets" }));
    expect(projectRow).toHaveFocus();
    expect(spies.toggleProject).toHaveBeenCalledWith("macro");
    expect(spies.openNode).toHaveBeenCalledOnce();
    expect(spies.contextMenuOpened).not.toHaveBeenCalled();

    await user.click(within(projectRow).getByRole("button", { name: "More actions for Macro Markets" }));
    expect(spies.contextMenuOpened).toHaveBeenCalledWith(
      expect.objectContaining({ id: "macro" }),
      expect.any(HTMLElement),
    );
    expect(spies.openNode).toHaveBeenCalledOnce();
  });

  it("executes navigation keys and moves real focus through visible rows", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree currentSelection={{ projectSlug: "macro", workspaceId: null, sessionId: null }} spies={spies} />);
    const projectRow = screen.getByRole("treeitem", { name: /Macro Markets/ });
    projectRow.focus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /Inflation review/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(projectRow).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("treeitem", { name: /Inflation review/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /Inflation review/ })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(spies.toggleWorkspace).toHaveBeenCalledWith("workspace:macro:main");
    expect(screen.queryByRole("treeitem", { name: /Inflation review/ })).not.toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(spies.toggleWorkspace).toHaveBeenCalledTimes(2);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: /Inflation review/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(spies.openNode).toHaveBeenCalledWith("/projects/macro/sessions/1");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(spies.contextMenuOpened).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread:1" }),
      expect.any(HTMLButtonElement),
    );
  });

  it("ignores Escape in the tree when no context menu owns focus", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    render(<StatefulTree spies={spies} />);
    const selected = screen.getByRole("treeitem", { name: /Inflation review/ });
    selected.focus();
    await user.keyboard("{Escape}");
    expect(selected).toHaveFocus();
    expect(spies.openNode).not.toHaveBeenCalled();
    expect(spies.contextMenuOpened).not.toHaveBeenCalled();
  });

  it("keeps focus valid after a collapse and after selected data disappears", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    const { rerender } = render(<StatefulTree spies={spies} />);
    const sessionRow = screen.getByRole("treeitem", { name: /Inflation review/ });
    sessionRow.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("treeitem", { name: /main/ })).toHaveFocus();

    rerender(
      <StatefulTree
        initialTree={[project({ workspaces: [] })]}
        currentSelection={{ projectSlug: "missing", workspaceId: null, sessionId: null }}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /^Macro Markets,/ })).toHaveAttribute("tabindex", "0");
    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /^Macro Markets,/ })).toHaveFocus(),
    );
  });

  it("does not steal focus after an explicit move outside the tree", () => {
    const { rerender } = render(
      <>
        <button type="button">Outside control</button>
        <StatefulTree />
      </>,
    );
    const sessionRow = screen.getByRole("treeitem", { name: /Inflation review/ });
    const outside = screen.getByRole("button", { name: "Outside control" });
    sessionRow.focus();
    outside.focus();

    rerender(
      <>
        <button type="button">Outside control</button>
        <StatefulTree
          initialTree={[project({ workspaces: [] })]}
          currentSelection={{ projectSlug: "missing", workspaceId: null, sessionId: null }}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: "Outside control" })).toHaveFocus();
  });

  it("does not reclaim focus after an explicit blur to body while the row remains connected", async () => {
    const { rerender } = render(<StatefulTree />);
    const sessionRow = screen.getByRole("treeitem", { name: /Inflation review/ });
    await act(async () => {
      sessionRow.focus();
      await Promise.resolve();
    });
    await act(async () => {
      sessionRow.blur();
      await Promise.resolve();
    });
    expect(sessionRow.isConnected).toBe(true);
    expect(document.body).toHaveFocus();

    rerender(
      <StatefulTree
        initialTree={[project({ workspaces: [] })]}
        currentSelection={{ projectSlug: "missing", workspaceId: null, sessionId: null }}
      />,
    );
    expect(document.body).toHaveFocus();
  });

  it("does not change external focus when the tree unmounts", () => {
    render(<button type="button">Persistent control</button>);
    const { unmount } = render(<StatefulTree />);
    const outside = screen.getByRole("button", { name: "Persistent control" });
    screen.getByRole("treeitem", { name: /Inflation review/ }).focus();
    outside.focus();
    unmount();
    expect(outside).toHaveFocus();
  });

  it("keeps boundary Home and End commands focused on their current row", async () => {
    const user = userEvent.setup();
    render(<StatefulTree />);
    const projectRow = screen.getByRole("treeitem", { name: /Macro Markets/ });
    projectRow.focus();
    await user.keyboard("{Home}");
    expect(projectRow).toHaveFocus();

    const sessionRow = screen.getByRole("treeitem", { name: /Inflation review/ });
    sessionRow.focus();
    await user.keyboard("{End}");
    expect(sessionRow).toHaveFocus();
  });

  it("renders loading, error retry, stale snapshot, and empty branch actions", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    const states = [
      project({ id: "loading", projectSlug: "loading", title: "Loading", loadState: "loading", workspaces: [] }),
      project({ id: "error", projectSlug: "error", title: "Broken", loadState: "error", error: "offline", workspaces: [] }),
      project({ id: "stale", projectSlug: "stale", title: "Cached", loadState: "stale" }),
      project({ id: "empty", projectSlug: "empty", title: "Empty", workspaces: [], unassignedSessions: [] }),
    ];
    render(<StatefulTree initialTree={states} initialProjects={states.map((item) => item.id)} spies={spies} />);

    expect(screen.getByLabelText("Loading workspaces for Loading")).toBeVisible();
    expect(screen.getByText(/offline/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry Broken" }));
    expect(spies.retryProject).toHaveBeenCalledWith("error");
    expect(screen.getByText("Stale data")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create workspace in Empty" })).toBeVisible();
  });

  it("renders the unassigned group and overflow controls with exact counts", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    const overflowWorkspace = workspace({ id: "workspace:macro:other", title: "other" });
    const overflowSession = session({ id: "thread:2", title: "Second" });
    const node = project({
      workspaces: [workspace({ overflowSessions: [overflowSession] })],
      overflowWorkspaces: [overflowWorkspace],
      unassignedSessions: [session({ id: "thread:3", workspaceId: null, title: "Loose chat" })],
    });
    render(<StatefulTree initialTree={[node]} spies={spies} />);

    expect(screen.getByText("No workspace")).toBeVisible();
    const unassigned = screen.getByRole("treeitem", { name: "No workspace" });
    expect(unassigned).toHaveAttribute("aria-level", "2");
    const looseSession = screen.getByRole("treeitem", { name: /Loose chat/ });
    expect(looseSession).toHaveAttribute("aria-level", "3");
    looseSession.focus();
    await user.keyboard("{ArrowLeft}");
    expect(unassigned).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "1 more workspace" }));
    await user.click(screen.getByRole("button", { name: "1 more session" }));
    expect(spies.showAllWorkspaces).toHaveBeenCalledWith("macro");
    expect(spies.showAllSessions).toHaveBeenCalledWith("workspace:macro:main");
  });

  it("uses valid group ownership for every rendered branch shape", () => {
    const states = [
      project({ id: "loading", projectSlug: "loading", title: "Loading", loadState: "loading", workspaces: [] }),
      project({ id: "error", projectSlug: "error", title: "Broken", loadState: "error", error: "offline", workspaces: [] }),
      project({ id: "stale", projectSlug: "stale", title: "Cached", loadState: "stale" }),
      project({
        id: "unassigned",
        projectSlug: "unassigned",
        title: "Unassigned",
        workspaces: [],
        unassignedSessions: [session({ id: "thread:loose", projectSlug: "unassigned", workspaceId: null })],
      }),
    ];
    render(<StatefulTree initialTree={states} initialProjects={states.map(({ id }) => id)} />);

    for (const group of screen.getAllByRole("group")) {
      for (const child of Array.from(group.children)) {
        const role = child.getAttribute("role");
        expect(["treeitem", "presentation", "none"]).toContain(role);
      }
    }
  });

  it("operates branch pseudo rows with keyboard and pointer", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    const broken = project({
      id: "broken",
      projectSlug: "broken",
      title: "Broken",
      loadState: "error",
      error: "offline",
      workspaces: [],
    });
    render(<StatefulTree initialTree={[broken]} initialProjects={["broken"]} spies={spies} />);
    const errorRow = screen.getByRole("treeitem", { name: /Could not load.*offline/i });
    errorRow.focus();
    await user.keyboard("{Enter}");
    expect(spies.retryProject).toHaveBeenCalledWith("broken");
    await user.click(within(errorRow).getByRole("button", { name: /Retry Broken/i }));
    expect(spies.retryProject).toHaveBeenCalledTimes(2);
  });

  it("localizes singular and plural counts in English and Portuguese", async () => {
    const one = project({
      subtitle: "1 workspace",
      workspaces: [workspace({ sessions: [session()], overflowSessions: [] })],
      overflowWorkspaces: [workspace({ id: "workspace:macro:overflow" })],
    });
    await act(async () => initTestI18n("en"));
    const { unmount } = render(<StatefulTree initialTree={[one]} />);
    expect(screen.getByRole("treeitem", { name: /1 session/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "1 more workspace" })).toBeVisible();
    unmount();

    await act(async () => initTestI18n("pt-BR"));
    render(
      <StatefulTree
        initialTree={[
          project({
            subtitle: "2 workspaces",
            workspaces: [
              workspace({
                sessions: [session(), session({ id: "thread:2" })],
                overflowSessions: [session({ id: "thread:3" }), session({ id: "thread:4" })],
              }),
            ],
            overflowWorkspaces: [
              workspace({ id: "workspace:macro:overflow-1" }),
              workspace({ id: "workspace:macro:overflow-2" }),
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByRole("treeitem", { name: /4 sessões/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mais 2 workspaces" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mais 2 sessões" })).toBeVisible();
  });

  it("drops malformed, unsafe, and duplicate nested nodes deterministically", () => {
    const first = workspace({ id: "duplicate", title: "First workspace" });
    const duplicate = workspace({ id: "duplicate", title: "Second workspace" });
    const invalidStatus = session({ id: "bad-status" }) as unknown as Record<string, unknown>;
    invalidStatus.statusKind = "mystery";
    const unsafeHref = session({ id: "unsafe", href: "https://evil.example" });
    const validSession = session({ id: "valid", title: "Valid session" });
    render(
      <StatefulTree
        initialTree={[
          project({
            workspaces: [
              first,
              duplicate,
              workspace({
                id: "safe",
                title: "Safe workspace",
                sessions: [
                  invalidStatus as unknown as SidebarSessionNode,
                  unsafeHref,
                  validSession,
                  session({ id: "valid", title: "Duplicate session" }),
                ],
              }),
            ],
          }),
        ]}
        initialWorkspaces={["duplicate", "safe"]}
      />,
    );

    expect(screen.getByRole("treeitem", { name: /First workspace/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /Second workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /mystery/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /unsafe/i })).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /Valid session/ })).toBeVisible();
    expect(screen.queryByRole("treeitem", { name: /Duplicate session/ })).not.toBeInTheDocument();
  });

  it("does not reserve IDs for malformed nodes before valid duplicates", () => {
    const malformedProject = {
      ...project(),
      aggregateStatus: "unknown",
    } as unknown as SidebarProjectNode;
    const malformedWorkspace = {
      ...workspace({ id: "recover-workspace", title: "Malformed workspace" }),
      workspaceKind: "unknown",
    } as unknown as SidebarWorkspaceNode;
    const malformedSession = {
      ...session({ id: "recover-session", title: "Malformed session" }),
      statusKind: "unknown",
    } as unknown as SidebarSessionNode;
    const validWorkspace = workspace({
      id: "recover-workspace",
      title: "Recovered workspace",
      sessions: [
        malformedSession,
        session({ id: "recover-session", title: "Recovered session" }),
      ],
    });
    render(
      <StatefulTree
        initialTree={[
          malformedProject,
          project({
            title: "Recovered project",
            workspaces: [malformedWorkspace, validWorkspace],
          }),
        ]}
        initialWorkspaces={["recover-workspace"]}
      />,
    );

    expect(screen.getByRole("treeitem", { name: /^Recovered project,/ })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /^Recovered workspace,/ })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /^Recovered session,/ })).toBeVisible();
  });

  it("uses collision-safe synthetic IDs and shared level indentation", () => {
    expect(syntheticRowId("empty-workspace", "a:b", "c")).not.toBe(
      syntheticRowId("empty-workspace", "a", "b:c"),
    );
    expect(sidebarTreeIndent(1)).toBe(4);
    expect(sidebarTreeIndent(2)).toBe(16);
    expect(sidebarTreeIndent(3)).toBe(28);
  });

  it("fails fast for malformed callback contracts", () => {
    expect(() =>
      render(
        <ProjectNavigationTree
          tree={[]}
          expandedProjectIds={new Set()}
          expandedWorkspaceIds={new Set()}
          currentSelection={{ projectSlug: null, workspaceId: null, sessionId: null }}
          toggleProject={null as unknown as ProjectNavigationTreeProps["toggleProject"]}
          toggleWorkspace={vi.fn()}
          openNode={vi.fn()}
          renderContextMenu={(_node, trigger) => trigger}
          onRequestNodeAction={vi.fn()}
          retryProject={vi.fn()}
          showAllWorkspaces={vi.fn()}
          showAllSessions={vi.fn()}
        />,
      ),
    ).toThrow(/toggleProject.*function/i);
  });

  it("routes an empty workspace create-session action without navigating", async () => {
    const user = userEvent.setup();
    const spies = callbacks();
    const emptyWorkspace = workspace({ sessions: [], overflowSessions: [] });
    render(<StatefulTree initialTree={[project({ workspaces: [emptyWorkspace] })]} spies={spies} />);

    await user.click(screen.getByRole("button", { name: "Create session in main" }));
    expect(spies.onRequestNodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: emptyWorkspace.id }),
    );
    expect(spies.openNode).not.toHaveBeenCalled();
  });

  it("handles empty and invalid trees safely", () => {
    const { rerender } = render(<StatefulTree initialTree={[]} initialProjects={[]} />);
    expect(screen.getByRole("tree", { name: "Projects" })).toBeEmptyDOMElement();
    rerender(<StatefulTree initialTree={[null as unknown as SidebarProjectNode]} initialProjects={[]} />);
    expect(screen.getByRole("tree", { name: "Projects" })).toBeEmptyDOMElement();
  });
});
