import { describe, expect, it } from "vitest";

import { normalizeAgentExecution } from "@/services/agentExecutions";

describe("normalizeAgentExecution", () => {
  it("strips leading hashes from issue identifiers", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "#508",
      status: "live",
    });

    expect(execution.issueIdentifier).toBe("508");
  });

  it("normalizes long-running goal metadata and capabilities", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "MAC-1",
      status: "live",
      agent_kind: "codex",
      long_running: true,
      long_running_kind: "goal",
      long_running_label: "Pursuing goal",
      goal: {
        kind: "goal",
        source: "native",
        objective: "Ship the issue",
        status: "active",
        capabilities: ["get", "edit", "pause", "resume", "clear"],
      },
    });

    expect(execution.agentKind).toBe("codex");
    expect(execution.longRunning).toBe(true);
    expect(execution.longRunningKind).toBe("goal");
    expect(execution.longRunningLabel).toBe("Pursuing goal");
    expect(execution.goal).toMatchObject({
      kind: "goal",
      source: "native",
      objective: "Ship the issue",
      status: "active",
      capabilities: ["get", "edit", "pause", "resume", "clear"],
    });
  });

  it("normalizes error and aborted statuses", () => {
    const error = normalizeAgentExecution({
      issue_identifier: "CDE-1132",
      status: "error",
      error: "claude exited with code 1",
    });
    const aborted = normalizeAgentExecution({
      issue_identifier: "CDE-1132",
      status: "aborted",
      error: "Agent run interrupted — use Resume in the execution panel",
    });

    expect(error.status).toBe("error");
    expect(error.error).toBe("claude exited with code 1");
    expect(aborted.status).toBe("aborted");
    expect(aborted.error).toContain("Resume");
  });

  it("reconciles idle status with abort signals to aborted", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "CDE-1132",
      status: "idle",
      last_event: "turn_aborted",
      error: "Agent run interrupted — use Resume in the execution panel",
    });

    expect(execution.status).toBe("aborted");
  });
});
