import { describe, expect, it } from "vitest";

import { buildFlatSidebarProject } from "@/lib/flatSidebarTree";
import type { ProjectSessionRow } from "@/types/project-session";
import type { SidebarSessionNode, SidebarTreeBuildOptions } from "@/types/sidebar";

function sessionRow(overrides: Partial<ProjectSessionRow> = {}): ProjectSessionRow {
  return {
    id: "thread:1",
    title: "Session one",
    kind: "chat",
    href: "/projects/demo/workspaces/1",
    updatedAt: "2026-07-14T12:00:00.000000Z",
    aggregateStatus: "active",
    agentKind: "codex",
    issueIdentifier: null,
    workspacePath: "/tmp/demo",
    workspaceId: "1",
    pinned: false,
    archived: false,
    ...overrides,
  };
}

function defaultOptions(
  overrides: Partial<SidebarTreeBuildOptions> = {},
): SidebarTreeBuildOptions {
  return {
    pinnedProjectIds: new Set(),
    pinnedWorkspaceIds: new Set(),
    pinnedSessionIds: new Set(),
    lastReadAtBySession: {},
    sortMode: "activity",
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<Parameters<typeof buildFlatSidebarProject>[0]> = {},
) {
  return {
    projectSlug: "demo",
    projectTitle: "Demo",
    archived: false,
    sessions: [],
    nextCursor: null,
    loadState: "ready" as const,
    error: null,
    options: defaultOptions(),
    ...overrides,
  };
}

describe("buildFlatSidebarProject", () => {
  it("maps project session rows to sidebar session nodes sorted by updatedAt desc", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [
          sessionRow({
            id: "thread:1",
            title: "Older",
            updatedAt: "2026-07-14T10:00:00.000000Z",
          }),
          sessionRow({
            id: "thread:2",
            title: "Newer",
            updatedAt: "2026-07-14T12:00:00.000000Z",
            kind: "execution",
            issueIdentifier: "DEMO-2",
          }),
        ],
      }),
    );

    expect(project.kind).toBe("project");
    expect(project.sessions.map((session) => session.title)).toEqual(["Newer", "Older"]);
    expect(project.sessions[0]).toMatchObject({
      kind: "session",
      id: "thread:2",
      projectSlug: "demo",
      sessionKind: "execution",
      issueIdentifier: "DEMO-2",
      workspaceId: "1",
      href: "/projects/demo/workspaces/1",
    } satisfies Partial<SidebarSessionNode>);
  });

  it("preserves nextCursor and leaves workspace children empty for nav", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [sessionRow()],
        nextCursor: "opaque-cursor",
      }),
    );

    expect(project.nextCursor).toBe("opaque-cursor");
    expect(project.workspaces).toEqual([]);
    expect(project.overflowWorkspaces).toEqual([]);
    expect(project.unassignedSessions).toEqual([]);
  });

  it("partitions visible and overflow sessions using sessionLimit", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [
          sessionRow({ id: "thread:1", updatedAt: "2026-07-14T12:00:00.000000Z" }),
          sessionRow({ id: "thread:2", updatedAt: "2026-07-14T11:00:00.000000Z" }),
          sessionRow({ id: "thread:3", updatedAt: "2026-07-14T10:00:00.000000Z" }),
        ],
        options: defaultOptions({ sessionLimit: 2 }),
      }),
    );

    expect(project.sessions.map((session) => session.id)).toEqual(["thread:1", "thread:2"]);
    expect(project.overflowSessions.map((session) => session.id)).toEqual(["thread:3"]);
  });

  it("keeps pinned sessions visible ahead of unpinned rows", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [
          sessionRow({
            id: "thread:new",
            updatedAt: "2026-07-14T12:00:00.000000Z",
          }),
          sessionRow({
            id: "thread:pinned",
            updatedAt: "2026-07-14T10:00:00.000000Z",
            pinned: true,
          }),
        ],
      }),
    );

    expect(project.sessions.map((session) => session.id)).toEqual(["thread:pinned", "thread:new"]);
    expect(project.sessions[0]?.pinned).toBe(true);
  });

  it("maps workspace_session and issue kinds to sidebar session kinds", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        sessions: [
          sessionRow({
            id: "thread:ws",
            kind: "workspace_session",
            updatedAt: "2026-07-14T12:00:00.000000Z",
          }),
          sessionRow({
            id: "issue:42",
            kind: "issue",
            title: "Board issue",
            updatedAt: "2026-07-14T11:00:00.000000Z",
          }),
        ],
      }),
    );

    const byId = Object.fromEntries(project.sessions.map((session) => [session.id, session]));
    expect(byId["thread:ws"]?.sessionKind).toBe("chat");
    expect(byId["issue:42"]?.sessionKind).toBe("authoring");
    expect(byId["issue:42"]?.threadId).toBeNull();
  });

  it("reflects load errors on the project node", () => {
    const project = buildFlatSidebarProject(
      buildInput({
        loadState: "error",
        error: "Sessions failed",
      }),
    );

    expect(project.loadState).toBe("error");
    expect(project.error).toBe("Sessions failed");
    expect(project.aggregateStatus).toBe("error");
  });
});
