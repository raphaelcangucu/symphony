import { describe, expect, it } from "vitest";

import {
  normalizeBlocker,
  normalizeComment,
  normalizeIssue,
  normalizeProject,
  normalizeProjectRealtimePayload,
} from "@/services/mappers";

describe("tracker DTO mappers", () => {
  it("normalizes backend issue DTOs into frontend issues", () => {
    const issue = normalizeIssue({
      id: 123,
      identifier: "MAC-1",
      project_slug: "macro-markets",
      status: { id: 1, name: "In Progress", category: "started", position: 2, is_terminal: false },
      title: "Normalize DTOs",
      description: null,
      priority: 2,
      position: 7,
      assignee_id: "agent-1",
      inserted_at: "2026-05-27T01:00:00Z",
      updated_at: "2026-05-27T02:00:00Z",
    });

    expect(issue).toMatchObject({
      id: "123",
      identifier: "MAC-1",
      projectSlug: "macro-markets",
      status: "In Progress",
      blockedBy: [],
      labels: [],
      assignee: "agent-1",
      createdAt: "2026-05-27T01:00:00Z",
      updatedAt: "2026-05-27T02:00:00Z",
    });
  });

  it("normalizes backend project DTOs into frontend projects", () => {
    const project = normalizeProject({
      id: 42,
      slug: "macro-markets",
      name: "Macro Markets",
      description: null,
      issue_count: 5,
      statuses: [
        { id: 1, name: "Todo", category: "unstarted", position: 1, is_terminal: false },
        { id: 2, name: "Done", category: "completed", position: 6, is_terminal: true },
      ],
      inserted_at: "2026-05-27T01:00:00Z",
      updated_at: "2026-05-27T02:00:00Z",
    });

    expect(project).toMatchObject({
      id: "42",
      slug: "macro-markets",
      name: "Macro Markets",
      description: null,
      issueCount: 5,
      createdAt: "2026-05-27T01:00:00Z",
      updatedAt: "2026-05-27T02:00:00Z",
      workflowStatuses: [
        { id: "1", name: "Todo", category: "unstarted", position: 1, isTerminal: false },
        { id: "2", name: "Done", category: "completed", position: 6, isTerminal: true },
      ],
    });
  });

  it("normalizes comments and blockers from snake_case backend DTOs", () => {
    expect(
      normalizeComment({
        id: 456,
        issue_identifier: "MAC-1",
        body: "Needs review",
        author: "codex",
        inserted_at: "2026-05-27T03:00:00Z",
        updated_at: "2026-05-27T03:10:00Z",
      }),
    ).toMatchObject({
      id: "456",
      issueIdentifier: "MAC-1",
      body: "Needs review",
      author: "codex",
      createdAt: "2026-05-27T03:00:00Z",
      updatedAt: "2026-05-27T03:10:00Z",
    });

    expect(
      normalizeBlocker({
        id: 789,
        type: "blocked_by",
        source_identifier: "MAC-1",
        target_identifier: "MAC-2",
        inserted_at: "2026-05-27T04:00:00Z",
      }),
    ).toMatchObject({
      id: "789",
      issueIdentifier: "MAC-1",
      blockingIssueIdentifier: "MAC-2",
      reason: "blocked_by",
      state: "open",
      createdAt: "2026-05-27T04:00:00Z",
      updatedAt: "2026-05-27T04:00:00Z",
    });
  });

  it("normalizes realtime payloads before channel handlers receive them", () => {
    const payload = normalizeProjectRealtimePayload("issue_moved", {
      issue: {
        id: 123,
        identifier: "MAC-1",
        project_slug: "macro-markets",
        status: { name: "Done" },
        title: "Moved",
        description: null,
        priority: null,
        position: 0,
        inserted_at: "2026-05-27T01:00:00Z",
        updated_at: "2026-05-27T02:00:00Z",
      },
    });

    expect(payload.issue.status).toBe("Done");
    expect(payload.issue.projectSlug).toBe("macro-markets");
  });
});
