import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitDiffFiles } from "@/hooks/useGitDiffFiles";
import { getGitDiffFiles } from "@/services/gitDiff";
import type { GitDiffFileEntry, GitDiffFilesPage } from "@/types/gitDiff";

vi.mock("@/services/gitDiff", () => ({ getGitDiffFiles: vi.fn(), getThreadGitDiffFiles: vi.fn() }));

function fileEntry(repo: string, path: string): GitDiffFileEntry {
  return { repo, path, oldPath: null, status: "modified", additions: 1, deletions: 0, binary: false };
}

function page(overrides: Partial<{ files: GitDiffFileEntry[]; total: number; nextCursor: string | null }> = {}): GitDiffFilesPage {
  return {
    files: overrides.files ?? [],
    total: overrides.total ?? 0,
    limit: 100,
    nextCursor: overrides.nextCursor ?? null,
    workspace: { path: "/tmp/ws", available: true },
  };
}

describe("useGitDiffFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the first page and exposes hasMore from the cursor", async () => {
    vi.mocked(getGitDiffFiles).mockResolvedValue(
      page({ files: [fileEntry("frontend", "a.ts")], total: 2, nextCursor: "next" }),
    );

    const { result } = renderHook(() =>
      useGitDiffFiles({ projectSlug: "demo", identifier: "ABC-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitDiffFiles).toHaveBeenCalledWith("demo", "ABC-1", "branch", {
      repo: undefined,
      q: undefined,
      limit: undefined,
      cursor: null,
      signal: expect.any(AbortSignal),
    });
    expect(result.current.files).toEqual([fileEntry("frontend", "a.ts")]);
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(true);
  });

  it("appends the next page and clears hasMore once the cursor is exhausted", async () => {
    vi.mocked(getGitDiffFiles)
      .mockResolvedValueOnce(page({ files: [fileEntry("frontend", "a.ts")], total: 2, nextCursor: "next" }))
      .mockResolvedValueOnce(page({ files: [fileEntry("frontend", "b.ts")], total: 2, nextCursor: null }));

    const { result } = renderHook(() =>
      useGitDiffFiles({ projectSlug: "demo", identifier: "ABC-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await result.current.loadMore();

    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(getGitDiffFiles).toHaveBeenLastCalledWith(
      "demo",
      "ABC-1",
      "branch",
      expect.objectContaining({ cursor: "next" }),
    );
  });

  it("omits the repo filter when scoped to all repos", async () => {
    vi.mocked(getGitDiffFiles).mockResolvedValue(page());

    renderHook(() =>
      useGitDiffFiles({ projectSlug: "demo", identifier: "ABC-1", type: "branch", repo: "all", query: "app" }),
    );

    await waitFor(() =>
      expect(getGitDiffFiles).toHaveBeenCalledWith(
        "demo",
        "ABC-1",
        "branch",
        expect.objectContaining({ repo: undefined, q: "app" }),
      ),
    );
  });

  it("does not fetch when disabled", () => {
    renderHook(() =>
      useGitDiffFiles({ projectSlug: "demo", identifier: "ABC-1", type: "branch", enabled: false }),
    );
    expect(getGitDiffFiles).not.toHaveBeenCalled();
  });
});
