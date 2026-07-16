import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureIssueKbPage } from "@/lib/ensureIssueKbPage";
import { getIssuePage, getPage, saveIssuePage } from "@/services/knowledgeBase";

vi.mock("@/services/knowledgeBase", () => ({
  getIssuePage: vi.fn(),
  getPage: vi.fn(),
  saveIssuePage: vi.fn(),
}));

function notFound() {
  return Object.assign(new Error("Request failed with status code 404"), {
    isAxiosError: true,
    response: { status: 404 },
  });
}

describe("ensureIssueKbPage", () => {
  beforeEach(() => {
    vi.mocked(getIssuePage).mockReset();
    vi.mocked(getPage).mockReset();
    vi.mocked(saveIssuePage).mockReset();
  });

  it("returns exists when the issue page is already present", async () => {
    vi.mocked(getIssuePage).mockResolvedValueOnce({
      path: "superpowers/specs/foo.md",
      title: "Foo",
      frontmatter: {},
      body: "# Foo",
      markdown: "# Foo",
    });

    await expect(
      ensureIssueKbPage({
        projectSlug: "gamba",
        issueIdentifier: "GAM-20",
        repoSlug: "frontend",
        path: "superpowers/specs/foo.md",
        markdown: "# Plan",
      }),
    ).resolves.toEqual({ status: "exists", repoSlug: "frontend" });

    expect(saveIssuePage).not.toHaveBeenCalled();
  });

  it("creates the page in the issue worktree when missing everywhere", async () => {
    vi.mocked(getIssuePage).mockRejectedValue(notFound());
    vi.mocked(getPage).mockRejectedValue(notFound());
    vi.mocked(saveIssuePage).mockResolvedValueOnce({
      path: "superpowers/specs/foo.md",
      commit: "workspace",
      pushed: false,
    });

    await expect(
      ensureIssueKbPage({
        projectSlug: "gamba",
        issueIdentifier: "GAM-20",
        repoSlug: "frontend",
        path: "superpowers/specs/foo.md",
        markdown: "# Plan body",
        fallbackRepoSlugs: ["backend"],
      }),
    ).resolves.toEqual({ status: "created", repoSlug: "frontend" });

    expect(saveIssuePage).toHaveBeenCalledWith("gamba", "GAM-20", "frontend", "superpowers/specs/foo.md", {
      frontmatter: {},
      body: "# Plan body",
    });
  });
});
