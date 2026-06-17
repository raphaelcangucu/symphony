import { beforeEach, describe, expect, it, vi } from "vitest";

import { archiveAssistantThread, normalizeAssistantThread } from "@/services/assistantThreads";
import { http } from "@/services/http";

vi.mock("@/services/http", () => ({
  http: { post: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
  unwrapData: <T,>(response: { data: { data: T } }) => response.data.data,
}));

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

describe("archiveAssistantThread", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("posts to the archive endpoint", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: 9,
          scope: "freeform",
          status: "archived",
          updated_at: "2026-05-30T00:00:00Z",
        },
      },
    });

    const thread = await archiveAssistantThread(9);

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/9/archive");
    expect(thread).toMatchObject({ id: 9, status: "archived" });
  });

  it("rejects invalid thread ids", async () => {
    await expect(archiveAssistantThread(0)).rejects.toThrow(/threadId/);
  });
});
