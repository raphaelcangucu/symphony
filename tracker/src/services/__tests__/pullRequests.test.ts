import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { listPullRequests, normalizePullRequest, rerunFailedJobs } from "../pullRequests";

describe("normalizePullRequest monitor payload", () => {
  it("maps monitor info when present", () => {
    const pr = normalizePullRequest({
      number: 7,
      monitor: {
        last_action: "moved_to_rework",
        summary: "login test broke",
        auto_rework_count: 1,
        last_action_at: "2026-06-10T12:00:00Z",
      },
    } as never);

    expect(pr.monitor).toEqual({
      lastAction: "moved_to_rework",
      summary: "login test broke",
      autoReworkCount: 1,
      lastActionAt: "2026-06-10T12:00:00Z",
    });
  });

  it("defaults monitor to null", () => {
    expect(normalizePullRequest({ number: 7 } as never).monitor).toBeNull();
  });
});

describe("listPullRequests children", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes sub-issue PR groups and drops empty ones", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: [{ number: 1, repo: "owner/back" }],
        supported: true,
        available: true,
        children: [
          {
            identifier: "front#541",
            title: "Child A",
            pull_requests: [{ number: 549, repo: "owner/front" }],
          },
          { identifier: "front#542", title: "Child B", pull_requests: [] },
          { identifier: "", title: null, pull_requests: [{ number: 7, repo: "owner/back" }] },
        ],
      },
    });

    const result = await listPullRequests("macro-markets", "back#287");

    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ identifier: "front#541", title: "Child A" });
    expect(result.children[0].pullRequests[0].number).toBe(549);
  });

  it("defaults children to an empty array when absent", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [], supported: true, available: true },
    });

    const result = await listPullRequests("macro-markets", "back#287");

    expect(result.children).toEqual([]);
  });
});

describe("rerunFailedJobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs to the rerun endpoint and returns rerun results", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { reruns: [{ run_id: 99, ok: true }] } },
    });

    const result = await rerunFailedJobs("proj", "#42", 7);

    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/projects/proj/issues/42/pull_requests/7/rerun_failed"),
    );
    expect(result).toEqual([{ runId: 99, ok: true }]);
  });

  it("requires project and issue identifiers", async () => {
    await expect(rerunFailedJobs("", "508", 7)).rejects.toThrow("projectSlug is required");
    await expect(rerunFailedJobs("macro-markets", "", 7)).rejects.toThrow("identifier is required");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("requires a positive number", async () => {
    await expect(rerunFailedJobs("macro-markets", "508", 0)).rejects.toThrow("number is required");
    expect(http.post).not.toHaveBeenCalled();
  });
});
