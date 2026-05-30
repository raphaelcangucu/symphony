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

  it("strips leading hashes from running and retrying issue identifiers", () => {
    const runtime = normalizeRuntime({
      runtime_id: "r1",
      running: [{ issue_identifier: "#508" }],
      retrying: [{ issue_identifier: "#509" }],
    });

    expect(runtime.running[0].issueIdentifier).toBe("508");
    expect(runtime.retrying[0].issueIdentifier).toBe("509");
  });

  it("fills defaults for an empty/partial DTO", () => {
    const runtime = normalizeRuntime({ runtime_id: "r1" });

    expect(runtime.runtimeId).toBe("r1");
    expect(runtime.label).toBe("r1");
    expect(runtime.counts).toEqual({ running: 0, retrying: 0 });
    expect(runtime.agentTotals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    });
    expect(runtime.running).toEqual([]);
    expect(runtime.retrying).toEqual([]);
    expect(runtime.status).toBe("online");
    expect(runtime.reportedAt).toBe("");
    expect(runtime.projectSlug).toBeNull();
    expect(runtime.trackerKind).toBeNull();
    expect(runtime.sourceUrl).toBeNull();
    expect(runtime.rateLimits).toBeNull();
  });

  it("label falls back to project_slug then to 'unknown'", () => {
    expect(normalizeRuntime({ runtime_id: "r1", project_slug: "proj" }).label).toBe("proj");

    const empty = normalizeRuntime({});
    expect(empty.runtimeId).toBe("");
    expect(empty.label).toBe("unknown");
  });

  it("status normalization", () => {
    expect(normalizeRuntime({ runtime_id: "r1", status: "stale" }).status).toBe("stale");
    expect(normalizeRuntime({ runtime_id: "r1", status: "weird" }).status).toBe("online");
    expect(normalizeRuntime({ runtime_id: "r1" }).status).toBe("online");
  });

  it("tolerates null running/retrying and null nested tokens", () => {
    const nulled = normalizeRuntime({ runtime_id: "r1", running: null, retrying: null });
    expect(nulled.running).toEqual([]);
    expect(nulled.retrying).toEqual([]);

    const withNullTokens = normalizeRuntime({
      runtime_id: "r1",
      running: [{ issue_identifier: "X", tokens: null }],
    });
    expect(withNullTokens.running[0].tokens).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});
