import { describe, expect, it } from "vitest";

import type { AssistantThread, ProjectSessionRow, ProjectSummary } from "@/api/contracts";

import { buildSessionTree } from "./session-tree";

const projects: ProjectSummary[] = [
  { id: "project-2", slug: "symphony", name: "Symphony" },
  { id: "project-1", slug: "api", name: "API" },
];

function thread(id: number, overrides: Partial<AssistantThread> = {}): AssistantThread {
  return {
    id,
    scope: "project_session",
    projectSlug: "symphony",
    projectName: "Symphony",
    issueIdentifier: null,
    workspacePath: `/work/${id}`,
    title: `Session ${id}`,
    status: "idle",
    preview: null,
    updatedAt: `2026-07-24T0${id}:00:00Z`,
    agentKind: "codex",
    needsReview: false,
    ...overrides,
  };
}

function projectSession(id: number, overrides: Partial<ProjectSessionRow> = {}): ProjectSessionRow {
  return {
    id: `thread:${id}`,
    threadId: id,
    title: `Session ${id}`,
    kind: "workspace_session",
    scope: "project_session",
    href: `/projects/symphony/workspaces/${id}`,
    updatedAt: `2026-07-24T0${id}:00:00Z`,
    aggregateStatus: null,
    agentKind: "codex",
    issueIdentifier: null,
    workspacePath: `/work/${id}`,
    workspaceId: String(id),
    pinned: false,
    archived: false,
    ...overrides,
  };
}

describe("buildSessionTree", () => {
  it("groups project sessions alphabetically and puts freeform last", () => {
    const tree = buildSessionTree({
      projects,
      threads: [
        thread(1),
        thread(2, {
          projectSlug: "api",
          projectName: "API",
        }),
        thread(3, {
          scope: "freeform",
          projectSlug: null,
          projectName: null,
        }),
      ],
      projectSessions: {},
      query: "",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });

    expect(tree.map((group) => group.key)).toEqual(["project:api", "project:symphony", "freeform"]);
  });

  it("deduplicates thread and project-session rows while merging runtime state", () => {
    const tree = buildSessionTree({
      projects,
      threads: [thread(4, { title: "Canonical title", preview: "Latest answer" })],
      projectSessions: {
        symphony: [
          projectSession(4, {
            title: "Stale title",
            aggregateStatus: "running",
            pinned: true,
          }),
        ],
      },
      query: "",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });

    expect(tree[1]?.sessions).toHaveLength(1);
    expect(tree[1]?.sessions[0]).toEqual(
      expect.objectContaining({
        id: "thread:4",
        threadId: 4,
        title: "Canonical title",
        preview: "Latest answer",
        state: "running",
        pinned: true,
      }),
    );
  });

  it("orders attention, running, queued, pinned, then recent sessions", () => {
    const tree = buildSessionTree({
      projects,
      threads: [
        thread(1, { updatedAt: "2026-07-24T05:00:00Z" }),
        thread(2, { needsReview: true }),
        thread(3),
        thread(4),
        thread(5),
      ],
      projectSessions: {
        symphony: [
          projectSession(1),
          projectSession(2),
          projectSession(3, { aggregateStatus: "running" }),
          projectSession(4, { aggregateStatus: "queued" }),
          projectSession(5, { pinned: true }),
        ],
      },
      query: "",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });

    expect(tree[1]?.sessions.map((session) => session.threadId)).toEqual([2, 3, 4, 5, 1]);
  });

  it("keeps collapsed counts while hiding their rows", () => {
    const tree = buildSessionTree({
      projects,
      threads: [thread(1), thread(2)],
      projectSessions: {},
      query: "",
      collapsedProjectSlugs: new Set(["symphony"]),
      includeArchived: false,
    });
    const symphony = tree.find((group) => group.projectSlug === "symphony");

    expect(symphony).toEqual(
      expect.objectContaining({
        count: 2,
        collapsed: true,
        sessions: [],
      }),
    );
  });

  it("searches project, title, issue, and preview without accents or case", () => {
    const tree = buildSessionTree({
      projects,
      threads: [
        thread(1, { title: "Sessão móvel" }),
        thread(2, { issueIdentifier: "MOB-42" }),
        thread(3, { preview: "Revisar autenticação" }),
      ],
      projectSessions: {},
      query: "AUTENTICACAO",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });

    expect(tree[0]?.sessions.map((session) => session.threadId)).toEqual([3]);

    const byProject = buildSessionTree({
      projects,
      threads: [
        thread(4, {
          projectSlug: "api",
          projectName: "API",
        }),
      ],
      projectSessions: {},
      query: "api",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });
    expect(byProject[0]?.sessions.map((session) => session.threadId)).toEqual([4]);
  });

  it("filters archived rows and derives readable untitled fallbacks", () => {
    const tree = buildSessionTree({
      projects,
      threads: [
        thread(1, { title: null, issueIdentifier: "MOB-7" }),
        thread(2, { title: null, preview: "  Continue mobile work  " }),
        thread(3, { title: null }),
      ],
      projectSessions: {
        symphony: [
          projectSession(1),
          projectSession(2),
          projectSession(3),
          projectSession(8, { archived: true }),
        ],
      },
      query: "",
      collapsedProjectSlugs: new Set(),
      includeArchived: false,
    });

    expect(tree[1]?.sessions.map((session) => session.title)).toEqual([
      "New session",
      "Continue mobile work",
      "MOB-7",
    ]);
    expect(tree[1]?.sessions.some((session) => session.threadId === 8)).toBe(false);
  });
});
