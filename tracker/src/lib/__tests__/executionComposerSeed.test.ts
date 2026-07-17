import { describe, expect, it } from "vitest";

import { resolveExecutionComposerSeed } from "@/lib/executionComposerSeed";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "GAM-20",
    title: "Task",
    status: "Todo",
    priority: 0,
    assignee: null,
    projectSlug: "gamba",
    blockedBy: [],
    labels: [],
    agentKind: "codex",
    model: "gpt-5.5",
    effort: "low",
    ...overrides,
  } as Issue;
}

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    issueIdentifier: "GAM-20",
    status: "live",
    agentKind: "cursor",
    model: "composer-1",
    sessionId: "sess-1",
    executionSessionId: null,
    lastEvent: "turn_started",
    lastMessage: "working",
    lastEventAt: null,
    turnCount: 1,
    runtimeSeconds: 30,
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

describe("resolveExecutionComposerSeed", () => {
  it("mirrors live execution agent and model over issue pins", () => {
    expect(resolveExecutionComposerSeed(execution(), issue(), "codex")).toEqual({
      agent: "cursor",
      model: "composer-1",
      effort: "low",
      mirrored: true,
      remountKey: "live:sess-1:cursor:composer-1",
    });
  });

  it("mirrors idle/waiting/retrying runs that still own a session agent", () => {
    for (const status of ["idle", "waiting", "retrying"] as const) {
      expect(
        resolveExecutionComposerSeed(execution({ status, model: null }), issue({ effort: null }), "codex"),
      ).toMatchObject({
        agent: "cursor",
        mirrored: true,
      });
    }
  });

  it("falls back to issue pins when the run is finished or missing", () => {
    expect(
      resolveExecutionComposerSeed(execution({ status: "aborted", agentKind: "cursor" }), issue(), "codex"),
    ).toEqual({
      agent: "codex",
      model: "gpt-5.5",
      effort: "low",
      mirrored: false,
      remountKey: "pins",
    });

    expect(resolveExecutionComposerSeed(undefined, issue({ agentKind: null, model: null, effort: null }), "claude")).toEqual({
      agent: "claude",
      model: null,
      effort: null,
      mirrored: false,
      remountKey: "pins",
    });
  });

  it("keeps issue effort when mirroring and fills model from execution when present", () => {
    expect(
      resolveExecutionComposerSeed(
        execution({ model: null }),
        issue({ model: "gpt-5.5", effort: "xhigh" }),
        "codex",
      ),
    ).toMatchObject({
      agent: "cursor",
      model: "gpt-5.5",
      effort: "xhigh",
      mirrored: true,
    });
  });
});
