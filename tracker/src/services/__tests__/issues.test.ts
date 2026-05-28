import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listIssues } from "@/services/issues";

describe("issues service filters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the issues endpoint without params when filters omitted", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues");
  });

  it("forwards search, assignee, and creator filters", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "login ui", assignee: "me", creator: "octocat" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { q: "login ui", assignee: "me", creator: "octocat" },
    });
  });

  it("omits empty filter values", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: [] } });

    await listIssues("macro-markets", { search: "", assignee: "alice" });

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues", {
      params: { assignee: "alice" },
    });
  });
});
