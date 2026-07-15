import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listProjectPullRequests } from "@/services/projectPullRequests";

describe("listProjectPullRequests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs the project PR list and normalizes snake_case", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            number: 9,
            title: "Add cache",
            url: "https://github.com/o/r/pull/9",
            repo: "o/r",
            author: "octocat",
            updated_at: "2026-06-21T09:00:00Z",
            issue_identifier: "ADV-2",
          },
        ],
        supported: true,
      },
    });

    const result = await listProjectPullRequests("advising");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/advising/pull_requests");
    expect(result).toEqual([
      {
        number: 9,
        title: "Add cache",
        url: "https://github.com/o/r/pull/9",
        repo: "o/r",
        author: "octocat",
        updatedAt: "2026-06-21T09:00:00Z",
        issueIdentifier: "ADV-2",
      },
    ]);
  });

  it("returns [] when the backend reports unsupported", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [], supported: false } });
    expect(await listProjectPullRequests("local")).toEqual([]);
  });

  it("passes q when searching open PRs", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            number: 9174,
            title: "GraphQL",
            url: "https://github.com/o/r/pull/9174",
            repo: "o/r",
            author: "dev",
            updated_at: "2026-07-14T10:00:00Z",
            issue_identifier: null,
          },
        ],
        supported: true,
      },
    });

    const result = await listProjectPullRequests("advising", { search: "9174" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/advising/pull_requests", {
      params: { q: "9174" },
    });
    expect(result[0]?.number).toBe(9174);
  });
});
