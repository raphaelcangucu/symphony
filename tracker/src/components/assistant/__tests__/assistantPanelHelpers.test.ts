import { describe, expect, it, vi } from "vitest";

import {
  displayMessages,
  extractKbDocumentReferencesFromMessage,
} from "@/components/assistant/assistantPanelHelpers";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

function toolCall(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return {
    id: "tool-1",
    name: "shell",
    status: "complete",
    arguments: null,
    output: null,
    result: {},
    ...overrides,
  };
}

function message(overrides: Partial<AssistantChatMessage>): AssistantChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "",
    toolCalls: [],
    metadata: {},
    ...overrides,
  };
}

describe("displayMessages", () => {
  const tMock = vi.fn((key: string, options?: { agent?: string }) => {
    if (key === "assistant.panel.codingAgent") return "the coding agent";
    if (key === "assistant.panel.welcome") {
      return `Welcome via ${options?.agent ?? "missing"}`;
    }
    return key;
  });
  const t = tMock as unknown as import("i18next").TFunction;

  it("names the thread agent in the empty-state welcome", () => {
    const [welcome] = displayMessages([], t, "cursor");

    expect(welcome.content).toBe("Welcome via Cursor");
    expect(tMock).toHaveBeenCalledWith("assistant.panel.welcome", { agent: "Cursor" });
  });

  it("falls back to a neutral agent label when none is resolved yet", () => {
    tMock.mockClear();
    const [welcome] = displayMessages([], t, null);

    expect(welcome.content).toBe("Welcome via the coding agent");
    expect(tMock).toHaveBeenCalledWith("assistant.panel.codingAgent");
    expect(tMock).toHaveBeenCalledWith("assistant.panel.welcome", { agent: "the coding agent" });
  });

  it("returns real messages unchanged when the transcript is non-empty", () => {
    const existing = [message({ content: "hello" })];
    expect(displayMessages(existing, t, "cursor")).toBe(existing);
  });
});

describe("extractKbDocumentReferencesFromMessage", () => {
  it("extracts references from the message content", () => {
    const result = extractKbDocumentReferencesFromMessage(
      message({ content: "Atualizei docs/market/spec.md agora." }),
    );

    expect(result).toEqual(["market/spec.md"]);
  });

  it("does not scan large tool output for references", () => {
    const hugeOutput = `${"x".repeat(200_000)}\ndocs/market/leaked.md\n${"x".repeat(200_000)}`;

    const result = extractKbDocumentReferencesFromMessage(
      message({
        content: "sem referência aqui",
        toolCalls: [toolCall({ output: hugeOutput })],
      }),
    );

    expect(result).toEqual([]);
  });

  it("does not scan tool result payloads for references", () => {
    const result = extractKbDocumentReferencesFromMessage(
      message({
        toolCalls: [toolCall({ result: { note: "docs/market/leaked.md" } })],
      }),
    );

    expect(result).toEqual([]);
  });

  it("scans small tool arguments that contain a markdown path", () => {
    const result = extractKbDocumentReferencesFromMessage(
      message({
        toolCalls: [toolCall({ name: "read_file", arguments: { path: "docs/market/spec.md" } })],
      }),
    );

    expect(result).toEqual(["market/spec.md"]);
  });

  it("ignores tool arguments larger than the scan cap", () => {
    const bulkyArguments = { patch: `${"a".repeat(6000)} docs/market/spec.md` };

    const result = extractKbDocumentReferencesFromMessage(
      message({
        toolCalls: [toolCall({ name: "apply_patch", arguments: bulkyArguments })],
      }),
    );

    expect(result).toEqual([]);
  });

  it("returns a stable reference for identical message content (cache hit)", () => {
    const sample = message({ content: "Veja docs/market/spec.md." });

    const first = extractKbDocumentReferencesFromMessage(sample);
    const second = extractKbDocumentReferencesFromMessage(sample);

    expect(first).toEqual(["market/spec.md"]);
    expect(second).toBe(first);
  });

  it("recomputes when streamed content grows for the same message id", () => {
    const before = extractKbDocumentReferencesFromMessage(
      message({ id: "stream-1", content: "Início sem referência" }),
    );
    const after = extractKbDocumentReferencesFromMessage(
      message({ id: "stream-1", content: "Início sem referência e docs/market/spec.md" }),
    );

    expect(before).toEqual([]);
    expect(after).toEqual(["market/spec.md"]);
  });
});
