import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveAssistantThread,
  createIssueSessionThread,
  createProjectSessionThread,
  deleteAssistantThread,
  listAssistantThreads,
  normalizeAssistantThread,
  updateAssistantThread,
} from "@/services/assistantThreads";
import { http } from "@/services/http";

vi.mock("@/services/http", () => ({
  http: { delete: vi.fn(), get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
  unwrapData: <T,>(response: { data: { data: T } }) => response.data.data,
}));

describe("normalizeAssistantThread", () => {
  it("maps snake_case thread to camelCase", () => {
    const t = normalizeAssistantThread({
      id: 3, scope: "freeform", project_slug: null, project_name: null,
      agent_kind: "cursor", issue_identifier: null, title: "Brainstorm", status: "active",
      preview: "hi", updated_at: "2026-05-30T00:00:00Z",
      workspace_path: "/workspaces/brainstorm", labels: ["planning"], needs_review: true,
    });
    expect(t).toMatchObject({
      id: 3, scope: "freeform", agentKind: "cursor", projectSlug: null, issueIdentifier: null,
      title: "Brainstorm", status: "active", preview: "hi", updatedAt: "2026-05-30T00:00:00Z",
      workspacePath: "/workspaces/brainstorm", labels: ["planning"], needsReview: true,
    });
  });

  it("maps camelCase sidebar metadata and defaults missing or malformed values", () => {
    const camel = normalizeAssistantThread({
      id: 4, scope: "freeform", status: "active", updatedAt: "now",
      workspacePath: "/tmp/thread", labels: ["one", "two"], needsReview: true,
    });
    const malformed = normalizeAssistantThread({
      id: 5, scope: "freeform", status: "active",
      workspace_path: 42, labels: "one", needs_review: "yes",
    } as never);

    expect(camel).toMatchObject({
      workspacePath: "/tmp/thread", labels: ["one", "two"], needsReview: true,
    });
    expect(malformed).toMatchObject({ workspacePath: null, labels: [], needsReview: false });
  });

  it("uses the first valid workspace path with camelCase precedence", () => {
    const snakeFallback = normalizeAssistantThread({
      id: 6,
      scope: "freeform",
      status: "active",
      workspacePath: 42,
      workspace_path: "/snake/fallback",
    });
    const camelPreferred = normalizeAssistantThread({
      id: 7,
      scope: "freeform",
      status: "active",
      workspacePath: "/camel/preferred",
      workspace_path: "/snake/ignored",
    });

    expect(snakeFallback.workspacePath).toBe("/snake/fallback");
    expect(camelPreferred.workspacePath).toBe("/camel/preferred");
  });
});

describe("listAssistantThreads", () => {
  beforeEach(() => vi.mocked(http.get).mockReset());

  it.each([
    [{ includeArchived: true }, "include_archived=true"],
    [{ includeArchived: false }, ""],
    [{}, ""],
  ])("controls the include_archived query parameter", async (options, expected) => {
    vi.mocked(http.get).mockResolvedValue({ data: { data: [] } });

    await listAssistantThreads(options);

    const requestedUrl = vi.mocked(http.get).mock.calls[0][0] as string;
    expect(new URL(requestedUrl, "http://tracker").searchParams.toString()).toBe(expected);
  });
});

describe("createProjectSessionThread", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("creates a project-scoped session thread", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: 12,
          scope: "project_session",
          project_slug: "macro-markets",
          agent_kind: "cursor",
          title: "Project session",
          status: "active",
          updated_at: "2026-07-03T00:00:00Z",
        },
      },
    });

    const thread = await createProjectSessionThread("macro-markets", { title: "Project session", agentKind: "cursor" });

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads", {
      scope: "project_session",
      project_slug: "macro-markets",
      title: "Project session",
      agent_kind: "cursor",
    });
    expect(thread).toMatchObject({ id: 12, scope: "project_session", agentKind: "cursor" });
  });

  it("serializes a validated explicit workspace path", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: 13,
          scope: "project_session",
          project_slug: "macro-markets",
          workspace_path: "/workspaces/macro-markets/__ws_spike",
          status: "active",
        },
      },
    });

    await createProjectSessionThread("macro-markets", {
      workspacePath: "  /workspaces/macro-markets/__ws_spike  ",
    });

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads", {
      scope: "project_session",
      project_slug: "macro-markets",
      title: undefined,
      agent_kind: undefined,
      workspace_path: "/workspaces/macro-markets/__ws_spike",
    });
  });

  it.each(["", "   ", "relative/path", "/valid/path\0suffix"])(
    "rejects invalid explicit workspace path %j",
    async (workspacePath) => {
      await expect(
        createProjectSessionThread("macro-markets", { workspacePath }),
      ).rejects.toThrow(/workspacePath/);
      expect(http.post).not.toHaveBeenCalled();
    },
  );

  it.each([42, null, { path: "/workspaces/project" }])(
    "rejects runtime non-string workspace path %j",
    async (workspacePath) => {
      await expect(
        createProjectSessionThread("macro-markets", { workspacePath } as never),
      ).rejects.toThrow(/workspacePath/);
      expect(http.post).not.toHaveBeenCalled();
    },
  );
});

