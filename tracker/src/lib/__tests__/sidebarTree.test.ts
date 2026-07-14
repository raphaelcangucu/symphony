import { describe, expect, it } from "vitest";

import {
  aggregateStatus,
  buildSidebarProjectTree,
  compareSidebarNodes,
  partitionVisibleNodes,
} from "@/lib/sidebarTree";
import type { AgentExecution } from "@/types/agent-execution";
import type { AssistantThread } from "@/types/assistant-thread";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { SidebarProjectBranchInput, SidebarWorkspaceNode } from "@/types/sidebar";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

const PROJECT_PATH = "/repos/demo";
const ISSUE_PATH = "/repos/demo/.worktrees/DEMO-1";

function inventory(
  path: string,
  overrides: Partial<WorkspaceInventoryEntry> = {},
): WorkspaceInventoryEntry {
  return {
    path,
    displayName: null,
    kind: "standalone",
    issueIdentifier: null,
    name: path.split("/").filter(Boolean).at(-1) ?? path,
    classification: "active",
    reclaimable: false,
    workPresent: true,
    executionStatus: null,
    removable: true,
    sizeBytes: 1,
    repos: [],
    childWorktrees: [],
    ...overrides,
  };
}

function issue(identifier: string, title = identifier): Issue {
  return {
    id: identifier,
    identifier,
    projectSlug: "demo",
    status: "In Progress",
    title,
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    attachments: [],
  };
}

function execution(
  identifier: string,
  overrides: Partial<AgentExecution> = {},
): AgentExecution {
  return {
    issueIdentifier: identifier,
    status: "live",
    agentKind: "codex",
    sessionId: `session-${identifier}`,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: "2026-07-10T10:00:00Z",
    turnCount: 1,
    runtimeSeconds: 10,
    startedAt: "2026-07-10T09:00:00Z",
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
    ...overrides,
  };
}

function recent(
  id: string,
  overrides: Partial<RecentSession> = {},
): RecentSession {
  return {
    id,
    kind: "chat",
    scope: "project_session",
    agentKind: "claude",
    projectSlug: "demo",
    projectName: "Demo",
    title: id,
    identifier: null,
    threadId: Number(id.replace(/\D/g, "")) || 1,
    status: "active",
    statusKind: "active",
    preview: null,
    updatedAt: "2026-07-10T11:00:00Z",
    ...overrides,
  };
}

function thread(
  id: number,
  overrides: Partial<AssistantThread> = {},
): AssistantThread {
  return {
    id,
    scope: "project_session",
    agentKind: "claude",
    projectSlug: "demo",
    projectName: "Demo",
    issueIdentifier: null,
    workspacePath: null,
    labels: [],
    needsReview: false,
    title: `Thread ${id}`,
    status: "active",
    preview: null,
    updatedAt: "2026-07-10T11:00:00Z",
    ...overrides,
  };
}

function fixtureInput(
  overrides: Partial<SidebarProjectBranchInput> = {},
): SidebarProjectBranchInput {
  return {
    projectSlug: "demo",
    projectTitle: "Demo",
    archived: false,
    issues: [issue("DEMO-1", "First issue")],
    executions: new Map([["DEMO-1", execution("DEMO-1")]]),
    relatedSessions: [
      recent("authoring", {
        scope: "issue",
        identifier: "DEMO-1",
        threadId: 10,
        title: "Authoring",
      }),
      recent("chat-11", {
        scope: "issue_session",
        identifier: "DEMO-1",
        threadId: 11,
        title: "Issue chat",
      }),
      recent("free-12", {
        scope: "project",
        threadId: 12,
        title: "Free chat",
      }),
    ],
    assistantThreads: [
      thread(11, { issueIdentifier: "DEMO-1", workspacePath: ISSUE_PATH }),
    ],
    inventory: [
      inventory(PROJECT_PATH, { kind: "project", name: "demo", removable: false }),
      inventory(ISSUE_PATH, {
        kind: "issue",
        issueIdentifier: "DEMO-1",
        name: "DEMO-1",
      }),
      inventory("/repos/demo/experiments", { kind: "standalone", name: "experiments" }),
    ],
    loadState: "ready",
    error: null,
    options: {
      pinnedProjectIds: new Set(),
      pinnedWorkspaceIds: new Set(),
      pinnedSessionIds: new Set(),
      lastReadAtBySession: {},
      sortMode: "activity",
      workspaceLimit: 8,
      sessionLimit: 6,
    },
    ...overrides,
  };
}

