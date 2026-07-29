import { describe, expect, it } from "vitest";

import { reconcileToolActivityTimings } from "@/components/assistant/toolActivityTiming";
import type { AssistantChatMessage } from "@/services/assistant";

function message(
  toolCallId: string,
  status: "running" | "complete" | "error",
): AssistantChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: toolCallId,
        name: "shell",
        status,
        arguments: { command: "sleep 10" },
        result: {},
      },
    ],
    metadata: {},
  };
}

describe("reconcileToolActivityTimings", () => {
  it("captures the active tool start under its stable ID", () => {
    expect(
      reconcileToolActivityTimings(
        {},
        {
          activeTool: { id: "tool-1", startedAt: 1_000 },
          messages: [message("tool-1", "running")],
          turnStartedAt: 500,
          nowMs: 4_000,
        },
      ),
    ).toEqual({
      "tool-1": { startedAt: 1_000, durationMs: null },
    });
  });

  it("uses the turn start when the provider omits tool timing", () => {
    expect(
      reconcileToolActivityTimings(
        {},
        {
          activeTool: { id: "tool-1", startedAt: null },
          messages: [message("tool-1", "running")],
          turnStartedAt: 500,
          nowMs: 4_000,
        },
      ),
    ).toEqual({
      "tool-1": { startedAt: 500, durationMs: null },
    });
  });

  it("freezes elapsed time when the matching tool settles", () => {
    expect(
      reconcileToolActivityTimings(
        {
          "tool-1": { startedAt: 1_000, durationMs: null },
        },
        {
          activeTool: null,
          messages: [message("tool-1", "complete")],
          turnStartedAt: null,
          nowMs: 11_000,
        },
      ),
    ).toEqual({
      "tool-1": { startedAt: 1_000, durationMs: 10_000 },
    });
  });

  it("preserves object identity when no timing changes", () => {
    const current = {
      "tool-1": { startedAt: 1_000, durationMs: 10_000 },
    };

    expect(
      reconcileToolActivityTimings(current, {
        activeTool: null,
        messages: [message("tool-1", "complete")],
        turnStartedAt: null,
        nowMs: 20_000,
      }),
    ).toBe(current);
  });
});
