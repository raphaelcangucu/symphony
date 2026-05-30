import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { post: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { requestPullRequestFix } from "../pullRequests";

describe("requestPullRequestFix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs to the fix endpoint and normalizes the result", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { moved_to: "Rework", comment_posted: true, jobs: [{ name: "vitest", conclusion: "FAILURE", url: "u" }] } },
    });

    const result = await requestPullRequestFix("proj", "509");

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/proj/issues/509/pull_requests/fix");
    expect(result).toEqual({
      movedTo: "Rework",
      commentPosted: true,
      jobs: [{ name: "vitest", conclusion: "FAILURE", url: "u" }],
    });
  });
});
