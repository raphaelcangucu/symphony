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

  it("normalizes issue attachments and drops entries without an id", () => {
    const issue = normalizeIssue({
      id: 123,
      identifier: "CDE-1",
      project_slug: "advising",
      title: "With attachments",
      attachments: [
        {
          id: 10_500,
          filename: "WHCCD.VAR.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 24_576,
          created: "2026-06-01T09:00:00.000Z",
          author: "Maker",
          is_image: false,
        },
        { filename: "orphan.txt" },
      ],
    });

    expect(issue.attachments).toEqual([
      {
        id: "10500",
        filename: "WHCCD.VAR.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 24_576,
        createdAt: "2026-06-01T09:00:00.000Z",
        author: "Maker",
        isImage: false,
      },
    ]);
  });

  it("defaults attachments to an empty array when omitted", () => {
    const issue = normalizeIssue({ id: 1, identifier: "CDE-2", project_slug: "advising", title: "No files" });
    expect(issue.attachments).toEqual([]);
  });

  it("strips a leading hash from issue identifiers at the API boundary", () => {
    const issue = normalizeIssue({
      id: 508,
      identifier: "#508",
      project_slug: "macro-markets",
      title: "Remove hash identifiers",
    });

    expect(issue.identifier).toBe("508");
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
      warm_up_status: "failed",
      last_warm_up_run_id: 3,
    });

    expect(project).toMatchObject({
      id: "42",
      slug: "macro-markets",
      name: "Macro Markets",
      description: null,
      issueCount: 5,
      createdAt: "2026-05-27T01:00:00Z",
      updatedAt: "2026-05-27T02:00:00Z",
      warmUpStatus: "failed",
      lastWarmUpRunId: 3,
      workflowStatuses: [
        { id: "1", name: "Todo", category: "unstarted", position: 1, isTerminal: false },
        { id: "2", name: "Done", category: "completed", position: 6, isTerminal: true },
      ],
    });
  });

  it("defaults warm-up readiness when the project DTO omits it", () => {
    const project = normalizeProject({
      id: 7,
      slug: "p",
      name: "P",
      description: null,
      inserted_at: "2026-05-27T01:00:00Z",
      updated_at: "2026-05-27T02:00:00Z",
    });

    expect(project.warmUpStatus).toBe("never");
    expect(project.lastWarmUpRunId).toBeNull();
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

describe("normalizeIssue group fields", () => {
  it("reads snake_case group identifiers", () => {
    const issue = normalizeIssue({
      id: 1,
      identifier: "MAC-2",
      title: "Member",
      group_lead_identifier: "MAC-1",
      group_member_identifiers: [],
    });
    expect(issue.groupLeadIdentifier).toBe("MAC-1");
    expect(issue.groupMemberIdentifiers).toEqual([]);
  });

  it("reads a lead's members and defaults to null/[]", () => {
    const lead = normalizeIssue({ id: 2, identifier: "MAC-1", title: "Lead", group_member_identifiers: ["MAC-2"] });
    expect(lead.groupLeadIdentifier).toBeNull();
    expect(lead.groupMemberIdentifiers).toEqual(["MAC-2"]);
  });
});
