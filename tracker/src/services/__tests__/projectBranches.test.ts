import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listProjectBranches } from "@/services/projectBranches";

describe("listProjectBranches", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GETs the project branch list and normalizes snake_case", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [{ name: "codex/adv-2", repo: "o/r", protected: false, commit_sha: "bbb" }],
        supported: true,
      },
    });

    const result = await listProjectBranches("advising");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/advising/branches");
    expect(result).toEqual([{ name: "codex/adv-2", repo: "o/r", protected: false, commitSha: "bbb" }]);
  });

  it("passes q when searching branches", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: [
          {
            name: "feature/graphql-go-api-CDE-1075",
            repo: "civitaslearning/advising",
            protected: false,
            commit_sha: "abc",
          },
        ],
        supported: true,
      },
    });

    const result = await listProjectBranches("advising", { query: "feature/graphql" });

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/advising/branches?q=feature%2Fgraphql",
    );
    expect(result).toEqual([
      {
        name: "feature/graphql-go-api-CDE-1075",
        repo: "civitaslearning/advising",
        protected: false,
        commitSha: "abc",
      },
    ]);
  });
});
