import type { AssistantContentBlock, AssistantToolCall } from "@/services/assistant";

export interface AssistantTimelineTextItem {
  type: "text";
  key: string;
  text: string;
}

export interface AssistantTimelineToolRunItem {
  type: "tool-run";
  key: string;
  toolCalls: AssistantToolCall[];
}

export type AssistantTimelineItem = AssistantTimelineTextItem | AssistantTimelineToolRunItem;

interface OrderedToolCall {
  stableId: string | null;
  toolCall: AssistantToolCall;
}

export function buildAssistantTimelineItems(
  contentBlocks: readonly AssistantContentBlock[],
  toolCalls: readonly AssistantToolCall[],
): AssistantTimelineItem[] {
  validateContentBlocks(contentBlocks);
  validateToolCalls(toolCalls);

  const { orderedToolCalls, latestToolCallById } = indexToolCalls(toolCalls);
  const renderedToolCallIds = new Set<string>();
  const timelineItems: AssistantTimelineItem[] = [];
  const keyOccurrences = new Map<string, number>();
  let pendingToolRun: AssistantToolCall[] = [];
  let pendingToolRunKey: string | null = null;
  let precedingToolBlockId: string | null = null;
  let pendingTextKey = textItemKey(null);
  let previousBlockType: AssistantContentBlock["type"] | null = null;

  const flushToolRun = () => {
    if (pendingToolRun.length > 0 && pendingToolRunKey) {
      timelineItems.push({
        type: "tool-run",
        key: pendingToolRunKey,
        toolCalls: pendingToolRun,
      });
    }
    pendingToolRun = [];
    pendingToolRunKey = null;
  };

  for (const block of contentBlocks) {
    if (block.type === "text") {
      flushToolRun();
      if (previousBlockType !== "text") {
        pendingTextKey = uniqueTimelineKey(
          textItemKey(precedingToolBlockId),
          keyOccurrences,
        );
      }
      appendTextItem(timelineItems, block.text, pendingTextKey);
      previousBlockType = "text";
      continue;
    }

    const stableId = stableToolCallId(block.toolCallId);
    if (!stableId) continue;

    if (previousBlockType !== "tool") {
      pendingToolRunKey = uniqueTimelineKey(
        referencedToolRunKey(stableId),
        keyOccurrences,
      );
    }
    precedingToolBlockId = stableId;
    previousBlockType = "tool";

    if (renderedToolCallIds.has(stableId)) continue;

    const toolCall = latestToolCallById.get(stableId);
    if (!toolCall) continue;

    pendingToolRun = [...pendingToolRun, toolCall];
    renderedToolCallIds.add(stableId);
  }

  flushToolRun();

  const orphanEntries = orderedToolCalls.filter(
    ({ stableId }) => stableId === null || !renderedToolCallIds.has(stableId),
  );
  const orphanToolCalls = orphanEntries.map(({ stableId, toolCall }) =>
    stableId ? latestToolCallById.get(stableId) ?? toolCall : toolCall,
  );

  if (orphanToolCalls.length > 0) {
    timelineItems.push({
      type: "tool-run",
      key: orphanToolRunKey(orphanEntries[0]),
      toolCalls: orphanToolCalls,
    });
  }

  return timelineItems;
}

function indexToolCalls(toolCalls: readonly AssistantToolCall[]): {
  orderedToolCalls: OrderedToolCall[];
  latestToolCallById: Map<string, AssistantToolCall>;
} {
  const orderedToolCalls: OrderedToolCall[] = [];
  const latestToolCallById = new Map<string, AssistantToolCall>();
  const seenStableIds = new Set<string>();
  const seenIdlessCalls = new Set<AssistantToolCall>();

  for (const toolCall of toolCalls) {
    const stableId = stableToolCallId(toolCall.id);
    if (!stableId) {
      if (seenIdlessCalls.has(toolCall)) continue;
      seenIdlessCalls.add(toolCall);
      orderedToolCalls.push({ stableId: null, toolCall });
      continue;
    }

    latestToolCallById.set(stableId, toolCall);
    if (seenStableIds.has(stableId)) continue;

    seenStableIds.add(stableId);
    orderedToolCalls.push({ stableId, toolCall });
  }

  return { orderedToolCalls, latestToolCallById };
}

