import type { AssistantChatMessage } from "@/services/assistant";

export interface TurnNavigationItem {
  id: string;
  anchorId: string;
  prompt: string;
  responsePreview: string;
}

export function buildTurnNavigationItems(
  messages: readonly AssistantChatMessage[],
): TurnNavigationItem[] {
  const turns: TurnNavigationItem[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        id: `turn-${message.id}`,
        anchorId: `message-${message.id}`,
        prompt: message.content.trim() || "Attachment",
        responsePreview: "",
      });
      continue;
    }

    if (message.role !== "assistant") continue;
    const current = turns.at(-1);
    if (current && !current.responsePreview) {
      current.responsePreview = message.content.trim();
    }
  }

  return turns;
}
