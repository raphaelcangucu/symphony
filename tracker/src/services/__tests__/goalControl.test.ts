import { describe, expect, it, vi } from "vitest";

import { controlIssueGoal } from "@/services/goalControl";
import { http } from "@/services/http";

describe("controlIssueGoal", () => {
  it("pauses a goal and normalizes the returned native goal", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          action: "pause",
          goal: {
            kind: "goal",
            source: "native",
            objective: "Ship the migration",
            status: "paused",
            capabilities: ["get", "edit", "pause", "resume", "clear"],
            token_budget: 200000,
            tokens_used: 1200,
          },
        },
      },
    });

    const result = await controlIssueGoal("macro-markets", "MAC-1", { action: "pause" });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/goal", {
      action: "pause",
    });
    expect(result.goal?.status).toBe("paused");
    expect(result.goal?.tokenBudget).toBe(200000);
    expect(result.cleared).toBe(false);
  });

  it("sends the objective for set_objective", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { action: "set_objective", goal: { kind: "goal", source: "native", status: "active" } } },
    });

    await controlIssueGoal("macro-markets", "MAC-1", {
      action: "set_objective",
      objective: "  Finish the rollout  ",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/goal", {
      action: "set_objective",
      objective: "Finish the rollout",
    });
  });

  it("sends a null token budget to remove the cap", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { action: "set_budget", goal: { kind: "goal", source: "native", status: "active" } } },
    });

    await controlIssueGoal("macro-markets", "MAC-1", { action: "set_budget", tokenBudget: null });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/goal", {
      action: "set_budget",
      token_budget: null,
    });
  });

  it("reports cleared when the goal is removed", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { action: "clear", cleared: true, goal: null } },
    });

    const result = await controlIssueGoal("macro-markets", "MAC-1", { action: "clear" });

    expect(result.cleared).toBe(true);
    expect(result.goal).toBeNull();
  });
});
