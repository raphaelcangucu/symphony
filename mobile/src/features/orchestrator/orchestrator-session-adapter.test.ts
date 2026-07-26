import { describe, expect, it } from "vitest";

import {
  appendSessionLogEntries,
  buildOrchestratorTimeline,
  payloadSessionLogEntries,
} from "./orchestrator-session-adapter";

describe("orchestrator transcript adapter", () => {
  it("copies the proven session-log contract into the unified Dev10x chat", () => {
    const entries = payloadSessionLogEntries({
      entries: [
        {
          kind: "user",
          title: "Operator",
          body: "Implement the RPC",
          language: "markdown",
        },
        {
          kind: "assistant",
          title: "Codex",
          body: "I am working on it.",
          language: "markdown",
        },
        {
          kind: "tool_call",
          title: "exec_command",
          body: '{"cmd":"mix test"}',
          call_id: "call-1",
          status: "running",
        },
        {
          kind: "tool_result",
          title: "exec_command output",
          body: "8 tests, 0 failures",
          call_id: "call-1",
          status: "completed",
        },
      ],
    });

    const timeline = buildOrchestratorTimeline(entries, "live");

    expect(timeline.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Implement the RPC" }),
      expect.objectContaining({ role: "assistant", content: "I am working on it." }),
      expect.objectContaining({
        role: "assistant",
        toolCalls: [
          expect.objectContaining({
            id: "call-1",
            name: "exec_command",
            status: "complete",
            output: "8 tests, 0 failures",
          }),
        ],
      }),
    ]);
  });

  it("keeps an in-flight tool visible and appends real-time entries without duplicates", () => {
    const initial = payloadSessionLogEntries({
      entries: [
        {
          kind: "tool_call",
          title: "apply_patch",
          body: "{}",
          call_id: "call-2",
          status: "running",
        },
      ],
    });
    const next = appendSessionLogEntries(initial, {
      entries: [
        {
          kind: "tool_call",
          title: "apply_patch",
          body: "{}",
          call_id: "call-2",
          status: "running",
        },
        {
          kind: "assistant",
          title: "Codex",
          body: "Patch applied.",
        },
      ],
    });

    const timeline = buildOrchestratorTimeline(next, "live");
    expect(timeline.messages).toHaveLength(2);
    expect(timeline.messages[0]?.toolCalls[0]).toMatchObject({
      id: "call-2",
      status: "running",
      output: null,
    });
    expect(timeline.messages[1]?.content).toBe("Patch applied.");
  });

  it("accepts legacy string lines emitted by older Symphony hosts", () => {
    expect(payloadSessionLogEntries({ lines: ["assistant: Restored transcript"] })).toEqual([
      expect.objectContaining({
        kind: "event",
        title: "assistant",
        body: "Restored transcript",
      }),
    ]);
  });
});
