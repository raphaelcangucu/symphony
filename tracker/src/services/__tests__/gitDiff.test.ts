import { describe, expect, it, vi } from "vitest";

import {
  commitGitDiff,
  commitThreadGitDiff,
  generateCommitMessage,
  getGitDiff,
  getGitDiffFiles,
  getGitDiffPatch,
  getGitDiffStats,
  getGitDiffSummaries,
  getThreadGitDiff,
  getThreadGitDiffFiles,
  getThreadGitDiffPatch,
  getThreadGitDiffStats,
  getThreadGitDiffSummaries,
  pushGitDiff,
} from "@/services/gitDiff";
import { http } from "@/services/http";

vi.mock("@/services/http", () => ({
  http: { get: vi.fn(), post: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
}));

describe("getGitDiff", () => {
  it("loads and normalizes workspace diff repos", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [
          {
            repo: "frontend",
            files: [{ path: "src/App.tsx", old_path: null, status: "modified", patch: "diff --git" }],
          },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiff("demo", "ABC-1", "branch");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff", {
      params: { type: "branch" },
      signal: undefined,
    });
    expect(result).toEqual({
      repos: [
        {
          repo: "frontend",
          branch: null,
          base: null,
          ahead: null,
          behind: null,
          files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "diff --git" }],
        },
      ],
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("maps branch metadata from the raw envelope", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [
          {
            repo: "frontend",
            branch: "feat/x",
            base: "main",
            ahead: 3,
            behind: 1,
            files: [{ path: "src/App.tsx", old_path: null, status: "modified", patch: "diff --git" }],
          },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiff("demo", "ABC-1", "branch");

    expect(result.repos[0]).toEqual({
      repo: "frontend",
      branch: "feat/x",
      base: "main",
      ahead: 3,
      behind: 1,
      files: [{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "diff --git" }],
    });
  });

  it("coerces non-numeric ahead/behind values to null", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [{ repo: "frontend", ahead: "3", behind: null, files: [] }],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiff("demo", "ABC-1", "branch");

    expect(result.repos[0]?.ahead).toBeNull();
    expect(result.repos[0]?.behind).toBeNull();
  });

  it("loads thread workspace diffs", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [],
        workspace: { path: "/tmp/thread", available: true },
      },
    });

    const result = await getThreadGitDiff(42, "uncommitted");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff", {
      params: { type: "uncommitted" },
      signal: undefined,
    });
    expect(result.workspace).toEqual({ path: "/tmp/thread", available: true });
  });

  it("commits issue workspace changes", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: [{ repo: "frontend", sha: "abc", message: "feat: save", files: ["src/App.tsx"] }],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await commitGitDiff("demo", "ABC-1", "feat: save");

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/commit", {
      message: "feat: save",
    });
    expect(result.commits).toEqual([{ repo: "frontend", sha: "abc", message: "feat: save", files: ["src/App.tsx"] }]);
  });

  it("commits thread workspace changes", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { data: [], workspace: { path: "/tmp/thread", available: true } },
    });

    await commitThreadGitDiff(42, "feat: save");

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff/commit", {
      message: "feat: save",
    });
  });
});

describe("getGitDiffStats", () => {
  it("loads and normalizes per-repo diff stats", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [
          {
            repo: "frontend",
            branch: "feat/x",
            base: "main",
            files_changed: 3,
            additions: 10,
            deletions: 2,
            untracked: 1,
          },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiffStats("demo", "ABC-1", "uncommitted");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/stats", {
      params: { type: "uncommitted" },
      signal: undefined,
    });
    expect(result).toEqual({
      stats: [{ repo: "frontend", branch: "feat/x", base: "main", filesChanged: 3, additions: 10, deletions: 2, untracked: 1 }],
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("defaults missing numeric fields to zero", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: { data: [{ repo: "frontend" }], workspace: { path: "/tmp/ws", available: true } },
    });

    const result = await getGitDiffStats("demo", "ABC-1", "branch");

    expect(result.stats[0]).toEqual({
      repo: "frontend",
      branch: null,
      base: null,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      untracked: 0,
    });
  });

  it("loads thread diff stats", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: { data: [], workspace: { path: "/tmp/thread", available: true } },
    });

    await getThreadGitDiffStats(42, "branch");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff/stats", {
      params: { type: "branch" },
      signal: undefined,
    });
  });
});

