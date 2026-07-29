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
      expect.objectContaining({
        role: "assistant",
        content: "I am working on it.",
      }),
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

  it("keeps a collapsed initial provider prompt out of the user bubble", () => {
    const entries = payloadSessionLogEntries({
      entries: [
        {
          kind: "user",
          title: "Initial prompt",
          body: "<recommended_plugins>A very long runtime prompt</recommended_plugins>",
          collapsed: true,
          language: "text",
        },
        {
          kind: "user",
          title: "You",
          body: "Stop and reply exactly ACK73",
          collapsed: false,
          language: "markdown",
        },
      ],
    });

    const timeline = buildOrchestratorTimeline(entries, "live");

    expect(timeline.messages[0]).toMatchObject({
      role: "system",
      content:
        "Initial prompt\n\n<recommended_plugins>A very long runtime prompt</recommended_plugins>",
    });
    expect(timeline.messages[1]).toMatchObject({
      role: "user",
      content: "Stop and reply exactly ACK73",
    });
  });

  it("renders provider reasoning as a compact activity instead of assistant prose", () => {
    const timeline = buildOrchestratorTimeline(
      [
        {
          kind: "reasoning",
          title: "Reasoning",
          body: "The model worked through the next step internally.",
        },
      ],
      "live",
    );

    expect(timeline.messages[0]).toMatchObject({
      role: "system",
      content:
        "Reasoning\n\nThe model worked through the next step internally.",
    });
  });

  it("derives a queued Steer message from the durable execution transcript", () => {
    const timeline = buildOrchestratorTimeline(
      payloadSessionLogEntries({
        entries: [
          {
            kind: "user",
            title: "Queued message",
            body: "Capture the E2E proof before replying",
            steer_id: "steer:42",
            steer_state: "queued",
          },
          {
            kind: "event",
            title: "Steer accepted",
            steer_id: "steer:42",
            steer_state: "accepted",
            collapsed: true,
          },
        ],
      }),
      "live",
      null,
      "claude",
    );

    expect(timeline.turnStatus).toEqual({
      status: "queued",
      canResume: false,
      queuedMessages: [
        {
          id: "steer:42",
          message: "Capture the E2E proof before replying",
          provider: "claude",
        },
      ],
    });
  });

  it("clears a queued Steer message when the execution advances with assistant output", () => {
    const timeline = buildOrchestratorTimeline(
      payloadSessionLogEntries({
        entries: [
          {
            kind: "user",
            title: "Queued message",
            body: "Use the real host",
            steer_id: "steer:43",
            steer_state: "queued",
          },
          {
            kind: "assistant",
            title: "Codex",
            body: "I will use the real host.",
          },
        ],
      }),
      "live",
    );

    expect(timeline.turnStatus).toBeNull();
  });

  it("accepts legacy string lines emitted by older Symphony hosts", () => {
    expect(
      payloadSessionLogEntries({ lines: ["assistant: Restored transcript"] }),
    ).toEqual([
      expect.objectContaining({
        kind: "event",
        title: "assistant",
        body: "Restored transcript",
      }),
    ]);
  });
});
