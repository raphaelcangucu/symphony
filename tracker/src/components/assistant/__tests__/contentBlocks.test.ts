import { describe, expect, it } from "vitest";

import { appendTextBlock, pushToolBlock } from "@/components/assistant/contentBlocks";

describe("appendTextBlock", () => {
  it("merges adjacent text blocks", () => {
    const input = [{ type: "text" as const, text: "Hello" }];

    expect(appendTextBlock(input, " world")).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("preserves non-empty whitespace", () => {
    expect(appendTextBlock([], " \t")).toEqual([{ type: "text", text: " \t" }]);
  });

  it("treats empty text as a no-op", () => {
    const input = [{ type: "text" as const, text: "Hello" }];

    expect(appendTextBlock(input, "")).toEqual(input);
  });

  it("does not mutate its input", () => {
    const textBlock = Object.freeze({ type: "text" as const, text: "Hello" });
    const input = Object.freeze([textBlock]);

    const output = appendTextBlock(input, " world");

    expect(output).toEqual([{ type: "text", text: "Hello world" }]);
    expect(output).not.toBe(input);
    expect(input).toEqual([{ type: "text", text: "Hello" }]);
  });
});

describe("pushToolBlock", () => {
  it("inserts a stable tool ID without mutating its input", () => {
    const input = Object.freeze([{ type: "text" as const, text: "Before" }]);

    const output = pushToolBlock(input, "call-1");

    expect(output).toEqual([
      { type: "text", text: "Before" },
      { type: "tool", toolCallId: "call-1" },
    ]);
    expect(output).not.toBe(input);
    expect(input).toEqual([{ type: "text", text: "Before" }]);
  });

  it("treats a blank tool ID as a no-op", () => {
    const input = [{ type: "text" as const, text: "Before" }];

    expect(pushToolBlock(input, " \t")).toEqual(input);
  });

  it("does not reinsert a duplicate tool ID", () => {
    const input = [{ type: "tool" as const, toolCallId: "call-1" }];

    expect(pushToolBlock(input, "call-1")).toEqual(input);
  });
});

describe("content block runtime validation", () => {
  it("rejects malformed inputs with clear errors", () => {
    const unsafeAppend = appendTextBlock as (blocks: unknown, text: unknown) => unknown;
    const unsafePush = pushToolBlock as (blocks: unknown, toolCallId: unknown) => unknown;

    expect(() => unsafeAppend(null, "text")).toThrow("contentBlocks must be an array when provided");
    expect(() => unsafeAppend([], 42)).toThrow("text must be a string");
    expect(() => unsafeAppend([{ type: "text", text: "" }], "text")).toThrow(
      "contentBlocks must contain only valid blocks",
    );
    expect(() => unsafePush([], 42)).toThrow("toolCallId must be a string");
  });
});
