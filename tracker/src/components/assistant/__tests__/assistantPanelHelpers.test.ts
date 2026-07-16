import { describe, expect, it } from "vitest";

import { extractKbDocumentReferencesFromMessage } from "@/components/assistant/assistantPanelHelpers";
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
