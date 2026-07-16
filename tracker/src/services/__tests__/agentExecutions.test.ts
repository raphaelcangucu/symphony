import { beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listAgentExecutions, normalizeAgentExecution } from "@/services/agentExecutions";

vi.mock("@/services/http", () => ({
  http: { get: vi.fn() },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
  unwrapData: (response: { data: unknown }) => response.data,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAgentExecutions", () => {
  it("loads the global execution snapshot used by the shared provider", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [] });

    await listAgentExecutions();

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/agent_executions");
  });
});

describe("normalizeAgentExecution", () => {
  it("strips leading hashes from issue identifiers", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "#508",
      status: "live",
    });

    expect(execution.issueIdentifier).toBe("508");
  });

  it("normalizes execution model", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "MAC-1",
      status: "live",
      agent_kind: "codex",
      model: "  gpt-5.4  ",
    });

    expect(execution.model).toBe("gpt-5.4");
  });

  it("normalizes long-running goal metadata and capabilities", () => {
    const execution = normalizeAgentExecution({
      issue_identifier: "MAC-1",
      status: "live",
      agent_kind: "claude",
      long_running: true,
      long_running_kind: "goal",
      long_running_label: "Pursuing goal",
      goal: {
        kind: "goal",
        source: "claude",
        objective: "Ship the issue",
        status: "running",
        capabilities: ["stop", "edit", "pause", "resume", "clear", "pause", " "],
        token_budget: 200_000,
        tokens_used: 12_000,
        time_used_seconds: 81,
        updated_at: "2026-07-13T12:01:21Z",
        revision: "44",
      },
    });

    expect(execution.agentKind).toBe("claude");
    expect(execution.longRunning).toBe(true);
    expect(execution.longRunningKind).toBe("goal");
    expect(execution.longRunningLabel).toBe("Pursuing goal");
    expect(execution.goal).toMatchObject({
      kind: "goal",
      source: "claude",
      objective: "Ship the issue",
      status: "running",
      capabilities: ["stop", "edit", "pause", "resume", "clear"],
      tokenBudget: 200_000,
      tokensUsed: 12_000,
      timeUsedSeconds: 81,
      updatedAt: "2026-07-13T12:01:21Z",
      revision: "44",
    });
  });

  it("rejects noncanonical goal kind or provider source", () => {
    expect(
      normalizeAgentExecution({
        issue_identifier: "MAC-2",
        goal: { kind: "goal", source: "cursor", status: "running" },
      }).goal,
    ).toBeNull();
    expect(
      normalizeAgentExecution({
        issue_identifier: "MAC-3",
        goal: { kind: "task", source: "native", status: "running" },
      }).goal,
    ).toBeNull();
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