describe("buildSidebarProjectTree", () => {
  it("builds project, issue, and standalone hierarchy with canonical session nodes", () => {
    const project = buildSidebarProjectTree(fixtureInput());

    expect(project.id).toBe("demo");
    expect(project.workspaces.map((workspace) => workspace.workspaceKind)).toEqual([
      "issue",
      "project",
      "standalone",
    ]);

    const issueWorkspace = project.workspaces.find((workspace) => workspace.workspaceKind === "issue");
    expect(issueWorkspace?.sessions.map(({ id, sessionKind, href }) => ({ id, sessionKind, href }))).toEqual([
      {
        id: "authoring:DEMO-1",
        sessionKind: "authoring",
        href: "/projects/demo/workspaces?exec=DEMO-1",
      },
      {
        id: "thread:11",
        sessionKind: "chat",
        href: "/projects/demo/workspaces/11?assistant_agent=claude",
      },
      {
        id: "exec:DEMO-1",
        sessionKind: "execution",
        href: "/projects/demo/workspaces?exec=DEMO-1&surface=autonomous",
      },
    ]);
    expect(project.unassignedSessions.map((session) => session.title)).toEqual(["Free chat"]);
  });

  it("preserves authoritative thread labels and issue label names on session nodes", () => {
    const labeledIssue = { ...issue("DEMO-1"), labels: ["Bug", "UI"] };
    const project = buildSidebarProjectTree(
      fixtureInput({
        issues: [labeledIssue],
        assistantThreads: [
          thread(11, {
            issueIdentifier: "DEMO-1",
            workspacePath: ISSUE_PATH,
            labels: ["backend"],
          }),
        ],
      }),
    );
    const issueWorkspace = project.workspaces.find(
      (workspace) => workspace.workspaceKind === "issue",
    );
    const chat = issueWorkspace?.sessions.find((session) => session.id === "thread:11");
    expect(chat?.labels).toEqual(["backend"]);
    expect(chat?.issueLabelNames).toEqual(["Bug", "UI"]);
    expect(
      issueWorkspace?.sessions.find((session) => session.sessionKind === "execution")
        ?.labels,
    ).toBeNull();
  });

  it("associates exact workspace paths and leaves prefix near-misses unassigned", () => {
    const standalonePath = "/repos/demo/experiments";
    const input = fixtureInput({
      relatedSessions: [
        recent("exact-21", { threadId: 21, title: "Exact" }),
        recent("near-22", { threadId: 22, title: "Near miss" }),
      ],
      assistantThreads: [
        thread(21, { workspacePath: standalonePath }),
        thread(22, { workspacePath: `${standalonePath}-copy` }),
      ],
    });

    const project = buildSidebarProjectTree(input);
    const standalone = project.workspaces.find((workspace) => workspace.workspaceKind === "standalone");

    expect(standalone?.sessions.map((session) => session.id)).toEqual(["thread:21"]);
    expect(project.unassignedSessions.map((session) => session.id)).toEqual(["thread:22"]);
  });

  it("reconciles authoring recents with thread metadata without duplicate chat nodes", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        relatedSessions: [
          recent("authoring-overlap", {
            scope: "issue",
            identifier: "DEMO-1",
            threadId: 60,
            title: "Authoring overlap",
          }),
        ],
        assistantThreads: [
          thread(60, {
            scope: "issue",
            issueIdentifier: "DEMO-1",
            status: "waiting",
            needsReview: true,
          }),
        ],
      }),
    );
    const allSessions = [
      ...project.workspaces.flatMap((workspace) => [
        ...workspace.sessions,
        ...workspace.overflowSessions,
      ]),
      ...project.unassignedSessions,
    ];
    const authoring = allSessions.filter((session) => session.id === "authoring:DEMO-1");

    expect(authoring).toHaveLength(1);
    expect(authoring[0]).toMatchObject({
      threadId: 60,
      needsReview: true,
      aggregateStatus: "attention",
    });
    expect(allSessions.map((session) => session.id)).not.toContain("thread:60");
  });

  it("deduplicates source IDs by newest valid timestamp while preserving distinct sessions", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        executions: [],
        relatedSessions: [
          recent("duplicate-recent", {
            scope: "project",
            threadId: 61,
            title: "Older recent",
            updatedAt: "2026-07-01T00:00:00Z",
          }),
          recent("duplicate-recent", {
            scope: "project",
            threadId: 61,
            title: "Newest recent",
            updatedAt: "2026-07-12T00:00:00Z",
          }),
          recent("distinct-recent", {
            scope: "project",
            threadId: 62,
            title: "Distinct recent",
            updatedAt: "2026-07-11T00:00:00Z",
          }),
        ],
        assistantThreads: [
          thread(61, {
            title: "Older thread",
            updatedAt: "2026-07-01T00:00:00Z",
          }),
          thread(61, {
            title: "Newest thread",
            updatedAt: "2026-07-13T00:00:00Z",
          }),
          thread(62, {
            title: "Distinct thread",
            updatedAt: "2026-07-11T00:00:00Z",
          }),
        ],
      }),
    );

    expect(project.unassignedSessions.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "thread:61", title: "Newest thread" },
      { id: "thread:62", title: "Distinct thread" },
    ]);
  });

  it("deduplicates distinct recent IDs that emit the same canonical thread node", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        executions: [],
        relatedSessions: [
          recent("source-a", {
            scope: "project",
            threadId: 63,
            title: "Older canonical thread",
            updatedAt: "2026-07-01T00:00:00Z",
          }),
          recent("source-b", {
            scope: "project",
            threadId: 63,
            title: "Newest canonical thread",
            updatedAt: "2026-07-13T00:00:00Z",
          }),
        ],
        assistantThreads: [],
      }),
    );

    expect(
      project.unassignedSessions.filter((session) => session.id === "thread:63"),
    ).toEqual([
      expect.objectContaining({
        id: "thread:63",
        title: "Newest canonical thread",
      }),
    ]);
  });

  it("excludes sessions from other projects and global freeform sessions", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        issues: [
          issue("DEMO-1", "First issue"),
          { ...issue("OTHER-1", "Other issue"), projectSlug: "other" },
        ],
        executions: [
          execution("DEMO-1"),
          execution("OTHER-1"),
        ],
        relatedSessions: [
          recent("other-31", { projectSlug: "other", threadId: 31 }),
          recent("global-32", {
            projectSlug: null,
            projectName: null,
            scope: "freeform",
            threadId: 32,
          }),
          recent("local-33", { scope: "project", threadId: 33, title: "Local unassigned" }),
        ],
        assistantThreads: [],
      }),
    );

    expect(project.unassignedSessions.map((session) => session.id)).toEqual(["thread:33"]);
    expect(
      project.workspaces.flatMap((workspace) => workspace.sessions).map((session) => session.id),
    ).not.toContain("exec:OTHER-1");
  });

  it("excludes project-slugged freeform recents and assistant threads", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        relatedSessions: [
          recent("malformed-freeform-34", {
            scope: "freeform",
            projectSlug: "demo",
            threadId: 34,
          }),
        ],
        assistantThreads: [
          thread(35, {
            scope: "freeform",
            projectSlug: "demo",
            workspacePath: ISSUE_PATH,
          }),
        ],
      }),
    );
    const allSessionIds = [
      ...project.workspaces.flatMap((workspace) => [
        ...workspace.sessions,
        ...workspace.overflowSessions,
      ]),
      ...project.unassignedSessions,
    ].map((session) => session.id);

    expect(allSessionIds).not.toContain("thread:34");
    expect(allSessionIds).not.toContain("thread:35");
  });

  it("preserves error status when a session also needs review", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        executions: [],
        relatedSessions: [
          recent("error-review-41", {
            scope: "issue_session",
            identifier: "DEMO-1",
            threadId: 41,
            status: "error",
            statusKind: "error",
          }),
        ],
        assistantThreads: [
          thread(41, {
            issueIdentifier: "DEMO-1",
            workspacePath: ISSUE_PATH,
            status: "error",
            needsReview: true,
          }),
        ],
      }),
    );
    const issueWorkspace = project.workspaces.find(
      (workspace) => workspace.workspaceKind === "issue",
    );
    const reviewedSession = issueWorkspace?.sessions.find(
      (session) => session.id === "thread:41",
    );

    expect(reviewedSession).toMatchObject({
      aggregateStatus: "error",
      needsReview: true,
    });
    expect(issueWorkspace?.aggregateStatus).toBe("error");
    expect(project.aggregateStatus).toBe("error");
  });

  it("applies the default workspace limit and never hides excess pinned workspaces", () => {
    const inventories = Array.from({ length: 10 }, (_, index) =>
      inventory(`/repos/demo/workspace-${index + 1}`),
    );
    const {
      workspaceLimit: _workspaceLimit,
      sessionLimit: _sessionLimit,
      ...defaultOptions
    } = fixtureInput().options;
    const limited = buildSidebarProjectTree(
      fixtureInput({
        issues: [],
        executions: [],
        relatedSessions: [],
        assistantThreads: [],
        inventory: inventories,
        options: defaultOptions,
      }),
    );
    const pinnedWorkspaceIds = new Set(
      inventories
        .slice(0, 9)
        .map((entry) => `workspace:demo:${entry.path}`),
    );
    const pinned = buildSidebarProjectTree(
      fixtureInput({
        issues: [],
        executions: [],
        relatedSessions: [],
        assistantThreads: [],
        inventory: inventories,
        options: {
          ...defaultOptions,
          pinnedWorkspaceIds,
        },
      }),
    );

    expect(limited.workspaces).toHaveLength(8);
    expect(limited.overflowWorkspaces).toHaveLength(2);
    expect(pinned.workspaces).toHaveLength(9);
    expect(pinned.workspaces.every((workspace) => workspace.pinned)).toBe(true);
    expect(pinned.overflowWorkspaces).toHaveLength(1);
    expect(pinned.overflowWorkspaces[0]?.pinned).toBe(false);
  });

  it("applies the default session limit and never hides excess pinned sessions", () => {
    const projectSessions = Array.from({ length: 8 }, (_, index) =>
      recent(`session-${index + 51}`, {
        scope: "project_session",
        threadId: index + 51,
      }),
    );
    const {
      workspaceLimit: _workspaceLimit,
      sessionLimit: _sessionLimit,
      ...defaultOptions
    } = fixtureInput().options;
    const input = {
      issues: [],
      executions: [],
      relatedSessions: projectSessions,
      assistantThreads: [],
      inventory: [
        inventory(PROJECT_PATH, {
          kind: "project",
          removable: false,
        }),
      ],
    } satisfies Partial<SidebarProjectBranchInput>;
    const limited = buildSidebarProjectTree(
      fixtureInput({
        ...input,
        options: defaultOptions,
      }),
    );
    const pinned = buildSidebarProjectTree(
      fixtureInput({
        ...input,
        options: {
          ...defaultOptions,
          pinnedSessionIds: new Set(
            projectSessions.slice(0, 7).map((session) => `thread:${session.threadId}`),
          ),
        },
      }),
    );
    const limitedMain = limited.workspaces.find(
      (workspace) => workspace.workspaceKind === "project",
    );
    const pinnedMain = pinned.workspaces.find(
      (workspace) => workspace.workspaceKind === "project",
    );

    expect(limitedMain?.sessions).toHaveLength(6);
    expect(limitedMain?.overflowSessions).toHaveLength(2);
    expect(pinnedMain?.sessions).toHaveLength(7);
    expect(pinnedMain?.sessions.every((session) => session.pinned)).toBe(true);
    expect(pinnedMain?.overflowSessions).toHaveLength(1);
    expect(pinnedMain?.overflowSessions[0]?.pinned).toBe(false);
  });

  it("uses display aliases before meaningful inventory and issue fallbacks", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        inventory: [
          inventory(PROJECT_PATH, {
            kind: "project",
            displayName: "Main alias",
            name: "demo",
            removable: false,
          }),
          inventory(ISSUE_PATH, {
            kind: "issue",
            issueIdentifier: "DEMO-1",
            displayName: "Issue alias",
            name: null,
          }),
          inventory("/repos/demo/unnamed", {
            kind: "standalone",
            displayName: "   ",
            name: null,
          }),
        ],
      }),
    );

    expect(
      Object.fromEntries(
        project.workspaces.map((workspace) => [workspace.workspaceKind, workspace.title]),
      ),
    ).toEqual({
      issue: "Issue alias",
      project: "Main alias",
      standalone: "/repos/demo/unnamed",
    });
    expect(project.workspaces.every((workspace) => workspace.title.trim().length > 0)).toBe(true);
  });

  it("preserves project, parallel, and orphan workspace cards", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        inventory: [
          inventory(PROJECT_PATH, { kind: "project", removable: false }),
          inventory("/repos/demo/.worktrees/parallel", {
            kind: "issue_parallel",
            issueIdentifier: "DEMO-1",
          }),
          inventory("/repos/demo/.worktrees/lost", {
            kind: "unknown",
            classification: "orphan",
            name: "lost",
          }),
        ],
      }),
    );

    expect(project.workspaces.map((workspace) => workspace.workspaceKind)).toEqual([
      "issue",
      "parallel",
      "project",
      "orphan",
    ]);
  });

  it("sorts by pinned, error, attention, active, recency, title, and stable id", () => {
    const nodes = [
      workspaceNode("alpha-b", "Alpha", "idle", "2026-01-01T00:00:00Z"),
      workspaceNode("active", "Zulu", "active", "2026-01-01T00:00:00Z"),
      workspaceNode("attention", "Zulu", "attention", "2026-01-01T00:00:00Z"),
      workspaceNode("recent", "Zulu", "idle", "2026-02-01T00:00:00Z"),
      workspaceNode("error", "Zulu", "error", "2026-01-01T00:00:00Z"),
      workspaceNode("alpha-a", "Alpha", "idle", "2026-01-01T00:00:00Z"),
      { ...workspaceNode("pinned", "Pinned", "idle", "bad-date"), pinned: true },
    ];

    expect([...nodes].sort(compareSidebarNodes).map((node) => node.id)).toEqual([
      "pinned",
      "error",
      "attention",
      "active",
      "recent",
      "alpha-a",
      "alpha-b",
    ]);
  });

  it("sorts malformed timestamps as oldest without unstable NaN comparisons", () => {
    const malformed = workspaceNode("malformed", "Same", "idle", "not-a-date");
    const missing = workspaceNode("missing", "Same", "idle", "");
    const valid = workspaceNode("valid", "Same", "idle", "2026-01-01T00:00:00Z");

    expect([malformed, valid, missing].sort(compareSidebarNodes).map((node) => node.id)).toEqual([
      "valid",
      "malformed",
      "missing",
    ]);
    expect(compareSidebarNodes(malformed, missing)).not.toBeNaN();
  });

  it("uses deterministic code-unit ordering for name mode and non-ASCII titles", () => {
    const entries = [
      inventory("/repos/demo/lower-a", { displayName: "a" }),
      inventory("/repos/demo/a-umlaut", { displayName: "ä" }),
      inventory("/repos/demo/upper-z", { displayName: "Z" }),
      inventory("/repos/demo/a-acute", { displayName: "Á" }),
      inventory("/repos/demo/upper-a", { displayName: "A" }),
    ];
    const project = buildSidebarProjectTree(
      fixtureInput({
        issues: [],
        executions: [],
        relatedSessions: [],
        assistantThreads: [],
        inventory: entries,
        options: {
          ...fixtureInput().options,
          sortMode: "name",
        },
      }),
    );

    expect(project.workspaces.map((workspace) => workspace.id)).toEqual([
      "workspace:demo:/repos/demo/upper-a",
      "workspace:demo:/repos/demo/upper-z",
      "workspace:demo:/repos/demo/lower-a",
      "workspace:demo:/repos/demo/a-acute",
      "workspace:demo:/repos/demo/a-umlaut",
    ]);
    expect(
      [
        workspaceNode("é", "Same"),
        workspaceNode("Z", "Same"),
        workspaceNode("a", "Same"),
      ].sort(compareSidebarNodes).map((node) => node.id),
    ).toEqual(["Z", "a", "é"]);
  });

  it("derives unread only for unread chat threads", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        options: {
          ...fixtureInput().options,
          lastReadAtBySession: {
            "thread:11": "2026-07-10T12:00:00Z",
            "authoring:DEMO-1": "2026-07-10T09:00:00Z",
          },
        },
      }),
    );
    const sessions = project.workspaces.flatMap((workspace) => workspace.sessions);

    expect(sessions.find((session) => session.id === "thread:11")?.unread).toBe(false);
    expect(sessions.find((session) => session.id === "authoring:DEMO-1")?.unread).toBe(true);
    expect(sessions.find((session) => session.id === "exec:DEMO-1")?.unread).toBe(false);
    expect(project.unassignedSessions[0]?.unread).toBe(true);
  });

  it("treats malformed last-read timestamps as missing", () => {
    const project = buildSidebarProjectTree(
      fixtureInput({
        options: {
          ...fixtureInput().options,
          lastReadAtBySession: {
            "thread:11": "not-a-timestamp",
            "authoring:DEMO-1": "not-a-timestamp",
            "exec:DEMO-1": "not-a-timestamp",
          },
        },
      }),
    );
    const sessions = project.workspaces.flatMap((workspace) => workspace.sessions);

    expect(sessions.find((session) => session.id === "thread:11")?.unread).toBe(true);
    expect(sessions.find((session) => session.id === "authoring:DEMO-1")?.unread).toBe(false);
    expect(sessions.find((session) => session.id === "exec:DEMO-1")?.unread).toBe(false);
  });

  it("preserves Unix epoch zero while rejecting negative and invalid timestamps", () => {
    const epoch = "1970-01-01T00:00:00.000Z";
    const project = buildSidebarProjectTree(
      fixtureInput({
        executions: [],
        relatedSessions: [
          recent("epoch", {
            scope: "project",
            threadId: 71,
            updatedAt: epoch,
          }),
          recent("negative", {
            scope: "project",
            threadId: 72,
            updatedAt: "1969-12-31T23:59:59.999Z",
          }),
          recent("invalid", {
            scope: "project",
            threadId: 73,
            updatedAt: "not-a-timestamp",
          }),
        ],
        assistantThreads: [],
        options: {
          ...fixtureInput().options,
          lastReadAtBySession: {
            "thread:71": epoch,
          },
        },
      }),
    );
    const byId = new Map(
      project.unassignedSessions.map((session) => [session.id, session]),
    );

    expect(byId.get("thread:71")).toMatchObject({
      updatedAt: epoch,
      unread: false,
    });
    expect(byId.get("thread:72")?.updatedAt).toBe("");
    expect(byId.get("thread:73")?.updatedAt).toBe("");
  });

  it("maps every execution status into aggregate precedence", () => {
    const statuses = [
      "live",
      "idle",
      "waiting",
      "retrying",
      "error",
      "aborted",
      "paused",
      "saved",
    ] as const;
    const issues = statuses.map((status, index) => issue(`DEMO-${index + 1}`, status));
    const project = buildSidebarProjectTree(
      fixtureInput({
        issues,
        executions: statuses.map((status, index) =>
          execution(`DEMO-${index + 1}`, { status }),
        ),
        relatedSessions: [],
        assistantThreads: [],
        inventory: [],
        options: {
          ...fixtureInput().options,
          workspaceLimit: 20,
        },
      }),
    );
    const statusByIdentifier = Object.fromEntries(
      project.workspaces.map((workspace) => [
        workspace.issueIdentifier,
        workspace.aggregateStatus,
      ]),
    );

    expect(statusByIdentifier).toEqual({
      "DEMO-1": "active",
      "DEMO-2": "idle",
      "DEMO-3": "attention",
      "DEMO-4": "attention",
      "DEMO-5": "error",
      "DEMO-6": "attention",
      "DEMO-7": "attention",
      "DEMO-8": "idle",
    });
    expect(project.aggregateStatus).toBe("error");
  });

  it("propagates load, error, and stale state without discarding data", () => {
    const errored = buildSidebarProjectTree(fixtureInput({ loadState: "error", error: "Inventory failed" }));
    const stale = buildSidebarProjectTree(fixtureInput({ loadState: "stale", error: "Refresh failed" }));

    expect(errored).toMatchObject({
      loadState: "error",
      error: "Inventory failed",
      aggregateStatus: "error",
    });
    expect(stale).toMatchObject({
      loadState: "stale",
      error: "Refresh failed",
      aggregateStatus: "error",
    });
    expect(stale.workspaces.length).toBeGreaterThan(0);
  });

  it("does not mutate deeply frozen arrays, records, or option sets", () => {
    const mutableInput = fixtureInput({ executions: [execution("DEMO-1")] });
    const snapshot = structuredClone({
      ...mutableInput,
      executions: [...mutableInput.executions as AgentExecution[]],
      options: {
        ...mutableInput.options,
        pinnedProjectIds: [...mutableInput.options.pinnedProjectIds],
        pinnedWorkspaceIds: [...mutableInput.options.pinnedWorkspaceIds],
        pinnedSessionIds: [...mutableInput.options.pinnedSessionIds],
      },
    });
    const frozenInput = deepFreeze(mutableInput);

    expect(() => buildSidebarProjectTree(frozenInput)).not.toThrow();
    expect({
      ...mutableInput,
      executions: [...mutableInput.executions as AgentExecution[]],
      options: {
        ...mutableInput.options,
        pinnedProjectIds: [...mutableInput.options.pinnedProjectIds],
        pinnedWorkspaceIds: [...mutableInput.options.pinnedWorkspaceIds],
        pinnedSessionIds: [...mutableInput.options.pinnedSessionIds],
      },
    }).toEqual(snapshot);
  });

  it("isolates output inventory and nested collections from input mutation", () => {
    const sourceInventory = inventory(PROJECT_PATH, {
      kind: "project",
      displayName: "Original",
      removable: false,
      repos: [
        {
          name: "source-repo",
          path: PROJECT_PATH,
          branch: "main",
          defaultBranch: "main",
          dirty: false,
          upstream: true,
          aheadCount: 0,
          sizeBytes: 10,
        },
      ],
      childWorktrees: [
        {
          path: `${PROJECT_PATH}/child`,
          repoName: "source-repo",
          slug: "original-child",
          branch: "child",
          dirty: false,
          sizeBytes: 5,
        },
      ],
    });
    const project = buildSidebarProjectTree(
      fixtureInput({
        issues: [],
        executions: [],
        relatedSessions: [],
        assistantThreads: [],
        inventory: [sourceInventory],
      }),
    );
    const outputInventory = project.workspaces[0]?.inventory;
    if (!outputInventory) throw new Error("Expected project inventory");

    outputInventory.displayName = "Changed output";
    outputInventory.repos[0]!.name = "changed-repo";
    outputInventory.childWorktrees[0]!.slug = "changed-child";

    expect(sourceInventory.displayName).toBe("Original");
    expect(sourceInventory.repos[0]?.name).toBe("source-repo");
    expect(sourceInventory.childWorktrees[0]?.slug).toBe("original-child");
  });
});

