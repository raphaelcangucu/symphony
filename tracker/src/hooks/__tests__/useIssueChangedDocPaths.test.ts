import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueChangedDocPaths } from "@/hooks/useIssueChangedDocPaths";
import { getIssueRepoTree, getProjectOverview } from "@/services/knowledgeBase";

vi.mock("@/services/knowledgeBase", () => ({
  getProjectOverview: vi.fn(),
  getIssueRepoTree: vi.fn(),
}));

const getProjectOverviewMock = vi.mocked(getProjectOverview);
const getIssueRepoTreeMock = vi.mocked(getIssueRepoTree);

describe("useIssueChangedDocPaths", () => {
  beforeEach(() => {
    getProjectOverviewMock.mockReset();
    getIssueRepoTreeMock.mockReset();
  });

  it("loads docs-relative changed paths from the issue KB trees", async () => {
    getProjectOverviewMock.mockResolvedValue({
      project: { slug: "macro-markets", name: "Macro Markets" },
      repositories: [
        {
          repoSlug: "back",
          workspacePath: "back",
          githubFullName: "clouapp/back",
          defaultBranch: "main",
          role: "backend",
          docsPresent: true,
        },
        {
          repoSlug: "front",
          workspacePath: "front",
          githubFullName: "clouapp/front",
          defaultBranch: "main",
          role: "frontend",
          docsPresent: true,
        },
      ],
    });
    getIssueRepoTreeMock.mockImplementation(async (_project, _issue, repoSlug) => {
      if (repoSlug === "back") {
        return {
          repository: {
            repoSlug: "back",
            workspacePath: "back",
            githubFullName: "clouapp/back",
            defaultBranch: "main",
            role: "backend",
            docsPresent: true,
          },
          docsPresent: true,
          tree: [
            {
              type: "folder",
              name: "superpowers",
              path: "superpowers",
              title: "superpowers",
              order: null,
              favorite: false,
              children: [
                {
                  type: "page",
                  name: "a.md",
                  path: "superpowers/specs/a.md",
                  title: "A",
                  order: null,
                  favorite: false,
                  children: [],
                },
              ],
            },
          ],
        };
      }
      return {
        repository: {
          repoSlug: "front",
          workspacePath: "front",
          githubFullName: "clouapp/front",
          defaultBranch: "main",
          role: "frontend",
          docsPresent: true,
        },
        docsPresent: true,
        tree: [],
      };
    });

    const { result } = renderHook(() =>
      useIssueChangedDocPaths({
        projectSlug: "macro-markets",
        issueIdentifier: "510",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getProjectOverviewMock).toHaveBeenCalledWith("macro-markets");
    expect(getIssueRepoTreeMock).toHaveBeenCalledWith("macro-markets", "510", "back");
    expect(getIssueRepoTreeMock).toHaveBeenCalledWith("macro-markets", "510", "front");
    expect(result.current.entries).toEqual([{ repo: "back", path: "superpowers/specs/a.md" }]);
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
    expect(result.current.entries).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(getProjectOverviewMock).not.toHaveBeenCalled();
  });

  it("reloads when refreshKey changes", async () => {
    getProjectOverviewMock.mockResolvedValue({
      project: { slug: "macro-markets", name: "Macro Markets" },
      repositories: [
        {
          repoSlug: "back",
          workspacePath: "back",
          githubFullName: "clouapp/back",
          defaultBranch: "main",
          role: "backend",
          docsPresent: true,
        },
      ],
    });
    getIssueRepoTreeMock.mockResolvedValue({
      repository: {
        repoSlug: "back",
        workspacePath: "back",
        githubFullName: "clouapp/back",
        defaultBranch: "main",
        role: "backend",
        docsPresent: true,
      },
      docsPresent: true,
      tree: [],
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

    await waitFor(() => expect(getIssueRepoTreeMock).toHaveBeenCalledTimes(1));
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(getIssueRepoTreeMock).toHaveBeenCalledTimes(2));
  });
});
