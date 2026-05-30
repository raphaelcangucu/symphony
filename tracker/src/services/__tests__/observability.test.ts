import { describe, expect, it } from "vitest";

import { normalizeRuntime } from "../observability";

describe("normalizeRuntime", () => {
  it("maps snake_case backend DTO to camelCase domain", () => {
    const runtime = normalizeRuntime({
      runtime_id: "r1",
      label: "proj",
      project_slug: "proj",
      tracker_kind: "local",
      agent_kind: "codex",
      source_url: "http://localhost:4001",
      status: "online",
      reported_at: "2026-05-30T00:00:00Z",
      counts: { running: 2, retrying: 1 },
      agent_totals: { input_tokens: 10, output_tokens: 20, total_tokens: 30, seconds_running: 5 },
      rate_limits: null,
      running: [
        {
          issue_identifier: "PROJ-1",
          state: "In Progress",
          session_id: "sess-1",
          turn_count: 3,
          last_event: "agent_message",
          last_message: "working",
          started_at: "2026-05-30T00:00:00Z",
          last_event_at: "2026-05-30T00:00:01Z",
          tokens: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        },
      ],
      retrying: [{ issue_identifier: "PROJ-2", attempt: 1, due_at: null, error: "boom" }],
    });

    expect(runtime.runtimeId).toBe("r1");
    expect(runtime.counts).toEqual({ running: 2, retrying: 1 });
    expect(runtime.agentTotals.totalTokens).toBe(30);
    expect(runtime.running[0]).toMatchObject({ issueIdentifier: "PROJ-1", turnCount: 3 });
    expect(runtime.running[0].tokens).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    expect(runtime.retrying[0]).toEqual({ issueIdentifier: "PROJ-2", attempt: 1, dueAt: null, error: "boom" });
  });
});