describe("getGitDiffFiles", () => {
  it("loads and normalizes a page of file metadata", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        files: [
          { repo: "frontend", path: "src/App.tsx", old_path: null, status: "modified", additions: 4, deletions: 1, binary: false },
        ],
        total: 12,
        limit: 100,
        next_cursor: "abc",
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiffFiles("demo", "ABC-1", "branch", { repo: "frontend", q: "App", limit: 50, cursor: "xyz" });

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/files", {
      params: { type: "branch", repo: "frontend", q: "App", limit: 50, cursor: "xyz" },
      signal: undefined,
    });
    expect(result).toEqual({
      files: [
        { repo: "frontend", path: "src/App.tsx", oldPath: null, status: "modified", additions: 4, deletions: 1, binary: false },
      ],
      total: 12,
      limit: 100,
      nextCursor: "abc",
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("omits blank filter params and defaults nullish counters", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: {} });

    const result = await getGitDiffFiles("demo", "ABC-1", "branch");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/files", {
      params: { type: "branch", repo: undefined, q: undefined, limit: undefined, cursor: undefined },
      signal: undefined,
    });
    expect(result).toEqual({ files: [], total: 0, limit: 0, nextCursor: null, workspace: { path: "", available: false } });
  });

  it("loads a thread's file page", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: { files: [], total: 0, limit: 100, next_cursor: null, workspace: { path: "/tmp/thread", available: true } },
    });

    await getThreadGitDiffFiles(42, "uncommitted", { q: "index" });

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff/files", {
      params: { type: "uncommitted", repo: undefined, q: "index", limit: undefined, cursor: undefined },
      signal: undefined,
    });
  });
});

describe("getGitDiffPatch", () => {
  it("loads and normalizes a single file patch", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: { repo: "frontend", path: "src/App.tsx", status: "modified", binary: false, truncated: false, patch: "@@\n+a\n" },
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiffPatch("demo", "ABC-1", "branch", "frontend", "src/App.tsx");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/patch", {
      params: { type: "branch", repo: "frontend", path: "src/App.tsx" },
      signal: undefined,
    });
    expect(result).toEqual({
      repo: "frontend",
      path: "src/App.tsx",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "@@\n+a\n",
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("throws when repo or path is blank", async () => {
    await expect(getGitDiffPatch("demo", "ABC-1", "branch", "", "src/App.tsx")).rejects.toThrow();
    await expect(getGitDiffPatch("demo", "ABC-1", "branch", "frontend", "")).rejects.toThrow();
  });

  it("loads a thread's file patch", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: { repo: "back", path: "docs/index.md", status: "added", binary: false, truncated: false, patch: "@@\n+x\n" },
        workspace: { path: "/tmp/thread", available: true },
      },
    });

    const result = await getThreadGitDiffPatch(42, "uncommitted", "back", "docs/index.md");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff/patch", {
      params: { type: "uncommitted", repo: "back", path: "docs/index.md" },
      signal: undefined,
    });
    expect(result.patch).toBe("@@\n+x\n");
  });
});

describe("getGitDiffSummaries", () => {
  it("loads and normalizes per-repo summaries", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [
          { repo: "frontend", branch: "feat/x", ahead_count: 2, dirty: true },
          { repo: "backend", branch: null, ahead_count: 0, dirty: false },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await getGitDiffSummaries("demo", "ABC-1");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/summaries", {
      signal: undefined,
    });
    expect(result).toEqual({
      summaries: [
        { repo: "frontend", branch: "feat/x", aheadCount: 2, dirty: true },
        { repo: "backend", branch: null, aheadCount: 0, dirty: false },
      ],
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("defaults missing numeric and boolean fields", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: { data: [{ repo: "frontend" }], workspace: { path: "/tmp/ws", available: true } },
    });

    const result = await getGitDiffSummaries("demo", "ABC-1");

    expect(result.summaries[0]).toEqual({
      repo: "frontend",
      branch: null,
      aheadCount: 0,
      dirty: false,
    });
  });

  it("loads a thread's repository summaries", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: [{ repo: "frontend", branch: "feat/x", ahead_count: 2, dirty: true }],
        workspace: { path: "/tmp/thread", available: true },
      },
    });

    const controller = new AbortController();
    const result = await getThreadGitDiffSummaries(42, { signal: controller.signal });

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/diff/summaries", {
      signal: controller.signal,
    });
    expect(result.summaries).toEqual([{ repo: "frontend", branch: "feat/x", aheadCount: 2, dirty: true }]);
  });
});

describe("pushGitDiff", () => {
  it("loads and normalizes push results", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: [
          { repo: "frontend", ok: true },
          { repo: "backend", ok: false, error: "no upstream" },
        ],
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const result = await pushGitDiff("demo", "ABC-1");

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/demo/issues/ABC-1/diff/push", {});
    expect(result).toEqual({
      results: [
        { repo: "frontend", ok: true },
        { repo: "backend", ok: false, error: "no upstream" },
      ],
      workspace: { path: "/tmp/ws", available: true },
    });
  });

  it("returns empty results when nothing is pushable", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { data: [], workspace: { path: "/tmp/ws", available: true } },
    });

    const result = await pushGitDiff("demo", "ABC-1");

    expect(result.results).toEqual([]);
  });
});

describe("generateCommitMessage", () => {
  it("returns the generated commit message", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { data: { message: "feat: add diff summaries" } },
    });

    const result = await generateCommitMessage("demo", "ABC-1");

    expect(http.post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/demo/issues/ABC-1/diff/generate-commit-message",
      {},
    );
    expect(result).toBe("feat: add diff summaries");
  });

  it("returns an empty string when message is missing", async () => {
    vi.mocked(http.post).mockResolvedValue({ data: { data: {} } });

    const result = await generateCommitMessage("demo", "ABC-1");

    expect(result).toBe("");
  });
});
