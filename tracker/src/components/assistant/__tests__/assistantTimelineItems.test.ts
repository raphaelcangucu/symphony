import { describe, expect, it } from "vitest";

import {
  buildAssistantTimelineItems,
  type AssistantTimelineItem,
} from "@/components/assistant/assistantTimelineItems";
import type { AssistantContentBlock, AssistantToolCall } from "@/services/assistant";

const TURN_START_TEXT_KEY = '["text","turn-start"]';

function toolCall(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return {
    id: "tool-1",
    name: "read_file",
    status: "complete",
    arguments: {},
    output: null,
    result: {},
    ...overrides,
  };
}

function itemTypes(items: AssistantTimelineItem[]): AssistantTimelineItem["type"][] {
  return items.map((item) => item.type);
}

function itemKey(item: AssistantTimelineItem | undefined): string | undefined {
  return (item as (AssistantTimelineItem & { key?: string }) | undefined)?.key;
}

function textAfterToolKey(toolCallId: string): string {
  return JSON.stringify(["text", "after-tool", toolCallId]);
}

function referencedRunKey(toolCallId: string): string {
  return JSON.stringify(["tool-run", "referenced", toolCallId]);
}

function orphanRunKey(toolCallId: string): string {
  return JSON.stringify(["tool-run", "orphan", "id", toolCallId]);
}

