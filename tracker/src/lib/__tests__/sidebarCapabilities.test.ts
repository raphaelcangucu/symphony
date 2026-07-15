import { describe, expect, it } from "vitest";

import { resolveSidebarCapabilities } from "@/lib/sidebarCapabilities";
import type {
  SidebarCapabilityContext,
  SidebarMenuAction,
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const BASE_CONTEXT: SidebarCapabilityContext = {
  editorTarget: null,
  terminalTarget: null,
  workspacePath: null,
  branchName: null,
  workspaceRemovable: false,
  issueCapabilities: null,
  threadCapabilities: null,
};

function project(overrides: Partial<SidebarProjectNode> = {}): SidebarProjectNode {
  return {
    kind: "project",
    id: "demo",
    projectSlug: "demo",
    title: "Demo",
    subtitle: "",
    href: "/projects/demo/board",
    archived: false,
    aggregateStatus: "idle",
    updatedAt: "",
    loadState: "ready",
    error: null,
    workspaces: [],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: false,
    ...overrides,
  };
}

function workspace(overrides: Partial<SidebarWorkspaceNode> = {}): SidebarWorkspaceNode {
  return {
    kind: "workspace",
    id: "workspace:demo:issue:DEMO-1",
    projectSlug: "demo",
    workspaceKind: "issue",
    title: "DEMO-1",
    subtitle: "",
    href: "/projects/demo/workspaces",
    branchSummary: null,
    aggregateStatus: "idle",
    updatedAt: "",
    inventory: null,
    issueIdentifier: "DEMO-1",
    sessions: [],
    overflowSessions: [],
    pinned: false,
    ...overrides,
  };
}

function session(overrides: Partial<SidebarSessionNode> = {}): SidebarSessionNode {
  return {
    kind: "session",
    id: "thread:42",
    projectSlug: "demo",
    workspaceId: "workspace:demo:issue:DEMO-1",
    sessionKind: "chat",
    title: "Session",
    subtitle: "",
    href: "/projects/demo/workspaces/42",
    statusKind: "idle",
    aggregateStatus: "idle",
    agentKind: "claude",
    updatedAt: "",
    threadId: 42,
    issueIdentifier: null,
    archived: false,
    unread: false,
    needsReview: false,
    labels: [],
    issueLabelNames: null,
    pinned: false,
    ...overrides,
  };
}

function ids(actions: readonly SidebarMenuAction[]): string[] {
  return actions.map((action) => action.id);
}

describe("sidebar capabilities", () => {
  it("returns active project actions in stable order", () => {
    expect(ids(resolveSidebarCapabilities(project(), BASE_CONTEXT))).toEqual([
      "new-workspace",
      "new-session",
      "open-board",
      "open-docs",
      "open-settings",
      "rename",
      "archive",
      "remove",
    ]);
    expect(
      resolveSidebarCapabilities(project(), BASE_CONTEXT).slice(-2),
    ).toMatchObject([
      { id: "archive", destructive: true },
      { id: "remove", destructive: true },
    ]);
  });

  it("offers restore and remove for archived projects without create actions", () => {
    const actions = resolveSidebarCapabilities(project({ archived: true }), BASE_CONTEXT);

    expect(ids(actions)).toEqual([
      "open-board",
      "open-docs",
      "open-settings",
      "restore",
      "remove",
    ]);
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it("resolves issue workspace targets and optional copy/remove actions in order", () => {
    const actions = resolveSidebarCapabilities(workspace(), {
      ...BASE_CONTEXT,
      editorTarget: "vscode://file/repo",
      terminalTarget: "/repo",
      workspacePath: "/repo",
      branchName: "feature/demo",
      workspaceRemovable: true,
    });

    expect(ids(actions)).toEqual([
      "new-session",
      "open-editor",
      "open-terminal",
      "pin",
      "rename",
      "copy-branch",
      "copy-path",
      "remove-workspace",
    ]);
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it("omits rename and remove for the main project workspace", () => {
    const actions = resolveSidebarCapabilities(
      workspace({ workspaceKind: "project", issueIdentifier: null }),
      {
        ...BASE_CONTEXT,
        editorTarget: "vscode://file/repo",
        terminalTarget: "/repo",
        workspacePath: "/repo",
        workspaceRemovable: true,
      },
    );

    expect(ids(actions)).toEqual([
      "new-session",
      "open-editor",
      "open-terminal",
      "pin",
      "copy-path",
    ]);
    expect(actions[2]).toMatchObject({ enabled: true });
  });

  it("keeps missing main workspace targets visible and disabled", () => {
    const actions = resolveSidebarCapabilities(
      workspace({ workspaceKind: "project", issueIdentifier: null }),
      BASE_CONTEXT,
    );

    expect(ids(actions)).toEqual([
      "new-session",
      "open-editor",
      "open-terminal",
      "pin",
    ]);
    expect(actions[1]).toMatchObject({ enabled: false });
    expect(actions[2]).toMatchObject({ enabled: false });
    expect(actions[1].disabledReason?.trim()).not.toBe("");
    expect(actions[2].disabledReason?.trim()).not.toBe("");
  });

  it("returns disabled editor and terminal actions with reasons for standalone workspaces", () => {
    const actions = resolveSidebarCapabilities(
      workspace({ workspaceKind: "standalone", issueIdentifier: null }),
      BASE_CONTEXT,
    );

    expect(ids(actions)).toEqual(["new-session", "open-editor", "open-terminal", "pin", "rename"]);
    for (const action of actions.filter((candidate) =>
      ["open-editor", "open-terminal"].includes(candidate.id),
    )) {
      expect(action.enabled).toBe(false);
      expect(action.disabledReason?.trim()).not.toBe("");
    }
  });

  it("enables future standalone targets and keeps destructive removal last", () => {
    const actions = resolveSidebarCapabilities(
      workspace({ workspaceKind: "standalone", issueIdentifier: null }),
      {
        ...BASE_CONTEXT,
        editorTarget: "vscode://file/repo",
        terminalTarget: "/repo",
        workspaceRemovable: true,
      },
    );

    expect(ids(actions)).toEqual([
      "new-session",
      "open-editor",
      "open-terminal",
      "pin",
      "rename",
      "remove-workspace",
    ]);
    expect(actions[1]).toMatchObject({ enabled: true });
    expect(actions[2]).toMatchObject({ enabled: true });
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it("keeps parallel workspace targets disabled when absent", () => {
    const actions = resolveSidebarCapabilities(
      workspace({ workspaceKind: "parallel", issueIdentifier: "DEMO-1" }),
      BASE_CONTEXT,
    );

    expect(ids(actions)).toEqual([
      "new-session",
      "open-editor",
      "open-terminal",
      "pin",
      "rename",
    ]);
    expect(actions[1].disabledReason?.trim()).not.toBe("");
    expect(actions[2].disabledReason?.trim()).not.toBe("");
  });

  it("switches local pin actions without relying on labels", () => {
    expect(
      ids(resolveSidebarCapabilities(workspace({ pinned: true }), BASE_CONTEXT)),
    ).toContain("unpin");
    expect(ids(resolveSidebarCapabilities(session({ pinned: true }), BASE_CONTEXT))).toContain(
      "unpin",
    );
  });

  it("uses issue capabilities for issue-backed rename and labels", () => {
    const actions = resolveSidebarCapabilities(
      session({ issueIdentifier: "DEMO-1" }),
      {
        ...BASE_CONTEXT,
        issueCapabilities: { canRename: false, canManageLabels: true },
        threadCapabilities: {
          canRename: true,
          canManageLabels: true,
          canReview: true,
          canArchive: true,
          canDelete: false,
          local: true,
          active: false,
          closed: false,
        },
      },
    );

    expect(ids(actions)).toEqual(["rename", "manage-labels", "toggle-review", "pin", "archive"]);
    expect(actions[0]).toMatchObject({ enabled: false });
    expect(actions[0].disabledReason?.trim()).not.toBe("");
    expect(actions[1]).toMatchObject({ enabled: true });
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it("returns thread-backed actions and allows deleting active threads", () => {
    const actions = resolveSidebarCapabilities(session({ statusKind: "active" }), {
      ...BASE_CONTEXT,
      threadCapabilities: {
        canRename: true,
        canManageLabels: true,
        canReview: true,
        canArchive: true,
        canDelete: true,
        local: true,
        active: true,
        closed: false,
      },
    });

    expect(ids(actions)).toEqual([
      "rename",
      "manage-labels",
      "toggle-review",
      "pin",
      "archive",
      "delete",
    ]);
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it("allows delete for eligible local threads regardless of archive state", () => {
    const capabilities = {
      canRename: true,
      canManageLabels: true,
      canReview: true,
      canArchive: true,
      canDelete: true,
      local: true,
      active: false,
      closed: true,
    };
    const actions = resolveSidebarCapabilities(session({ statusKind: "closed" }), {
      ...BASE_CONTEXT,
      threadCapabilities: capabilities,
    });

    expect(ids(actions)).toEqual([
      "rename",
      "manage-labels",
      "toggle-review",
      "pin",
      "archive",
      "delete",
    ]);
    expect(actions.at(-1)).toMatchObject({ destructive: true, enabled: true });
  });

  it.each(["active", "running", "waiting", "retrying"] as const)(
    "disables archive for issue-backed %s executions and never offers delete",
    (statusKind) => {
      const actions = resolveSidebarCapabilities(
        session({
          id: "exec:DEMO-1",
          sessionKind: "execution",
          threadId: null,
          issueIdentifier: "DEMO-1",
          statusKind,
        }),
        BASE_CONTEXT,
      );

      expect(ids(actions)).toEqual(["copy-resume-link", "pin", "archive"]);
      expect(actions[2]).toMatchObject({ enabled: false, destructive: true });
      expect(actions[2].disabledReason?.trim()).not.toBe("");
      expect(ids(actions)).not.toContain("delete");
    },
  );

  it("enables archive for inactive issue-backed executions and never offers delete", () => {
    const actions = resolveSidebarCapabilities(
      session({
        id: "exec:DEMO-1",
        sessionKind: "execution",
        threadId: null,
        issueIdentifier: "DEMO-1",
        statusKind: "done",
      }),
      BASE_CONTEXT,
    );

    expect(ids(actions)).toEqual(["copy-resume-link", "pin", "archive"]);
    expect(actions[2]).toMatchObject({ enabled: true, destructive: true });
    expect(ids(actions)).not.toContain("delete");
  });

  it("omits execution-only archive and resume actions without an issue", () => {
    expect(
      ids(
        resolveSidebarCapabilities(
          session({
            id: "exec:unknown",
            sessionKind: "execution",
            threadId: null,
            issueIdentifier: null,
          }),
          BASE_CONTEXT,
        ),
      ),
    ).toEqual(["pin"]);
  });

  it("degrades invalid render inputs to an empty immutable action list", () => {
    for (const node of [
      null,
      "project",
      42,
      { ...project(), archived: "false" },
      { ...workspace(), workspaceKind: "invalid" },
      { ...session(), pinned: 1 },
      Object.assign(Object.create({ inherited: true }), session()),
    ]) {
      const actions = resolveSidebarCapabilities(node as never, BASE_CONTEXT);
      expect(actions).toEqual([]);
      expect(Object.isFrozen(actions)).toBe(true);
    }
  });

  it("fails closed for malformed nested capability objects", () => {
    const malformedIssueContext = {
      ...BASE_CONTEXT,
      issueCapabilities: { canRename: 1, canManageLabels: true },
    } as unknown as SidebarCapabilityContext;
    const issueActions = resolveSidebarCapabilities(
      session({ issueIdentifier: "DEMO-1" }),
      malformedIssueContext,
    );
    expect(issueActions.slice(0, 2)).toMatchObject([
      { id: "rename", enabled: false },
      { id: "manage-labels", enabled: false },
    ]);

    const prototypeCapabilities = Object.assign(
      Object.create({ canDelete: true }),
      {
        canRename: true,
        canManageLabels: true,
        canReview: true,
        canArchive: true,
        canDelete: true,
        local: true,
        active: false,
        closed: true,
      },
    );
    const threadActions = resolveSidebarCapabilities(
      session({ archived: true }),
      {
        ...BASE_CONTEXT,
        threadCapabilities: prototypeCapabilities,
      } as SidebarCapabilityContext,
    );
    expect(threadActions.filter((action) => action.destructive && action.enabled)).toEqual([]);

    const truthyDestructiveActions = resolveSidebarCapabilities(
      session({ archived: true }),
      {
        ...BASE_CONTEXT,
        threadCapabilities: {
          canRename: true,
          canManageLabels: true,
          canReview: true,
          canArchive: "true",
          canDelete: 1,
          local: "yes",
          active: false,
          closed: true,
        },
      } as unknown as SidebarCapabilityContext,
    );
    expect(
      truthyDestructiveActions.filter((action) => action.destructive && action.enabled),
    ).toEqual([]);
  });
});
