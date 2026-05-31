import { describe, expect, it } from "vitest";

import { normalizeAssistantThread } from "@/services/assistantThreads";

describe("normalizeAssistantThread", () => {
  it("maps snake_case thread to camelCase", () => {
    const t = normalizeAssistantThread({
      id: 3, scope: "freeform", project_slug: null, project_name: null,
      issue_identifier: null, title: "Brainstorm", status: "active",
      preview: "hi", updated_at: "2026-05-30T00:00:00Z",
    });
    expect(t).toMatchObject({
      id: 3, scope: "freeform", projectSlug: null, issueIdentifier: null,
      title: "Brainstorm", status: "active", preview: "hi", updatedAt: "2026-05-30T00:00:00Z",
    });
  });
});
