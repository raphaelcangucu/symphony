import { describe, expect, it } from "vitest";

import {
  STREAMING_ASSISTANT_ID,
  appendAssistantDelta,
  toolCallIdentity,
  updateStreamingToolCall,
  upsertToolCall,
} from "@/components/assistant/assistantStream";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "running", arguments: null, output: null, result: {}, ...overrides };
}

describe("appendAssistantDelta", () => {
  it("creates a streaming message then appends", () => {
    const once = appendAssistantDelta([], "Hel");
    expect(once).toHaveLength(1);
    expect(once[0].id).toBe(STREAMING_ASSISTANT_ID);

    const twice = appendAssistantDelta(once, "lo");
    expect(twice[0].content).toBe("Hello");
  });
});

describe("toolCallIdentity", () => {
  it("prefers id, falls back to name", () => {
    expect(toolCallIdentity(call({ id: "c1" }))).toBe("id:c1");
    expect(toolCallIdentity(call({ id: null, name: "shell" }))).toBe("name:shell");
  });
});

describe("upsertToolCall", () => {
  it("appends a new call and keeps order", () => {
    const out = upsertToolCall([call({ id: "a" })], call({ id: "b", name: "shell" }));
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("updates the matching id in place (running -> complete)", () => {
    const out = upsertToolCall([call({ id: "a", status: "running" })], call({ id: "a", status: "complete" }));
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("complete");
  });

  it("does NOT collapse two same-name calls that have distinct ids", () => {
    const out = upsertToolCall([call({ id: "a", name: "read_file" })], call({ id: "b", name: "read_file" }));
    expect(out).toHaveLength(2);
  });
});

describe("updateStreamingToolCall", () => {
  it("attaches tool calls to the streaming message preserving arrival order", () => {
    const base: AssistantChatMessage[] = [];
    const afterFirst = updateStreamingToolCall(base, call({ id: "a", name: "read_file" }));
    const afterSecond = updateStreamingToolCall(afterFirst, call({ id: "b", name: "shell" }));
    const streaming = afterSecond.find((m) => m.id === STREAMING_ASSISTANT_ID);
    expect(streaming?.toolCalls.map((c) => c.name)).toEqual(["read_file", "shell"]);
  });
});
