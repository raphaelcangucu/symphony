import { describe, expect, it } from "vitest";

import {
  canResumeExecution,
  reconcileExecutionStatus,
  resolveDisplayStatus,
} from "@/lib/agentExecutionDisplay";
import type { AgentExecution } from "@/types/agent-execution";

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "CDE-1132",
    status: "idle",
    agentKind: "codex",
    sessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: null,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: null,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
    ...overrides,
  };
}

describe("agentExecutionDisplay", () => {
  it("upgrades idle runs with abort signals to aborted", () => {
    const raw = execution({
      status: "idle",
      lastEvent: "turn_aborted",
      error: "Agent run interrupted — use Resume in the execution panel",
    });

    expect(resolveDisplayStatus(raw)).toBe("aborted");
    expect(canResumeExecution(raw)).toBe(true);
    expect(reconcileExecutionStatus(raw).status).toBe("aborted");
  });

  it("keeps live runs active and not resumable", () => {
    const raw = execution({ status: "live", lastEvent: "notification" });

    expect(resolveDisplayStatus(raw)).toBe("live");
    expect(canResumeExecution(raw)).toBe(false);
  });
});
