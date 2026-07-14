import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitDiffPatch } from "@/hooks/useGitDiffPatch";
import { getGitDiffPatch, getThreadGitDiffPatch } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({ getGitDiffPatch: vi.fn(), getThreadGitDiffPatch: vi.fn() }));

describe("useGitDiffPatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches exactly one file's patch when repo/path are set", async () => {
    vi.mocked(getGitDiffPatch).mockResolvedValue({
      repo: "frontend",
      path: "src/App.tsx",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "@@\n+a\n",
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiffPatch({
        projectSlug: "demo",
        identifier: "ABC-1",
        type: "branch",
        repo: "frontend",
        path: "src/App.tsx",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitDiffPatch).toHaveBeenCalledWith("demo", "ABC-1", "branch", "frontend", "src/App.tsx", {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.file).toEqual({ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@\n+a\n" });
  });

  it("does not fetch when no file is selected", () => {
    renderHook(() =>
      useGitDiffPatch({ projectSlug: "demo", identifier: "ABC-1", type: "branch", repo: null, path: null }),
    );

    expect(getGitDiffPatch).not.toHaveBeenCalled();
  });

  it("uses the thread patch endpoint when a threadId is given", async () => {
    vi.mocked(getThreadGitDiffPatch).mockResolvedValue({
      repo: "back",
      path: "docs/index.md",
      status: "added",
      binary: false,
      truncated: false,
      patch: "@@\n+x\n",
      workspace: { path: "/tmp/thread", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiffPatch({
        projectSlug: "",
        identifier: null,
        threadId: 42,
        type: "uncommitted",
        repo: "back",
        path: "docs/index.md",
      }),
    );

    await waitFor(() => expect(result.current.file?.patch).toBe("@@\n+x\n"));
    expect(getThreadGitDiffPatch).toHaveBeenCalledWith(42, "uncommitted", "back", "docs/index.md", {
      signal: expect.any(AbortSignal),
    });
  });

  it("clears the file when the path changes to null", async () => {
    vi.mocked(getGitDiffPatch).mockResolvedValue({
      repo: "frontend",
      path: "src/App.tsx",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "@@\n+a\n",
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result, rerender } = renderHook<ReturnType<typeof useGitDiffPatch>, { repo: string | null; path: string | null }>(
      (props) => useGitDiffPatch({ projectSlug: "demo", identifier: "ABC-1", type: "branch", ...props }),
      { initialProps: { repo: "frontend", path: "src/App.tsx" } },
    );

    await waitFor(() => expect(result.current.file).not.toBeNull());

    rerender({ repo: null, path: null });
    expect(result.current.file).toBeNull();
  });
});
