import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { post: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { mergePullRequest, normalizePullRequest, updatePullRequestBranch } from "../pullRequests";

describe("updatePullRequestBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts to the update_branch endpoint and returns updated flag", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { updated: true } } });

    const result = await updatePullRequestBranch("macro-markets", "508", 509);

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/macro-markets/issues/508/pull_requests/509/update_branch"),
    );
    expect(result).toEqual({ updated: true });
  });

  it("requires a positive number", async () => {
    await expect(updatePullRequestBranch("macro-markets", "508", 0)).rejects.toThrow("number is required");
  });
});

describe("mergePullRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts to the merge endpoint with method and force intent", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { merged: true, method: "squash", bypass: true, issue: null } },
    });

    const result = await mergePullRequest("macro-markets", "508", 509, { method: "squash", bypass: true });

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/macro-markets/issues/508/pull_requests/509/merge"),
      { method: "squash", bypass: true },
    );
    expect(result).toEqual({ merged: true, method: "squash", bypass: true, issue: null });
  });

  it("requires a positive number", async () => {
    await expect(mergePullRequest("macro-markets", "508", 0, { method: "merge" })).rejects.toThrow(
      "number is required",
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it("requires project and issue identifiers", async () => {
    await expect(mergePullRequest("", "508", 509, { method: "merge" })).rejects.toThrow("projectSlug is required");
    await expect(mergePullRequest("macro-markets", "", 509, { method: "merge" })).rejects.toThrow(
      "identifier is required",
    );
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe("normalizePullRequest baseBehindBy", () => {
  it("maps base_behind_by and defaults to null", () => {
    expect(normalizePullRequest({ number: 1, base_behind_by: 2 } as never).baseBehindBy).toBe(2);
    expect(normalizePullRequest({ number: 2 } as never).baseBehindBy).toBeNull();
  });
});
