import { describe, expect, it } from "vitest";

import { normalizeProjectSessionRow, normalizeProjectSessionsPage } from "@/services/projectSessions";

describe("normalizeProjectSessionRow", () => {
  it("maps snake_case session row to camelCase", () => {
    const row = normalizeProjectSessionRow({
      id: "thread:123",
      title: "Fix login",
      kind: "execution",
      href: "/tracker/projects/advising/workspaces/123",
      updated_at: "2026-07-14T12:00:00.000000Z",
      aggregate_status: "live",
      agent_kind: "codex",
      issue_identifier: "ADV-1",
      workspace_path: "/tmp/advising",
      workspace_id: "8006",
      pinned: true,
      archived: false,
    });

    expect(row).toEqual({
      id: "thread:123",
      title: "Fix login",
      kind: "execution",
      scope: "issue_session",
      href: "/projects/advising/workspaces/123",
      updatedAt: "2026-07-14T12:00:00.000000Z",
      aggregateStatus: "live",
      agentKind: "codex",
      issueIdentifier: "ADV-1",
      workspacePath: "/tmp/advising",
      workspaceId: "8006",
      pinned: true,
      archived: false,
    });
  });

  it("normalizes unknown agent kinds to null", () => {
    const row = normalizeProjectSessionRow({
      id: "issue:42",
      title: "Backlog item",
      kind: "issue",
      href: "/tracker/projects/demo/board/issues/DEMO-1",
      updated_at: "2026-07-14T10:00:00.000000Z",
      aggregate_status: "Todo",
      agent_kind: "unknown",
      issue_identifier: "DEMO-1",
      workspace_path: null,
      workspace_id: null,
      pinned: false,
      archived: true,
    });

    expect(row.agentKind).toBeNull();
    expect(row.archived).toBe(true);
    expect(row.href).toBe("/projects/demo/board/issues/DEMO-1");
  });

  it("preserves issue_execution scope for orchestrator sessions", () => {
    const row = normalizeProjectSessionRow({
      id: "thread:8056",
      title: "GAM-20",
      kind: "execution",
      scope: "issue_execution",
      href: "/projects/gamba/workspaces/8056",
      updated_at: "2026-07-17T17:33:31Z",
      aggregate_status: "active",
      agent_kind: "codex",
      issue_identifier: "GAM-20",
      workspace_path: "/tmp/gamba/GAM-20",
      workspace_id: null,
      pinned: false,
      archived: false,
    });

    expect(row.scope).toBe("issue_execution");
  });
});

describe("normalizeProjectSessionsPage", () => {
  it("maps snake_case page envelope to camelCase", () => {
    const page = normalizeProjectSessionsPage({
      data: [
        {
          id: "thread:1",
          title: "Session A",
          kind: "workspace_session",
          scope: "project_session",
          href: "/projects/demo/workspaces/1",
          updated_at: "2026-07-14T11:00:00.000000Z",
          aggregate_status: "active",
          agent_kind: "cursor",
          issue_identifier: null,
          workspace_path: "/tmp/demo",
          workspace_id: "1",
          pinned: false,
          archived: false,
        },
      ],
      meta: {
        next_cursor: "opaque-cursor",
        project_activity_at: "2026-07-14T11:00:00.000000Z",
      },
    });

    expect(page).toEqual({
      sessions: [
        {
          id: "thread:1",
          title: "Session A",
          kind: "workspace_session",
          scope: "project_session",
          href: "/projects/demo/workspaces/1",
          updatedAt: "2026-07-14T11:00:00.000000Z",
          aggregateStatus: "active",
          agentKind: "cursor",
          issueIdentifier: null,
          workspacePath: "/tmp/demo",
          workspaceId: "1",
          pinned: false,
          archived: false,
        },
      ],
      nextCursor: "opaque-cursor",
      projectActivityAt: "2026-07-14T11:00:00.000000Z",
    });
  });
});