describe("buildAssistantTimelineItems", () => {
  it("preserves text, tool-run, text order", () => {
    const readCall = toolCall({ id: "read-1", arguments: { path: "README.md" } });
    const items = buildAssistantTimelineItems(
      [
        { type: "text", text: "Before" },
        { type: "tool", toolCallId: "read-1" },
        { type: "text", text: "After" },
      ],
      [readCall],
    );

    expect(itemTypes(items)).toEqual(["text", "tool-run", "text"]);
    expect(items).toEqual([
      { type: "text", key: TURN_START_TEXT_KEY, text: "Before" },
      {
        type: "tool-run",
        key: referencedRunKey("read-1"),
        toolCalls: [readCall],
      },
      { type: "text", key: textAfterToolKey("read-1"), text: "After" },
    ]);
  });

  it("keeps text and tool-run keys stable as streaming content grows", () => {
    const pendingCall = toolCall({ id: "pending-1", arguments: { path: "pending.ts" } });
    const firstRunCall = toolCall({ id: "run-1", arguments: { path: "first.ts" } });
    const appendedRunCall = toolCall({ id: "run-2", arguments: { path: "second.ts" } });
    const initialItems = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "pending-1" },
        { type: "text", text: "Hel" },
        { type: "tool", toolCallId: "run-1" },
      ],
      [firstRunCall],
    );
    const updatedItems = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "pending-1" },
        { type: "text", text: "Hello" },
        { type: "tool", toolCallId: "run-1" },
        { type: "tool", toolCallId: "run-2" },
      ],
      [pendingCall, firstRunCall, appendedRunCall],
    );

    const initialText = initialItems.find((item) => item.type === "text");
    const updatedText = updatedItems.find((item) => item.type === "text");
    const initialRun = initialItems.find((item) => item.type === "tool-run");
    const updatedGrowingRun = updatedItems.find(
      (item) =>
        item.type === "tool-run" &&
        item.toolCalls.some((call) => call.id === "run-1"),
    );

    expect(itemKey(initialText)).toBe('["text","after-tool","pending-1"]');
    expect(itemKey(updatedText)).toBe(itemKey(initialText));
    expect(itemKey(initialRun)).toBe('["tool-run","referenced","run-1"]');
    expect(itemKey(updatedGrowingRun)).toBe(itemKey(initialRun));
  });

  it("places adjacent tool blocks in one run", () => {
    const firstCall = toolCall({ id: "read-1", arguments: { path: "first.ts" } });
    const secondCall = toolCall({ id: "read-2", arguments: { path: "second.ts" } });

    const items = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "read-1" },
        { type: "tool", toolCallId: "read-2" },
      ],
      [firstCall, secondCall],
    );

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("read-1"),
        toolCalls: [firstCall, secondCall],
      },
    ]);
  });

  it("keeps keys unique when stable anchors repeat", () => {
    const firstCall = toolCall({ id: "first-1" });
    const secondCall = toolCall({ id: "second-1" });

    const items = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "shared-missing" },
        { type: "tool", toolCallId: "first-1" },
        { type: "text", text: "First" },
        { type: "tool", toolCallId: "shared-missing" },
        { type: "tool", toolCallId: "second-1" },
        { type: "text", text: "Second" },
      ],
      [firstCall, secondCall],
    );

    const keys = items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps mixed tool kinds in the same run", () => {
    const readCall = toolCall({ id: "read-1", name: "read_file" });
    const commandCall = toolCall({ id: "command-1", name: "shell" });

    const items = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "read-1" },
        { type: "tool", toolCallId: "command-1" },
      ],
      [readCall, commandCall],
    );

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("read-1"),
        toolCalls: [readCall, commandCall],
      },
    ]);
  });

  it("renders a duplicated tool block only once", () => {
    const call = toolCall({ id: "duplicate-1" });

    const items = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "duplicate-1" },
        { type: "tool", toolCallId: "duplicate-1" },
      ],
      [call],
    );

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("duplicate-1"),
        toolCalls: [call],
      },
    ]);
  });

  it("skips a missing tool reference without losing resolved tools", () => {
    const call = toolCall({ id: "present-1" });

    const items = buildAssistantTimelineItems(
      [
        { type: "tool", toolCallId: "missing-1" },
        { type: "tool", toolCallId: "present-1" },
      ],
      [call],
    );

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("missing-1"),
        toolCalls: [call],
      },
    ]);
  });

  it("appends unreferenced calls once in their original order", () => {
    const firstOrphan = toolCall({ id: "orphan-1", name: "shell" });
    const referenced = toolCall({ id: "referenced-1", name: "read_file" });
    const secondOrphan = toolCall({ id: "orphan-2", name: "edit_file" });

    const items = buildAssistantTimelineItems(
      [{ type: "tool", toolCallId: "referenced-1" }],
      [firstOrphan, referenced, secondOrphan],
    );

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("referenced-1"),
        toolCalls: [referenced],
      },
      {
        type: "tool-run",
        key: orphanRunKey("orphan-1"),
        toolCalls: [firstOrphan, secondOrphan],
      },
    ]);

    const initialOrphanItems = buildAssistantTimelineItems([], [firstOrphan]);
    const growingOrphanItems = buildAssistantTimelineItems(
      [],
      [firstOrphan, secondOrphan],
    );
    expect(itemKey(growingOrphanItems[0])).toBe(itemKey(initialOrphanItems[0]));
  });

  it("uses the latest duplicate snapshot while retaining first-seen orphan order", () => {
    const firstSnapshot = toolCall({ id: "shared-1", status: "running", output: "old" });
    const middleCall = toolCall({ id: "middle-1", name: "shell" });
    const latestSnapshot = toolCall({ id: "shared-1", status: "complete", output: "new" });

    const items = buildAssistantTimelineItems([], [firstSnapshot, middleCall, latestSnapshot]);

    expect(items).toEqual([
      {
        type: "tool-run",
        key: orphanRunKey("shared-1"),
        toolCalls: [latestSnapshot, middleCall],
      },
    ]);
  });

  it("merges adjacent text exactly and ignores only empty text", () => {
    const items = buildAssistantTimelineItems(
      [
        { type: "text", text: "  before" },
        { type: "text", text: " \n" },
        { type: "text", text: "" },
        { type: "text", text: "after  " },
      ],
      [],
    );

    expect(items).toEqual([
      {
        type: "text",
        key: TURN_START_TEXT_KEY,
        text: "  before \nafter  ",
      },
    ]);
  });

  it("does not mutate caller arrays or objects", () => {
    const block = Object.freeze({ type: "tool" as const, toolCallId: "immutable-1" });
    const call = Object.freeze({
      ...toolCall({ id: "immutable-1" }),
      arguments: Object.freeze({ path: "immutable.ts" }),
      result: Object.freeze({}),
    });
    const blocks = Object.freeze<readonly AssistantContentBlock[]>([block]);
    const toolCalls = Object.freeze<readonly AssistantToolCall[]>([call]);

    const items = buildAssistantTimelineItems(blocks, toolCalls);

    expect(items).toEqual([
      {
        type: "tool-run",
        key: referencedRunKey("immutable-1"),
        toolCalls: [call],
      },
    ]);
    expect(blocks).toEqual([block]);
    expect(toolCalls).toEqual([call]);
    expect(items[0]?.type === "tool-run" && items[0].toolCalls).not.toBe(toolCalls);
  });

  it("fails fast with clear errors for malformed runtime inputs", () => {
    expect(() =>
      buildAssistantTimelineItems(
        null as unknown as AssistantContentBlock[],
        [],
      ),
    ).toThrowError("contentBlocks must be an array");
    expect(() =>
      buildAssistantTimelineItems(
        [{ type: "text", text: 42 } as unknown as AssistantContentBlock],
        [],
      ),
    ).toThrowError("contentBlocks[0].text must be a string");
    expect(() =>
      buildAssistantTimelineItems(
        [],
        "invalid" as unknown as AssistantToolCall[],
      ),
    ).toThrowError("toolCalls must be an array");
    expect(() =>
      buildAssistantTimelineItems(
        [],
        [{ ...toolCall({}), status: "pending" } as unknown as AssistantToolCall],
      ),
    ).toThrowError('toolCalls[0].status must be "running", "complete", or "error"');
  });
});
