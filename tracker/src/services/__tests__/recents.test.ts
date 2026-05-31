import { describe, expect, it } from "vitest";

import { normalizeRecentSession } from "@/services/recents";

describe("normalizeRecentSession", () => {
  it("maps snake_case codex item to camelCase", () => {
    const item = normalizeRecentSession({
      id: "codex:ABC-1", kind: "codex", scope: null, project_slug: "demo",
      project_name: "Demo", title: "Fix bug", identifier: "ABC-1", thread_id: null,
      status: "Running", status_kind: "running", preview: null, updated_at: "2026-05-30T00:00:00Z",
    });
    expect(item).toMatchObject({
      id: "codex:ABC-1", kind: "codex", projectSlug: "demo", projectName: "Demo",
      identifier: "ABC-1", threadId: null, statusKind: "running", updatedAt: "2026-05-30T00:00:00Z",
    });
  });

  it("maps a freeform chat item with nil project", () => {
    const item = normalizeRecentSession({
      id: "chat:7", kind: "chat", scope: "freeform", project_slug: null, project_name: null,
      title: "Ideas", identifier: null, thread_id: 7, status: "Active", status_kind: "active",
      preview: "hello", updated_at: "2026-05-30T00:00:00Z",
    });
    expect(item.kind).toBe("chat");
    expect(item.scope).toBe("freeform");
    expect(item.threadId).toBe(7);
    expect(item.preview).toBe("hello");
  });

  it("falls back to a safe status kind for unknown values", () => {
    const item = normalizeRecentSession({
      id: "chat:1", kind: "chat", scope: "project", project_slug: "p", project_name: "P",
      title: "t", identifier: null, thread_id: 1, status: "?", status_kind: "weird",
      preview: null, updated_at: "2026-05-30T00:00:00Z",
    });
    expect(item.statusKind).toBe("active");
  });
});
