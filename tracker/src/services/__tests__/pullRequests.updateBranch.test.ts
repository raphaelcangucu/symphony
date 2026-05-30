import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { post: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { normalizePullRequest, updatePullRequestBranch } from "../pullRequests";

describe("updatePullRequestBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts to the update_branch endpoint and returns updated flag", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { updated: true } } });

    const result = await updatePullRequestBranch("macro-markets", "#508", 509);

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/macro-markets/issues/%23508/pull_requests/509/update_branch"),
    );
    expect(result).toEqual({ updated: true });
  });

  it("requires a positive number", async () => {
    await expect(updatePullRequestBranch("macro-markets", "#508", 0)).rejects.toThrow("number is required");
  });
});

describe("normalizePullRequest baseBehindBy", () => {
  it("maps base_behind_by and defaults to null", () => {
    expect(normalizePullRequest({ number: 1, base_behind_by: 2 } as never).baseBehindBy).toBe(2);
    expect(normalizePullRequest({ number: 2 } as never).baseBehindBy).toBeNull();
  });
});
