import { describe, expect, it } from "vitest";

import {
  authoringGoalPhase,
  emptyAuthoringGoal,
  mergeGoalStatus,
} from "@/components/assistant/authoringGoalState";
import { normalizeGoalStatus } from "@/services/phoenix/assistantChannel";

describe("AuthoringGoalState canonical contract", () => {
  it("maps lifecycle, provider, capabilities, revision, and request ordering", () => {
    const state = mergeGoalStatus(
      emptyAuthoringGoal,
      normalizeGoalStatus({
        thread_id: 41,
        enabled: true,
        objective: "Ship Goal Mode",
        native: true,
        status: "in_progress",
        provider: "claude",
        source: "claude",
        capabilities: ["pause", "resume", "pause", " ", "clear"],
        token_budget: 200_000,
        tokens_used: 4_200,
        time_used_seconds: 73,
        process_running: true,
        process_started_at: "2026-07-13T12:00:00Z",
        process_elapsed_seconds: 74,
        resumable: false,
        interrupted: false,
        revision: "17",
        request_order: 29,
        event_order: 28,
        updated_at: "2026-07-13T12:01:14Z",
      }),
    );

    expect(state).toMatchObject({
      enabled: true,
      objective: "Ship Goal Mode",
      native: true,
      lifecycle: "running",
      provider: "claude",
      source: "claude",
      capabilities: ["pause", "resume", "clear"],
      tokenBudget: 200_000,
      tokensUsed: 4_200,
      timeUsedSeconds: 73,
      processRunning: true,
      revision: "17",
      requestOrder: 29,
      eventOrder: 28,
    });
    expect(authoringGoalPhase(state)).toBe("running");
  });

  it.each([
    ["queued", "starting"],
    ["active", "running"],
    ["interrupted", "paused"],
    ["satisfied", "completed"],
    ["waiting", "blocked"],
    ["error", "failed"],
    ["budget_exceeded", "budgetLimited"],
    ["rate_limited", "usageLimited"],
  ] as const)("normalizes %s to the canonical %s lifecycle", (status, lifecycle) => {
    const state = mergeGoalStatus(
      emptyAuthoringGoal,
      normalizeGoalStatus({ enabled: true, status, process_running: false }),
    );

    expect(state.lifecycle).toBe(lifecycle);
  });

  it("falls back to nested goal provider, capabilities, revision, and timing", () => {
    const state = mergeGoalStatus(
      emptyAuthoringGoal,
      normalizeGoalStatus({
        enabled: true,
        goal: {
          kind: "goal",
          source: "native",
          objective: "Audit",
          status: "paused",
          capabilities: ["edit", "resume"],
          time_used_seconds: 12,
          revision: "9",
        },
      }),
    );

    expect(state).toMatchObject({
      objective: "Audit",
      lifecycle: "paused",
      provider: "codex",
      capabilities: ["edit", "resume"],
      timeUsedSeconds: 12,
      revision: "9",
    });
    expect(authoringGoalPhase(state)).toBe("paused");
  });
});