describe("sidebar project branch input validation", () => {
  it.each([
    ["projectSlug", { projectSlug: " " }, /projectSlug.*non-blank/i],
    ["projectTitle", { projectTitle: "" }, /projectTitle.*non-blank/i],
    ["issues", { issues: {} }, /issues.*array/i],
    ["executions", { executions: {} }, /executions.*iterable/i],
    ["relatedSessions", { relatedSessions: {} }, /relatedSessions.*array/i],
    ["assistantThreads", { assistantThreads: {} }, /assistantThreads.*array/i],
    ["inventory", { inventory: {} }, /inventory.*array/i],
    ["loadState", { loadState: "unknown" }, /loadState.*idle.*loading.*ready.*error.*stale/i],
    ["sortMode", { options: { ...fixtureInput().options, sortMode: "recent" } }, /sortMode.*activity.*name/i],
    ["workspaceLimit", { options: { ...fixtureInput().options, workspaceLimit: Number.NaN } }, /workspaceLimit.*finite/i],
    ["sessionLimit", { options: { ...fixtureInput().options, sessionLimit: -1 } }, /sessionLimit.*non-negative/i],
    ["pinnedProjectIds", { options: { ...fixtureInput().options, pinnedProjectIds: [] } }, /pinnedProjectIds.*Set/i],
    ["lastReadAtBySession", { options: { ...fixtureInput().options, lastReadAtBySession: null } }, /lastReadAtBySession.*object.*Map/i],
  ])("rejects malformed %s", (_field, overrides, expectedMessage) => {
    expect(() =>
      buildSidebarProjectTree(
        fixtureInput(overrides as Partial<SidebarProjectBranchInput>),
      ),
    ).toThrow(expectedMessage);
  });

  it("rejects missing required collections instead of defaulting them", () => {
    const { issues: _issues, ...withoutIssues } = fixtureInput();

    expect(() =>
      buildSidebarProjectTree(withoutIssues as SidebarProjectBranchInput),
    ).toThrow(/issues.*array/i);
  });

  it.each([
    ["issues", [null], /issues\[0\].*object/i],
    ["issues", [{}], /issues\[0\].*identifier/i],
    ["relatedSessions", [null], /relatedSessions\[0\].*object/i],
    ["relatedSessions", [{}], /relatedSessions\[0\].*id/i],
    ["assistantThreads", [null], /assistantThreads\[0\].*object/i],
    ["assistantThreads", [{}], /assistantThreads\[0\].*id/i],
    ["inventory", [null], /inventory\[0\].*object/i],
    ["inventory", [{}], /inventory\[0\].*path/i],
  ])("rejects malformed %s elements with their index", (field, value, expectedMessage) => {
    expect(() =>
      buildSidebarProjectTree(
        fixtureInput({
          [field]: value,
        } as Partial<SidebarProjectBranchInput>),
      ),
    ).toThrow(expectedMessage);
  });
});

