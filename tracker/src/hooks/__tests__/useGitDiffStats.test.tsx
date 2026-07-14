import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitDiffStats } from "@/hooks/useGitDiffStats";
import { getGitDiffStats, getThreadGitDiffStats } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({ getGitDiffStats: vi.fn(), getThreadGitDiffStats: vi.fn() }));

describe("useGitDiffStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads per-repo stats and workspace info", async () => {
    vi.mocked(getGitDiffStats).mockResolvedValue({
      stats: [{ repo: "frontend", branch: "feat/x", base: "main", filesChanged: 2, additions: 5, deletions: 1, untracked: 0 }],
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiffStats({ projectSlug: "demo", identifier: "ABC-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitDiffStats).toHaveBeenCalledWith("demo", "ABC-1", "branch", { signal: expect.any(AbortSignal) });
    expect(result.current.stats).toEqual([
      { repo: "frontend", branch: "feat/x", base: "main", filesChanged: 2, additions: 5, deletions: 1, untracked: 0 },
    ]);
    expect(result.current.workspace).toEqual({ path: "/tmp/ws", available: true });
  });

  it("sets an error message when the request fails", async () => {
    vi.mocked(getGitDiffStats).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() =>
      useGitDiffStats({ projectSlug: "demo", identifier: "ABC-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.stats).toEqual([]);
  });

  it("does not fetch while disabled", () => {
    renderHook(() =>
      useGitDiffStats({ projectSlug: "demo", identifier: "ABC-1", type: "branch", enabled: false }),
    );
    expect(getGitDiffStats).not.toHaveBeenCalled();
  });

  it("uses the thread stats endpoint when a threadId is given", async () => {
    vi.mocked(getThreadGitDiffStats).mockResolvedValue({
      stats: [],
      workspace: { path: "/tmp/thread", available: true },
    });

    renderHook(() => useGitDiffStats({ projectSlug: "", identifier: null, threadId: 42, type: "uncommitted" }));

    await waitFor(() => expect(getThreadGitDiffStats).toHaveBeenCalledWith(42, "uncommitted", { signal: expect.any(AbortSignal) }));
  });
});
