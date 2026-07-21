import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceRepoSummaries } from "@/hooks/useWorkspaceRepoSummaries";
import { getGitDiffSummaries, getThreadGitDiffSummaries } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({
  getGitDiffSummaries: vi.fn(),
  getThreadGitDiffSummaries: vi.fn(),
}));

describe("useWorkspaceRepoSummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers thread summaries when a thread id is provided", async () => {
    vi.mocked(getThreadGitDiffSummaries).mockResolvedValue({
      summaries: [{ repo: "frontend", branch: "feat/thread", aheadCount: 2, dirty: true }],
    });

    const { result } = renderHook(() =>
      useWorkspaceRepoSummaries({
        projectSlug: "demo",
        issueIdentifier: "ABC-1",
        threadId: 42,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getThreadGitDiffSummaries).toHaveBeenCalledWith(42, {
      signal: expect.any(AbortSignal),
    });
    expect(getGitDiffSummaries).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      localBranch: "feat/thread",
      aheadCount: 2,
      dirty: true,
      summaries: [{ repo: "frontend", branch: "feat/thread", aheadCount: 2, dirty: true }],
      loading: false,
      error: null,
    });
  });
});