describe("createIssueSessionThread", () => {
  beforeEach(() => vi.mocked(http.post).mockReset());

  it("serializes an explicit workspace path and preserves issue metadata", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: 20,
          scope: "issue_session",
          project_slug: "macro-markets",
          issue_identifier: "MAC-20",
          workspace_path: "/workspaces/macro-markets/MAC-20__p1",
          status: "active",
        },
      },
    });

    const thread = await createIssueSessionThread("macro-markets", "MAC-20", {
      workspacePath: "/workspaces/macro-markets/MAC-20__p1",
      title: "Parallel pass",
      agentKind: "claude",
      executionMode: "plan",
      isolatedWorkspace: false,
      useParentWorkspace: false,
    });

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads", {
      scope: "issue_session",
      project_slug: "macro-markets",
      issue_identifier: "MAC-20",
      title: "Parallel pass",
      agent_kind: "claude",
      execution_mode: "plan",
      isolated_workspace: undefined,
      use_parent_workspace: undefined,
      workspace_path: "/workspaces/macro-markets/MAC-20__p1",
    });
    expect(thread.workspacePath).toBe("/workspaces/macro-markets/MAC-20__p1");
  });

  it("omits workspace_path for legacy creation", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { data: { id: 21, scope: "issue_session", status: "active" } },
    });

    await createIssueSessionThread("macro-markets", "MAC-21");

    const [url, payload] = vi.mocked(http.post).mock.calls[0];
    expect(url).toBe("/api/tracker/v1/assistant/threads");
    expect(payload).not.toHaveProperty("workspace_path");
  });

  it.each(["", "relative/path", "/valid/path\0suffix"])(
    "rejects invalid explicit workspace path %j",
    async (workspacePath) => {
      await expect(
        createIssueSessionThread("macro-markets", "MAC-20", { workspacePath }),
      ).rejects.toThrow(/workspacePath/);
      expect(http.post).not.toHaveBeenCalled();
    },
  );

  it.each([42, null, { path: "/workspaces/issue" }])(
    "rejects runtime non-string workspace path %j",
    async (workspacePath) => {
      await expect(
        createIssueSessionThread("macro-markets", "MAC-20", { workspacePath } as never),
      ).rejects.toThrow(/workspacePath/);
      expect(http.post).not.toHaveBeenCalled();
    },
  );

  it.each([
    { isolatedWorkspace: true },
    { useParentWorkspace: true },
    { isolatedWorkspace: null },
    { useParentWorkspace: null },
    { isolatedWorkspace: { enabled: false } },
    { useParentWorkspace: 0 },
  ])("rejects explicit workspace conflicts before HTTP: %j", async (conflictingOptions) => {
    await expect(
      createIssueSessionThread("macro-markets", "MAC-20", {
        workspacePath: "/workspaces/macro-markets/MAC-20",
        ...conflictingOptions,
      } as never),
    ).rejects.toThrow(/workspacePath|isolatedWorkspace|useParentWorkspace/);
    expect(http.post).not.toHaveBeenCalled();
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

describe("updateAssistantThread", () => {
  beforeEach(() => vi.mocked(http.patch).mockReset());

  it("trims and normalizes supported fields while preserving false and empty labels", async () => {
    vi.mocked(http.patch).mockResolvedValue({
      data: { data: { id: 7, scope: "freeform", status: "active", needs_review: false } },
    });

    await updateAssistantThread(7, {
      title: "  Sidebar title  ",
      labels: [" one ", "", "one", "two"],
      needsReview: false,
    });

    expect(http.patch).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/7", {
      title: "Sidebar title",
      labels: ["one", "two"],
      needs_review: false,
    });
  });

  it("omits absent fields", async () => {
    vi.mocked(http.patch).mockResolvedValue({
      data: { data: { id: 8, scope: "freeform", status: "active", labels: [] } },
    });

    await updateAssistantThread(8, { labels: [] });

    expect(http.patch).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/8", { labels: [] });
  });

  it("rejects mixed supported and unknown enumerable own keys", async () => {
    await expect(
      updateAssistantThread(1, { title: "Valid", unexpected: true } as never),
    ).rejects.toThrow(/unexpected|supported/i);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it.each(["constructor", "prototype", "__proto__"])(
    "rejects the enumerable own key %s",
    async (key) => {
      const input = { title: "Valid" };
      Object.defineProperty(input, key, { value: true, enumerable: true });

      await expect(updateAssistantThread(1, input)).rejects.toThrow(/supported/i);
      expect(http.patch).not.toHaveBeenCalled();
    },
  );

  it("rejects non-plain objects with inherited keys", async () => {
    const input = Object.create({ inherited: true }) as { title: string };
    input.title = "Valid";

    await expect(updateAssistantThread(1, input)).rejects.toThrow(/plain object/i);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it("rejects enumerable symbols but ignores non-enumerable unknown keys", async () => {
    const symbolInput = { title: "Valid", [Symbol("unexpected")]: true };
    await expect(updateAssistantThread(1, symbolInput)).rejects.toThrow(/supported/i);

    const hiddenInput = { title: "Valid" };
    Object.defineProperty(hiddenInput, "hidden", { value: true, enumerable: false });
    vi.mocked(http.patch).mockResolvedValue({
      data: { data: { id: 1, scope: "freeform", status: "active" } },
    });
    await updateAssistantThread(1, hiddenInput);

    expect(http.patch).toHaveBeenCalledTimes(1);
    expect(http.patch).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/1", {
      title: "Valid",
    });
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid thread id %s before HTTP", async (threadId) => {
    await expect(updateAssistantThread(threadId, { title: "Valid" })).rejects.toThrow(/threadId/);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it.each([
    [null, /input/i],
    [[], /input/i],
    [{}, /at least one/i],
    [{ unsupported: true }, /supported/i],
    [{ title: "   " }, /title/i],
    [{ title: "a".repeat(161) }, /160/],
    [{ labels: "label" }, /labels/i],
    [{ labels: [1] }, /labels/i],
    [{ labels: Array.from({ length: 13 }, (_, index) => `label-${index}`) }, /12/],
    [{ labels: ["a".repeat(41)] }, /40/],
    [{ needsReview: "yes" }, /needsReview/i],
  ])("rejects malformed update input %#", async (input, message) => {
    await expect(updateAssistantThread(1, input as never)).rejects.toThrow(message as RegExp);
    expect(http.patch).not.toHaveBeenCalled();
  });

  it("counts user-perceived graphemes for title and labels", async () => {
    vi.mocked(http.patch).mockResolvedValue({
      data: { data: { id: 1, scope: "freeform", status: "active" } },
    });
    const familyEmoji = "👨‍👩‍👧‍👦";

    await expect(updateAssistantThread(1, {
      title: familyEmoji.repeat(160),
      labels: [familyEmoji.repeat(40)],
    })).resolves.toMatchObject({ id: 1 });
  });
});

describe("deleteAssistantThread", () => {
  beforeEach(() => vi.mocked(http.delete).mockReset());

  it("deletes a valid thread", async () => {
    vi.mocked(http.delete).mockResolvedValue({ data: {} });

    await deleteAssistantThread(11);

    expect(http.delete).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/11");
  });

  it("rejects invalid thread ids before HTTP", async () => {
    await expect(deleteAssistantThread(0)).rejects.toThrow(/threadId/);
    expect(http.delete).not.toHaveBeenCalled();
  });
});
