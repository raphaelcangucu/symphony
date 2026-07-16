import { beforeEach, describe, expect, it, vi } from "vitest";

import { listCommitEvidence } from "@/services/commitEvidence";
import { http } from "@/services/http";

vi.mock("@/services/http", () => ({
  http: { get: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
}));

describe("listCommitEvidence", () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it("maps paginated commits and online status", async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        commits: [
          {
            repo: "advising",
            sha: "abc123",
            short_sha: "abc1234",
            message: "feat: x",
            author: "agent",
            authored_at: "2026-07-16T00:00:00Z",
            files_changed: 1,
            insertions: 2,
            deletions: 0,
            online: true,
          },
        ],
        total: 5,
        limit: 1,
        next_cursor: "MQ",
        workspace: { path: "/tmp/ws", available: true },
      },
    });

    const page = await listCommitEvidence("advising", "CDE-1", { limit: 1 });

    expect(http.get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/advising/issues/CDE-1/commit_evidence?limit=1",
      expect.objectContaining({ signal: undefined }),
    );
    expect(page.total).toBe(5);
    expect(page.nextCursor).toBe("MQ");
    expect(page.commits[0]).toMatchObject({
      shortSha: "abc1234",
      online: true,
    });
  });
});
