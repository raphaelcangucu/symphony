import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { getGitDiffStats, getThreadGitDiffStats } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({ getGitDiffStats: vi.fn(), getThreadGitDiffStats: vi.fn() }));

describe("useWorkspaceDiffStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums additions/deletions across repos from the stats endpoint", async () => {
    vi.mocked(getGitDiffStats).mockResolvedValue({
      stats: [
        { repo: "frontend", branch: null, base: null, filesChanged: 1, additions: 3, deletions: 1, untracked: 0 },
        { repo: "backend", branch: null, base: null, filesChanged: 1, additions: 2, deletions: 0, untracked: 0 },
      ],
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result } = renderHook(() =>
      useWorkspaceDiffStats({ projectSlug: "demo", issueIdentifier: "ABC-1" }),
    );

    await waitFor(() => expect(result.current).toEqual({ additions: 5, deletions: 1 }));
    expect(getGitDiffStats).toHaveBeenCalledWith("demo", "ABC-1", "uncommitted", { signal: expect.any(AbortSignal) });
  });

  it("returns null when there are no changes", async () => {
    vi.mocked(getGitDiffStats).mockResolvedValue({ stats: [], workspace: { path: "/tmp/ws", available: true } });

    const { result } = renderHook(() =>
      useWorkspaceDiffStats({ projectSlug: "demo", issueIdentifier: "ABC-1" }),
    );

    await waitFor(() => expect(getGitDiffStats).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("uses the thread stats endpoint when a threadId is given", async () => {
    vi.mocked(getThreadGitDiffStats).mockResolvedValue({
      stats: [{ repo: "frontend", branch: null, base: null, filesChanged: 1, additions: 1, deletions: 0, untracked: 0 }],
      workspace: { path: "/tmp/thread", available: true },
    });

    const { result } = renderHook(() => useWorkspaceDiffStats({ threadId: 42 }));

    await waitFor(() => expect(result.current).toEqual({ additions: 1, deletions: 0 }));
    expect(getThreadGitDiffStats).toHaveBeenCalledWith(42, "uncommitted", { signal: expect.any(AbortSignal) });
  });

  it("uses the issue stats endpoint when both issue and thread identifiers are present", async () => {
    vi.mocked(getGitDiffStats).mockResolvedValue({
      stats: [{ repo: "frontend", branch: null, base: null, filesChanged: 1, additions: 7, deletions: 2, untracked: 0 }],
      workspace: { path: "/tmp/issue", available: true },
    });

    const { result } = renderHook(() =>
      useWorkspaceDiffStats({
        projectSlug: "macro-markets",
        issueIdentifier: "510",
        threadId: 7996,
      }),
    );

    await waitFor(() => expect(result.current).toEqual({ additions: 7, deletions: 2 }));
    expect(getGitDiffStats).toHaveBeenCalledWith("macro-markets", "510", "uncommitted", {
      signal: expect.any(AbortSignal),
    });
    expect(getThreadGitDiffStats).not.toHaveBeenCalled();
  });

  it("does not fetch when disabled or missing identifiers", () => {
    renderHook(() => useWorkspaceDiffStats({ enabled: false, projectSlug: "demo", issueIdentifier: "ABC-1" }));
    renderHook(() => useWorkspaceDiffStats({}));

    expect(getGitDiffStats).not.toHaveBeenCalled();
    expect(getThreadGitDiffStats).not.toHaveBeenCalled();
  });
});