describe("sidebar tree helpers", () => {
  it("aggregates status with documented precedence", () => {
    expect(aggregateStatus(["idle", "stale", "active", "attention", "error"])).toBe("error");
    expect(aggregateStatus(["idle", "stale", "active", "attention"])).toBe("attention");
    expect(aggregateStatus(["idle", "stale", "active"])).toBe("active");
    expect(aggregateStatus(["idle", "stale"])).toBe("stale");
    expect(aggregateStatus([])).toBe("idle");
  });

  it("partitions overflow while keeping every pinned node visible", () => {
    const nodes = [
      { ...workspaceNode("pin-a", "A"), pinned: true },
      { ...workspaceNode("pin-b", "B"), pinned: true },
      { ...workspaceNode("pin-c", "C"), pinned: true },
      workspaceNode("regular", "D"),
    ];

    expect(partitionVisibleNodes(nodes, 2)).toEqual({
      visible: nodes.slice(0, 3),
      overflow: nodes.slice(3),
    });
    expect(partitionVisibleNodes(nodes, -10)).toEqual({
      visible: nodes.slice(0, 3),
      overflow: nodes.slice(3),
    });
  });

  it("applies archive, status, agent, activity, and group preferences to tree output", () => {
    const collectSessionIds = (project: ReturnType<typeof buildSidebarProjectTree>) =>
      [
        ...project.workspaces.flatMap((workspace) => [
          ...workspace.sessions,
          ...workspace.overflowSessions,
        ]),
        ...project.overflowWorkspaces.flatMap((workspace) => [
          ...workspace.sessions,
          ...workspace.overflowSessions,
        ]),
        ...project.unassignedSessions,
      ].map((session) => session.id);

    const base = fixtureInput({
      relatedSessions: [
        recent("idle-claude", {
          threadId: 40,
          title: "Idle Claude",
          agentKind: "claude",
          status: "idle",
          statusKind: "idle",
          updatedAt: "2026-07-01T00:00:00Z",
        }),
        recent("active-codex", {
          threadId: 41,
          title: "Active Codex",
          agentKind: "codex",
          status: "active",
          statusKind: "active",
          updatedAt: "2026-07-12T00:00:00Z",
        }),
        recent("archived-codex", {
          threadId: 99,
          title: "Archived chat",
          agentKind: "codex",
          status: "archived",
          statusKind: "idle",
          updatedAt: "2026-07-11T00:00:00Z",
        }),
      ],
      assistantThreads: [
        thread(40, {
          title: "Idle Claude",
          agentKind: "claude",
          status: "idle",
        }),
        thread(41, {
          title: "Active Codex",
          agentKind: "codex",
          status: "active",
        }),
        thread(99, {
          title: "Archived chat",
          agentKind: "codex",
          status: "archived",
        }),
      ],
      executions: new Map(),
      issues: [],
      inventory: [
        inventory(PROJECT_PATH, { kind: "project", name: "demo", removable: false }),
        inventory("/repos/demo/experiments", { kind: "standalone", name: "experiments" }),
      ],
    });

    const shownArchived = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        filters: { showArchived: true },
      },
    });
    expect(collectSessionIds(shownArchived)).toEqual(
      expect.arrayContaining(["thread:40", "thread:41", "thread:99"]),
    );

    const hiddenArchived = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        filters: { showArchived: false },
      },
    });
    expect(collectSessionIds(hiddenArchived)).toEqual(
      expect.arrayContaining(["thread:40", "thread:41"]),
    );
    expect(collectSessionIds(hiddenArchived)).not.toContain("thread:99");

    const activityOnly = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        filters: { showArchived: false, activityOnly: true },
      },
    });
    expect(collectSessionIds(activityOnly)).toEqual(["thread:41"]);

    const agentFiltered = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        filters: { showArchived: false, agents: ["claude"] },
      },
    });
    expect(collectSessionIds(agentFiltered)).toEqual(["thread:40"]);

    const statusFiltered = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        filters: { showArchived: false, statuses: ["idle"] },
      },
    });
    expect(collectSessionIds(statusFiltered)).toEqual(["thread:40"]);

    const grouped = buildSidebarProjectTree({
      ...base,
      options: {
        ...base.options,
        sortMode: "name",
        groupMode: "workspaceKind",
        filters: { showArchived: false },
      },
    });
    expect(grouped.workspaces.map((workspace) => workspace.workspaceKind)).toEqual([
      "project",
      "standalone",
    ]);
  });
});

function workspaceNode(
  id: string,
  title: string,
  aggregateStatus: SidebarWorkspaceNode["aggregateStatus"] = "idle",
  updatedAt = "2026-01-01T00:00:00Z",
): SidebarWorkspaceNode {
  return {
    kind: "workspace",
    id,
    projectSlug: "demo",
    workspaceKind: "standalone",
    title,
    subtitle: "",
    href: "/projects/demo/workspaces",
    branchSummary: null,
    aggregateStatus,
    updatedAt,
    inventory: null,
    issueIdentifier: null,
    sessions: [],
    overflowSessions: [],
    pinned: false,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
