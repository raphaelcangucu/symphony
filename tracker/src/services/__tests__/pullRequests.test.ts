import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  trackerPath: (p: string) => `/api/tracker/v1${p}`,
}));

import { http } from "../http";
import { normalizePullRequest, rerunFailedJobs } from "../pullRequests";

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
});
