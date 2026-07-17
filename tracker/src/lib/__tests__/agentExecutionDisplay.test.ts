import { describe, expect, it } from "vitest";

import {
  agentEnterHintLabel,
  canResumeExecution,
  deriveAgentControl,
  goalStatusLabel,
  isGoalNotLoaded,
  longRunningBadgeText,
  reconcileExecutionStatus,
  resolveDisplayStatus,
} from "@/lib/agentExecutionDisplay";
import type { AgentExecution, AgentExecutionGoal } from "@/types/agent-execution";

function goal(overrides: Partial<AgentExecutionGoal> = {}): AgentExecutionGoal {
  return {
    kind: "goal",
    source: "native",
    objective: "Ship the migration",
    status: "active",
    capabilities: ["get", "edit", "pause", "resume", "clear"],
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    updatedAt: null,
    ...overrides,
  };
}

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "CDE-1132",
    status: "idle",
    agentKind: "codex",
    sessionId: null,
    executionSessionId: null,
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

  it("keeps operator-paused runs paused even with lingering abort signals", () => {
    const raw = execution({
      status: "paused",
      lastEvent: "turn_aborted",
      error: "Turn aborted",
    });

    expect(resolveDisplayStatus(raw)).toBe("paused");
    expect(reconcileExecutionStatus(raw).status).toBe("paused");
    expect(canResumeExecution(raw)).toBe(true);
  });
});

describe("deriveAgentControl", () => {
  it("treats a missing execution as a fresh start", () => {
    const control = deriveAgentControl(undefined);

    expect(control.state).toBe("no-run");
    expect(control.hasRun).toBe(false);
    expect(control.canPause).toBe(false);
    expect(control.canResume).toBe(true);
    expect(control.primaryAction).toBe("start");
    expect(control.primaryLabel).toBe("Start");
    expect(control.enterIntent).toBe("start");
  });

  it("lets a live run be paused and steered", () => {
    const control = deriveAgentControl(execution({ status: "live" }));

    expect(control.state).toBe("running");
    expect(control.isActive).toBe(true);
    expect(control.canSteer).toBe(true);
    expect(control.canPause).toBe(true);
    expect(control.canResume).toBe(false);
    expect(control.primaryAction).toBe("pause");
    expect(control.primaryLabel).toBe("Pause");
    expect(control.enterIntent).toBe("steer");
  });

  it("queues guidance for an active but non-steerable (idle) run", () => {
    const control = deriveAgentControl(execution({ status: "idle" }));

    expect(control.isActive).toBe(true);
    expect(control.canSteer).toBe(false);
    expect(control.canPause).toBe(true);
    expect(control.enterIntent).toBe("queue");
  });

  it("offers resume for an aborted run", () => {
    const control = deriveAgentControl(
      execution({ status: "idle", lastEvent: "turn_aborted", error: "interrupted" }),
    );

    expect(control.state).toBe("aborted");
    expect(control.isActive).toBe(false);
    expect(control.canResume).toBe(true);
    expect(control.primaryAction).toBe("resume");
    expect(control.primaryLabel).toBe("Resume");
    expect(control.enterIntent).toBe("resume");
  });

  it("offers resume for a paused run without treating it as active", () => {
    const control = deriveAgentControl(execution({ status: "paused", lastEvent: "turn_paused" }));

    expect(control.state).toBe("paused");
    expect(control.isActive).toBe(false);
    expect(control.canSteer).toBe(false);
    expect(control.canPause).toBe(false);
    expect(control.canResume).toBe(true);
    expect(control.primaryAction).toBe("resume");
    expect(control.enterIntent).toBe("resume");
  });

  it("maps Enter intents to readable hints", () => {
    expect(agentEnterHintLabel("steer")).toMatch(/steer/i);
    expect(agentEnterHintLabel("queue")).toMatch(/queue/i);
    expect(agentEnterHintLabel("resume")).toMatch(/resume/i);
    expect(agentEnterHintLabel("start")).toMatch(/start/i);
  });

  it("treats a saved (not-loaded) goal as resumable, not active", () => {
    const control = deriveAgentControl(
      execution({ status: "saved", longRunning: true, goal: goal({ status: "not_loaded" }) }),
    );

    expect(control.state).toBe("saved");
    expect(control.isActive).toBe(false);
    expect(control.canResume).toBe(true);
    expect(control.canPause).toBe(false);
    expect(control.primaryAction).toBe("resume");
  });
});

describe("goal status display", () => {
  it("humanizes known native goal statuses", () => {
    expect(goalStatusLabel("paused")).toBe("Paused");
    expect(goalStatusLabel("budgetLimited")).toBe("Budget limited");
    expect(goalStatusLabel("not_loaded")).toBe("Not loaded");
  });

  it("falls back to the raw status for unknown values", () => {
    expect(goalStatusLabel("brand_new_status")).toBe("brand_new_status");
    expect(goalStatusLabel(null)).toBeNull();
  });

  it("detects a not-loaded goal from status or run state", () => {
    expect(isGoalNotLoaded(execution({ status: "saved" }))).toBe(true);
    expect(isGoalNotLoaded(execution({ goal: goal({ status: "not_loaded" }) }))).toBe(true);
    expect(isGoalNotLoaded(execution({ status: "live", goal: goal({ status: "active" }) }))).toBe(false);
  });

  it("appends a humanized status to the long-running badge for non-active goals", () => {
    const text = longRunningBadgeText(
      execution({ longRunning: true, longRunningLabel: "Pursuing goal", goal: goal({ status: "paused" }) }),
    );
    expect(text).toBe("Pursuing goal · Paused");
  });

  it("omits the suffix when the goal is active", () => {
    const text = longRunningBadgeText(
      execution({ longRunning: true, longRunningLabel: "Pursuing goal", goal: goal({ status: "active" }) }),
    );
    expect(text).toBe("Pursuing goal");
  });
});
