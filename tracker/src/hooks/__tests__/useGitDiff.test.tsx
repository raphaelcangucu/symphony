import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitDiff } from "@/hooks/useGitDiff";
import { getGitDiff, getThreadGitDiff } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({ getGitDiff: vi.fn(), getThreadGitDiff: vi.fn() }));

describe("useGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads git diff data when enabled", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({
      repos: [{ repo: "frontend", files: [] }],
      workspace: { path: "/tmp/ws", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiff({ projectSlug: "demo", identifier: "ABC-1", type: "branch" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitDiff).toHaveBeenCalledWith("demo", "ABC-1", "branch");
    expect(result.current.repos).toEqual([{ repo: "frontend", files: [] }]);
  });

  it("does not load while disabled", () => {
    renderHook(() => useGitDiff({ projectSlug: "demo", identifier: "ABC-1", type: "branch", enabled: false }));
    expect(getGitDiff).not.toHaveBeenCalled();
  });

  it("loads thread workspace diffs by thread id", async () => {
    vi.mocked(getThreadGitDiff).mockResolvedValue({
      repos: [{ repo: "frontend", files: [] }],
      workspace: { path: "/tmp/thread", available: true },
    });

    const { result } = renderHook(() =>
      useGitDiff({ projectSlug: "", identifier: null, threadId: 42, type: "uncommitted" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getThreadGitDiff).toHaveBeenCalledWith(42, "uncommitted");
    expect(result.current.workspace).toEqual({ path: "/tmp/thread", available: true });
  });
});
