import { describe, expect, it } from "vitest";

import type { ProjectSessionRow } from "@/api/contracts";
import type { Worktree } from "@/dev10x/worktree/workspace-list-types";

import { selectProjectWorkspaces } from "./project-workspaces";

describe("project workspaces", () => {
  it("groups project sessions by workspace and keeps the latest session as the entry point", () => {
    const sessions = [
      session({
        id: "thread:12",
        threadId: 12,
        title: "Review checkout",
        workspacePath: "/work/alpha/checkout",
        aggregateStatus: "active",
      }),
      session({
        id: "thread:11",
        threadId: 11,
        title: "Initial checkout",
        workspacePath: "/work/alpha/checkout",
        aggregateStatus: "idle",
      }),
      session({
        id: "thread:9",
        threadId: 9,
        title: "Payments",
        workspacePath: "/work/alpha/payments",
        aggregateStatus: "saved",
      }),
    ];
    const worktrees = [
      worktree({
        worktreeId: "12",
        path: "/work/alpha/checkout",
        displayName: "Checkout",
        repo: "storefront",
        branch: "feature/checkout",
      }),
    ];

    expect(selectProjectWorkspaces(sessions, worktrees)).toEqual([
      expect.objectContaining({
        path: "/work/alpha/checkout",
        title: "Checkout",
        subtitle: "storefront · feature/checkout · 2 sessões",
        threadId: 12,
        status: "active",
      }),
      expect.objectContaining({
        path: "/work/alpha/payments",
        title: "payments",
        subtitle: "1 sessão",
        threadId: 9,
        status: "saved",
      }),
    ]);
  });

  it("does not leak machine worktrees without a session in the selected project", () => {
    const foreignWorkspace = worktree({
      worktreeId: "90",
      path: "/work/other/unrelated",
      displayName: "Other project",
    });

    expect(selectProjectWorkspaces([], [foreignWorkspace])).toEqual([]);
  });
});

function session(overrides: Partial<ProjectSessionRow>): ProjectSessionRow {
  return {
    id: "thread:1",
    threadId: 1,
    title: "Session",
    kind: "workspace_session",
    scope: "project_session",
    href: "/projects/alpha/workspaces/1",
    updatedAt: "2026-07-29T12:00:00Z",
    aggregateStatus: "idle",
    agentKind: "codex",
    issueIdentifier: null,
    workspacePath: "/work/alpha/default",
    workspaceId: null,
    pinned: false,
    archived: false,
    ...overrides,
  };
}

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    worktreeId: "1",
    repoId: "repo-1",
    repo: "alpha",
    branch: "main",
    displayName: "Alpha",
    path: "/work/alpha/default",
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: "",
    unread: false,
    isPinned: false,
    linkedPR: null,
    ...overrides,
  };
}