function appendTextItem(
  items: AssistantTimelineItem[],
  text: string,
  key: string,
): void {
  if (text === "") return;

  const previousItem = items[items.length - 1];
  if (previousItem?.type === "text") {
    items[items.length - 1] = {
      ...previousItem,
      text: `${previousItem.text}${text}`,
    };
    return;
  }

  items.push({ type: "text", key, text });
}

function textItemKey(precedingToolBlockId: string | null): string {
  return precedingToolBlockId
    ? timelineKey("text", "after-tool", precedingToolBlockId)
    : timelineKey("text", "turn-start");
}

function referencedToolRunKey(firstToolBlockId: string): string {
  return timelineKey("tool-run", "referenced", firstToolBlockId);
}

function orphanToolRunKey(firstOrphan: OrderedToolCall): string {
  return firstOrphan.stableId
    ? timelineKey("tool-run", "orphan", "id", firstOrphan.stableId)
    : timelineKey("tool-run", "orphan", "name", firstOrphan.toolCall.name);
}

function uniqueTimelineKey(baseKey: string, occurrences: Map<string, number>): string {
  const occurrence = occurrences.get(baseKey) ?? 0;
  occurrences.set(baseKey, occurrence + 1);
  return occurrence === 0
    ? baseKey
    : timelineKey("repeated", baseKey, String(occurrence));
}

function timelineKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

function stableToolCallId(id: string | null): string | null {
  if (typeof id !== "string") return null;
  const trimmedId = id.trim();
  return trimmedId === "" ? null : trimmedId;
}

function validateContentBlocks(value: unknown): asserts value is readonly AssistantContentBlock[] {
  if (!Array.isArray(value)) throw new TypeError("contentBlocks must be an array");

  value.forEach((block, index) => {
    if (!isRecord(block)) {
      throw new TypeError(`contentBlocks[${index}] must be an object`);
    }

    if (block.type === "text") {
      if (typeof block.text !== "string") {
        throw new TypeError(`contentBlocks[${index}].text must be a string`);
      }
      return;
    }

    if (block.type === "tool") {
      if (typeof block.toolCallId !== "string" || block.toolCallId.trim() === "") {
        throw new TypeError(`contentBlocks[${index}].toolCallId must be a nonblank string`);
      }
      return;
    }

    throw new TypeError(`contentBlocks[${index}].type must be "text" or "tool"`);
  });
}

function validateToolCalls(value: unknown): asserts value is readonly AssistantToolCall[] {
  if (!Array.isArray(value)) throw new TypeError("toolCalls must be an array");

  value.forEach((toolCall, index) => {
    if (!isRecord(toolCall)) {
      throw new TypeError(`toolCalls[${index}] must be an object`);
    }
    if (toolCall.id !== null && typeof toolCall.id !== "string") {
      throw new TypeError(`toolCalls[${index}].id must be a string or null`);
    }
    if (typeof toolCall.name !== "string") {
      throw new TypeError(`toolCalls[${index}].name must be a string`);
    }
    if (toolCall.status !== "running" && toolCall.status !== "complete" && toolCall.status !== "error") {
      throw new TypeError(`toolCalls[${index}].status must be "running", "complete", or "error"`);
    }
    if (toolCall.arguments !== undefined && toolCall.arguments !== null && !isRecord(toolCall.arguments)) {
      throw new TypeError(`toolCalls[${index}].arguments must be an object, null, or undefined`);
    }
    if (toolCall.output !== undefined && toolCall.output !== null && typeof toolCall.output !== "string") {
      throw new TypeError(`toolCalls[${index}].output must be a string, null, or undefined`);
    }
    if (!isRecord(toolCall.result)) {
      throw new TypeError(`toolCalls[${index}].result must be an object`);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
