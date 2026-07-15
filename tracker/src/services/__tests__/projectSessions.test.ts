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
      href: "/tracker/projects/advising/workspaces/123",
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

  it("accepts camelCase fields and normalizes unknown agent kinds to null", () => {
    const row = normalizeProjectSessionRow({
      id: "issue:42",
      title: "Backlog item",
      kind: "issue",
      href: "/tracker/projects/demo/board/issues/DEMO-1",
      updatedAt: "2026-07-14T10:00:00.000000Z",
      aggregateStatus: "Todo",
      agentKind: "unknown",
      issueIdentifier: "DEMO-1",
      workspacePath: null,
      workspaceId: null,
      pinned: false,
      archived: true,
    });

    expect(row.agentKind).toBeNull();
    expect(row.archived).toBe(true);
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
          href: "/tracker/projects/demo/workspaces/1",
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
          href: "/tracker/projects/demo/workspaces/1",
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
