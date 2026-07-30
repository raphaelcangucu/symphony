import { describe, expect, it } from "vitest";

import { buildTurnNavigationItems } from "@/components/assistant/turnNavigation";
import type { AssistantChatMessage } from "@/services/assistant";

function message(
  id: string,
  role: AssistantChatMessage["role"],
  content: string,
): AssistantChatMessage {
  return { id, role, content, toolCalls: [], metadata: {} };
}

describe("buildTurnNavigationItems", () => {
  it("groups each user prompt with its first response", () => {
    expect(
      buildTurnNavigationItems([
        message("u1", "user", "First prompt"),
        message("a1", "assistant", "First response"),
        message("u2", "user", "Second prompt"),
        message("a2", "assistant", "Second response"),
      ]),
    ).toEqual([
      {
        id: "turn-u1",
        anchorId: "message-u1",
        prompt: "First prompt",
        responsePreview: "First response",
      },
      {
        id: "turn-u2",
        anchorId: "message-u2",
        prompt: "Second prompt",
        responsePreview: "Second response",
      },
    ]);
  });

  it("uses a generic label for attachment-only prompts", () => {
    const input = message("u1", "user", "");
    input.metadata = { attachments: [{ name: "brief.png" }] };
    expect(buildTurnNavigationItems([input])[0]?.prompt).toBe("Attachment");
  });
});
