import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantChatMessageBubble } from "@/components/assistant/AssistantChatMessageBubble";
import type { AssistantChatMessage } from "@/services/assistant";

function message(overrides: Partial<AssistantChatMessage>): AssistantChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Hello from the assistant",
    toolCalls: [],
    metadata: {},
    ...overrides,
  };
}

describe("AssistantChatMessageBubble", () => {
  it("renders assistant messages with the shared chat marker", () => {
    render(<AssistantChatMessageBubble message={message({ role: "assistant" })} />);

    expect(screen.getByTestId("assistant-chat-message")).toHaveAttribute("data-role", "assistant");
    expect(screen.getByText("Hello from the assistant")).toBeInTheDocument();
  });

  it("renders user messages with the same shared chat marker", () => {
    render(<AssistantChatMessageBubble message={message({ role: "user", content: "User note" })} />);

    expect(screen.getByTestId("assistant-chat-message")).toHaveAttribute("data-role", "user");
    expect(screen.getByText("User note")).toBeInTheDocument();
  });
});
