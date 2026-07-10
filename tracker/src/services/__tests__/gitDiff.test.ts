import { describe, expect, it, vi } from "vitest";

import { commitGitDiff, commitThreadGitDiff, getGitDiff, getThreadGitDiff } from "@/services/gitDiff";
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
