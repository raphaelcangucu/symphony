import type { AssistantContentBlock } from "@/services/assistant";

type ContentBlocksInput = readonly AssistantContentBlock[] | undefined;

export function appendTextBlock(
  contentBlocks: ContentBlocksInput,
  text: string,
): AssistantContentBlock[] | undefined {
  validateContentBlocks(contentBlocks);
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (text === "") return copyContentBlocks(contentBlocks);

  const blocks = contentBlocks ?? [];
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock?.type !== "text") return [...blocks, { type: "text", text }];

  return [...blocks.slice(0, -1), { type: "text", text: `${lastBlock.text}${text}` }];
}

export function pushToolBlock(
  contentBlocks: ContentBlocksInput,
  toolCallId: string,
): AssistantContentBlock[] | undefined {
  validateContentBlocks(contentBlocks);
  if (typeof toolCallId !== "string") throw new TypeError("toolCallId must be a string");
  if (toolCallId.trim() === "") return copyContentBlocks(contentBlocks);

  const blocks = contentBlocks ?? [];
  if (blocks.some((block) => block.type === "tool" && block.toolCallId === toolCallId)) {
    return copyContentBlocks(contentBlocks);
  }

  return [...blocks, { type: "tool", toolCallId }];
}

function copyContentBlocks(contentBlocks: ContentBlocksInput): AssistantContentBlock[] | undefined {
  return contentBlocks ? [...contentBlocks] : undefined;
}

function validateContentBlocks(contentBlocks: unknown): asserts contentBlocks is ContentBlocksInput {
  if (contentBlocks === undefined) return;
  if (!Array.isArray(contentBlocks)) throw new TypeError("contentBlocks must be an array when provided");
  if (!contentBlocks.every(isAssistantContentBlock)) {
    throw new TypeError("contentBlocks must contain only valid blocks");
  }
}

function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  if (typeof value !== "object" || value === null) return false;

  const block = value as Record<string, unknown>;
  if (block.type === "text") return typeof block.text === "string" && block.text.length > 0;
  if (block.type === "tool") return typeof block.toolCallId === "string" && block.toolCallId.trim() !== "";
  return false;
}
