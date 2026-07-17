import { describe, expect, it } from "vitest";

import {
  ancestorIdsForSelection,
  resolveSidebarRouteSelection,
} from "@/lib/sidebarRouteResolution";
import type {
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

function session(
  id: string,
  projectSlug: string,
  workspaceId: string | null,
): SidebarSessionNode {
  return {
    kind: "session",
    id,
    projectSlug,
    workspaceId,
    sessionKind: id.startsWith("exec:")
      ? "execution"
      : id.startsWith("authoring:")
        ? "authoring"
        : "chat",
    title: id,
    subtitle: "",
    href: "",
    statusKind: "idle",
    aggregateStatus: "idle",
    agentKind: null,
    updatedAt: "",
    threadId: id.startsWith("thread:") ? Number(id.slice(7)) : null,
    issueIdentifier: null,
    archived: false,
    unread: false,
    needsReview: false,
    pinned: false,
    labels: null,
    issueLabelNames: null,
  };
}

function workspace(
  id: string,
  projectSlug: string,
  sessions: readonly SidebarSessionNode[] = [],
  overflowSessions: readonly SidebarSessionNode[] = [],
): SidebarWorkspaceNode {
  return {
    kind: "workspace",
    id,
    projectSlug,
    workspaceKind: "issue",
    title: id,
    subtitle: "",
    href: "",
    branchSummary: null,
    aggregateStatus: "idle",
    updatedAt: "",
    inventory: null,
    issueIdentifier: null,
    sessions,
    overflowSessions,
    pinned: false,
  };
}

function project(
  projectSlug: string,
  workspaces: readonly SidebarWorkspaceNode[] = [],
  overflowWorkspaces: readonly SidebarWorkspaceNode[] = [],
  unassignedSessions: readonly SidebarSessionNode[] = [],
): SidebarProjectNode {
  return {
    kind: "project",
    id: projectSlug,
    projectSlug,
    title: projectSlug,
    subtitle: "",
    href: "",
    archived: false,
    aggregateStatus: "idle",
    updatedAt: "",
    loadState: "ready",
    error: null,
    sessions: [],
    overflowSessions: [],
    nextCursor: null,
    workspaces,
    overflowWorkspaces,
    unassignedSessions,
    pinned: false,
  };
}

describe("sidebar route resolution", () => {
  it.each([
    ["/projects/demo/board", "demo"],
    ["/projects/demo/list/issues/DEMO-1/comments", "demo"],
    ["/projects/demo/workspaces", "demo"],
    ["/projects/demo/kb/guides/start", "demo"],
    ["/projects/demo/terminal/", "demo"],
    ["/projects/demo/settings/workflow", "demo"],
    ["/projects/demo/edit", "demo"],
    ["/tracker/projects/demo/assistant", "demo"],
  ])("selects the project for actual project route %s", (pathname, projectSlug) => {
    expect(resolveSidebarRouteSelection(pathname)).toEqual({
      projectSlug,
      workspaceId: null,
      sessionId: null,
    });
  });

  it("decodes encoded project slugs and survives malformed encoding", () => {
    expect(resolveSidebarRouteSelection("/projects/my%20project/board").projectSlug).toBe(
      "my project",
    );
    expect(resolveSidebarRouteSelection("/projects/%E0%A4%A/board")).toEqual({
      projectSlug: null,
      workspaceId: null,
      sessionId: null,
    });
    expect(
      resolveSidebarRouteSelection("/projects/demo/workspaces", "?exec=%E0%A4%A").sessionId,
    ).toBeNull();
  });

  it("selects canonical thread IDs for current and legacy session paths", () => {
    expect(resolveSidebarRouteSelection("/projects/demo/workspaces/42").sessionId).toBe(
      "thread:42",
    );
    expect(resolveSidebarRouteSelection("/projects/demo/sessions/thread%20abc/").sessionId).toBe(
      "thread:thread abc",
    );
  });

  it("selects authoring IDs from workspace search; autonomous query selects nothing", () => {
    expect(
      resolveSidebarRouteSelection("/projects/demo/workspaces", "?exec=DEMO-1").sessionId,
    ).toBe("authoring:DEMO-1");
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=DEMO-1&surface=autonomous",
      ).sessionId,
    ).toBeNull();
    expect(
      resolveSidebarRouteSelection("/projects/demo/workspaces?exec=DEMO-2&agent=execution")
        .sessionId,
    ).toBeNull();
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=%20DEMO-3%20&surface=%20EXECUTION%20",
      ).sessionId,
    ).toBeNull();
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=DEMO-4&agent=%20PLAN%20",
      ).sessionId,
    ).toBe("authoring:DEMO-4");
  });

  it("isolates malformed relevant and unrelated query values", () => {
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?unrelated=%E0%A4%A&exec=DEMO-5&surface=AUTONOMOUS",
      ).sessionId,
    ).toBeNull();
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=DEMO-6&surface=%E0%A4%A",
      ).sessionId,
    ).toBe("authoring:DEMO-6");
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=DEMO-7&surface=%E0%A4%A&agent=execution",
      ).sessionId,
    ).toBe("authoring:DEMO-7");
    expect(
      resolveSidebarRouteSelection(
        "/projects/demo/workspaces",
        "?exec=%E0%A4%A&surface=AUTONOMOUS",
      ).sessionId,
    ).toBeNull();
  });

  it("selects authoring sessions on issue assistant routes", () => {
    expect(
      resolveSidebarRouteSelection("/projects/demo/assistant/issue/DEMO-3").sessionId,
    ).toBe("authoring:DEMO-3");
  });

  it.each(["/", "/projects", "/settings", "/assistant/42", "/kb/page", "/observability"])(
    "returns an empty selection for non-project route %s",
    (pathname) => {
      expect(resolveSidebarRouteSelection(pathname)).toEqual({
        projectSlug: null,
        workspaceId: null,
        sessionId: null,
      });
    },
  );

  it("finds real workspace ancestors across regular and overflow collections", () => {
    const regularId = "workspace:demo:regular";
    const overflowId = "workspace:demo:overflow";
    const tree = [
      project(
        "demo",
        [workspace(regularId, "demo", [session("thread:1", "demo", regularId)])],
        [workspace(overflowId, "demo", [], [session("thread:42", "demo", overflowId)])],
      ),
    ];

    expect(
      ancestorIdsForSelection(
        { projectSlug: "demo", workspaceId: null, sessionId: "thread:42" },
        tree,
      ),
    ).toEqual({ projectIds: ["demo"], workspaceIds: [overflowId] });
  });

  it("expands only the matching project and handles unassigned sessions", () => {
    const tree = [
      project("wrong", [], [], [session("thread:7", "wrong", null)]),
      project("demo", [], [], [session("thread:7", "demo", null)]),
    ];

    expect(
      ancestorIdsForSelection(
        { projectSlug: "demo", workspaceId: null, sessionId: "thread:7" },
        tree,
      ),
    ).toEqual({ projectIds: ["demo"], workspaceIds: [] });
    expect(
      ancestorIdsForSelection(
        { projectSlug: "missing", workspaceId: null, sessionId: "thread:7" },
        tree,
      ),
    ).toEqual({ projectIds: [], workspaceIds: [] });
  });

  it("does not guess when a workspace or session is missing or ambiguous", () => {
    const duplicateId = "workspace:demo:duplicate";
    const tree = [
      project("demo", [
        workspace(duplicateId, "demo", [session("thread:9", "demo", duplicateId)]),
        workspace(duplicateId, "demo", [session("thread:9", "demo", duplicateId)]),
      ]),
    ];

    expect(
      ancestorIdsForSelection(
        { projectSlug: "demo", workspaceId: null, sessionId: "thread:9" },
        tree,
      ),
    ).toEqual({ projectIds: ["demo"], workspaceIds: [] });
  });
});
