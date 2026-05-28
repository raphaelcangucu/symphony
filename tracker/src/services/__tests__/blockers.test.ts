import { describe, expect, it, vi } from "vitest";

import { createBlocker } from "@/services/blockers";
import { http } from "@/services/http";

describe("blocker services", () => {
  it("posts the backend blocker contract and normalizes the response", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 789,
          type: "blocked_by",
          source_identifier: "MAC-1",
          target_identifier: "MAC-2",
          inserted_at: "2026-05-27T04:00:00Z",
        },
      },
    });

    const blocker = await createBlocker("macro-markets", "MAC-1", {
      blockingIssueIdentifier: "MAC-2",
      type: "blocked_by",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers", {
      target_identifier: "MAC-2",
      type: "blocked_by",
    });
    expect(blocker.blockingIssueIdentifier).toBe("MAC-2");
    expect(blocker.state).toBe("open");
  });
});
