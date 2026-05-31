import { describe, expect, it } from "vitest";

import { recentSessionPath } from "@/components/layout/recentSessionPath";
import type { RecentSession } from "@/types/recents";

const base: RecentSession = {
  id: "x", kind: "chat", scope: "freeform", projectSlug: null, projectName: null,
  title: "t", identifier: null, threadId: null, status: "", statusKind: "active",
  preview: null, updatedAt: "",
};

describe("recentSessionPath", () => {
  it("freeform chat → /assistant/:threadId", () => {
    expect(recentSessionPath({ ...base, kind: "chat", scope: "freeform", threadId: 7 })).toBe("/assistant/7");
  });
  it("project chat → /projects/:slug/assistant", () => {
    expect(recentSessionPath({ ...base, kind: "chat", scope: "project", projectSlug: "demo", threadId: 3 })).toBe("/projects/demo/assistant");
  });
  it("codex → issue detail", () => {
    expect(recentSessionPath({ ...base, kind: "codex", scope: null, projectSlug: "demo", identifier: "ABC-1" })).toBe("/projects/demo/board/issues/ABC-1");
  });
  it("freeform chat without threadId → /assistant", () => {
    expect(recentSessionPath({ ...base, kind: "chat", scope: "freeform", threadId: null })).toBe("/assistant");
  });
  it("codex without projectSlug → /projects", () => {
    expect(recentSessionPath({ ...base, kind: "codex", scope: null, projectSlug: null, identifier: "ABC-1" })).toBe("/projects");
  });
  it("project chat without projectSlug → /assistant fallback", () => {
    expect(recentSessionPath({ ...base, kind: "chat", scope: "project", projectSlug: null, threadId: 3 })).toBe("/assistant");
  });
});
