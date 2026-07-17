import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectNavigationTree } from "@/components/layout/sidebar/ProjectNavigationTree";
import type { SidebarProjectNode, SidebarSessionNode } from "@/types/sidebar";

function session(id: string, title: string): SidebarSessionNode {
  return {
    kind: "session",
    id,
    projectSlug: "macro",
    workspaceId: "workspace:macro:main",
    sessionKind: "chat",
    title,
    subtitle: "MAC-1",
    href: `/projects/macro/sessions/${id}`,
    statusKind: "idle",
    aggregateStatus: "idle",
    agentKind: "cursor",
    updatedAt: "2026-07-14T12:00:00Z",
    threadId: null,
    issueIdentifier: "MAC-1",
    archived: false,
    unread: false,
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: false,
  };
}

function project(overrides: Partial<SidebarProjectNode> = {}): SidebarProjectNode {
  return {
    kind: "project",
    id: "macro",
    projectSlug: "macro",
    title: "Macro Markets",
    subtitle: "2 sessions",
    href: "/projects/macro/board",
    archived: false,
    aggregateStatus: "idle",
    updatedAt: "2026-07-14T12:00:00Z",
    loadState: "ready",
    error: null,
    sessions: [session("thread:1", "Inflation review")],
    overflowSessions: [],
    nextCursor: null,
    workspaces: [],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ProjectNavigationTree", () => {
  it("renders project sessions directly without workspace navigation rows", () => {
    render(
      <ProjectNavigationTree
        tree={[project()]}
        expandedProjectIds={new Set(["macro"])}
        expandedWorkspaceIds={new Set()}
        currentSelection={{
          projectSlug: "macro",
          workspaceId: "workspace:macro:main",
          sessionId: "thread:1",
        }}
        toggleProject={vi.fn()}
        toggleWorkspace={vi.fn()}
        openNode={vi.fn()}
        renderContextMenu={(_node, trigger) => trigger}
        onRequestNodeAction={vi.fn()}
        retryProject={vi.fn()}
        showAllWorkspaces={vi.fn()}
        showAllSessions={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole("treeitem");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual(["1", "2"]);
    expect(screen.getByRole("treeitem", { name: /Inflation review/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("treeitem", { name: /main/ })).not.toBeInTheDocument();
  });

  it("requests More from the Cursor-style pagination control", async () => {
    const user = userEvent.setup();
    const showAllSessions = vi.fn();
    render(
      <ProjectNavigationTree
        tree={[
          project({
            sessions: [session("thread:1", "One"), session("thread:2", "Two")],
            overflowSessions: [session("thread:3", "Three")],
            nextCursor: "cursor-2",
          }),
        ]}
        expandedProjectIds={new Set(["macro"])}
        expandedWorkspaceIds={new Set()}
        currentSelection={{ projectSlug: "macro", workspaceId: null, sessionId: null }}
        toggleProject={vi.fn()}
        toggleWorkspace={vi.fn()}
        openNode={vi.fn()}
        renderContextMenu={(_node, trigger) => trigger}
        onRequestNodeAction={vi.fn()}
        retryProject={vi.fn()}
        showAllWorkspaces={vi.fn()}
        showAllSessions={showAllSessions}
      />,
    );

    expect(screen.queryByRole("treeitem", { name: /Three/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^More$/i }));

    expect(showAllSessions).toHaveBeenCalledWith("macro");
  });
});
