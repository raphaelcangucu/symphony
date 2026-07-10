import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueChangedDocPaths } from "@/hooks/useIssueChangedDocPaths";
import { getGitDiff } from "@/services/gitDiff";

vi.mock("@/services/gitDiff", () => ({
  getGitDiff: vi.fn(),
}));

const getGitDiffMock = vi.mocked(getGitDiff);

describe("useIssueChangedDocPaths", () => {
  beforeEach(() => {
    getGitDiffMock.mockReset();
  });

  it("loads docs-relative changed paths from the uncommitted issue diff", async () => {
    getGitDiffMock.mockResolvedValue({
      workspace: { path: "/tmp", available: true },
      repos: [
        {
          repo: "front",
          files: [
            {
              path: "docs/superpowers/specs/a.md",
              oldPath: null,
              status: "added",
              patch: "",
            },
            {
              path: "lib/x.ts",
              oldPath: null,
              status: "modified",
              patch: "",
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() =>
      useIssueChangedDocPaths({
        projectSlug: "macro-markets",
        issueIdentifier: "510",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitDiffMock).toHaveBeenCalledWith("macro-markets", "510", "uncommitted");
    expect(result.current.paths).toEqual(["superpowers/specs/a.md"]);
    expect(result.current.count).toBe(1);
  });

  it("stays empty when disabled or missing identifier", async () => {
    const { result } = renderHook(() =>
      useIssueChangedDocPaths({
        projectSlug: "macro-markets",
        issueIdentifier: null,
      }),
    );

    expect(result.current.paths).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(getGitDiffMock).not.toHaveBeenCalled();
  });

  it("reloads when refreshKey changes", async () => {
    getGitDiffMock.mockResolvedValue({
      workspace: { path: "/tmp", available: true },
      repos: [],
    });

    const { rerender } = renderHook(
      ({ refreshKey }) =>
        useIssueChangedDocPaths({
          projectSlug: "macro-markets",
          issueIdentifier: "510",
          refreshKey,
        }),
      { initialProps: { refreshKey: 0 } },
    );

    await waitFor(() => expect(getGitDiffMock).toHaveBeenCalledTimes(1));
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(getGitDiffMock).toHaveBeenCalledTimes(2));
  });
});
