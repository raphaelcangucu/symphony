import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantChatMessageBubble } from "@/components/assistant/AssistantChatMessageBubble";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";

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

describe("AssistantChatMessageBubble", () => {
  it("does not apply the legacy text-sm size class to either bubble", () => {
    render(<AssistantChatMessageBubble message={message({ role: "user", content: "Sized note" })} />);
    const userArticle = screen.getByTestId("assistant-chat-message").querySelector("article");
    expect(userArticle?.className.split(/\s+/) ?? []).not.toContain("text-sm");

    cleanup();

    render(<AssistantChatMessageBubble message={message({ role: "assistant", content: "Sized reply" })} />);
    const assistantArticle = screen.getByTestId("assistant-chat-message").querySelector("article");
    expect(assistantArticle?.className.split(/\s+/) ?? []).not.toContain("text-sm");
  });

  it("uses a soft tinted bubble for user messages instead of a heavy dark card", () => {
    render(<AssistantChatMessageBubble message={message({ role: "user", content: "Soft bubble" })} />);
    const article = screen.getByTestId("assistant-chat-message").querySelector("article");
    const classes = article?.className.split(/\s+/) ?? [];

    expect(classes).not.toContain("bg-slate-950");
    expect(classes).not.toContain("text-white");
    expect(classes).toContain("rounded-2xl");
    expect(classes.some((className) => className.startsWith("bg-violet-500"))).toBe(true);
  });

  it("does not wrap the assistant article in heavy card chrome", () => {
    render(<AssistantChatMessageBubble message={message({ role: "assistant", content: "Plain response" })} />);
    const article = screen.getByTestId("assistant-chat-message").querySelector("article");
    const classes = article?.className.split(/\s+/) ?? [];

    expect(classes).not.toContain("border");
    expect(classes).not.toContain("bg-card");
    expect(classes.some((className) => className.startsWith("bg-muted"))).toBe(false);
  });

  it("sizes user and assistant bubble text with the shared chat CSS variables", () => {
    render(<AssistantChatMessageBubble message={message({ role: "user", content: "Leading note" })} />);
    const userArticle = screen.getByTestId("assistant-chat-message").querySelector("article");
    const userClasses = userArticle?.className.split(/\s+/) ?? [];
    expect(userClasses).not.toContain("leading-6");
    expect(userClasses.some((className) => className.includes("text-[length:var(--chat-body)]"))).toBe(true);
    expect(userClasses.some((className) => className.includes("leading-[var(--chat-body-leading)]"))).toBe(true);

    cleanup();

    render(<AssistantChatMessageBubble message={message({ role: "assistant", content: "Leading reply" })} />);
    const assistantArticle = screen.getByTestId("assistant-chat-message").querySelector("article");
    const assistantClasses = assistantArticle?.className.split(/\s+/) ?? [];
    expect(assistantClasses.some((className) => className.includes("text-[length:var(--chat-body)]"))).toBe(true);
    expect(assistantClasses.some((className) => className.includes("leading-[var(--chat-body-leading)]"))).toBe(true);
  });

  it("renders assistant messages with the shared chat marker", () => {
    render(<AssistantChatMessageBubble message={message({ role: "assistant" })} />);

    const messageRow = screen.getByTestId("assistant-chat-message");
    expect(messageRow).toHaveAttribute("data-role", "assistant");
    expect(messageRow.querySelector("article")).toHaveClass(
      "assistant-response-content",
    );
    expect(screen.getByText("Hello from the assistant")).toBeInTheDocument();
  });

  it("renders user messages with the same shared chat marker", () => {
    render(<AssistantChatMessageBubble message={message({ role: "user", content: "User note" })} />);

    expect(screen.getByTestId("assistant-chat-message")).toHaveAttribute("data-role", "user");
    expect(
      screen.getByTestId("assistant-chat-message").querySelector("article"),
    ).not.toHaveClass("assistant-response-content");
    expect(screen.getByText("User note")).toBeInTheDocument();
  });

  it("renders assistant content blocks as one interleaved timeline", () => {
    const readCall = toolCall({
      id: "read-1",
      arguments: { path: "interleaved.ts" },
    });

    render(
      <AssistantChatMessageBubble
        message={message({
          content: "Legacy full assistant content",
          contentBlocks: [
            { type: "text", text: "Before tool" },
            { type: "tool", toolCallId: "read-1" },
            { type: "text", text: "After tool" },
          ],
          toolCalls: [readCall],
        })}
      />,
    );

    expect(screen.getByText("Before tool")).toBeInTheDocument();
    expect(screen.getByText("After tool")).toBeInTheDocument();
    expect(screen.queryByText("Legacy full assistant content")).not.toBeInTheDocument();
    expect(screen.getAllByText("interleaved.ts")).toHaveLength(1);
  });

  it("keeps full Markdown and end-stacked tools for legacy assistant messages", () => {
    const readCall = toolCall({
      id: "legacy-read",
      arguments: { path: "legacy.ts" },
    });

    render(
      <AssistantChatMessageBubble
        message={message({
          content: "**Legacy response**",
          contentBlocks: [],
          toolCalls: [readCall],
        })}
      />,
    );

    expect(screen.getByText("Legacy response")).toBeInTheDocument();
    expect(screen.getByText("Legacy response").tagName).toBe("STRONG");
    expect(screen.getByText("legacy.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-timeline-tool-run")).not.toBeInTheDocument();
  });

  it("keeps user content behavior unchanged when content blocks are present", () => {
    const readCall = toolCall({
      id: "user-read",
      arguments: { path: "user-tool.ts" },
    });

    render(
      <AssistantChatMessageBubble
        message={message({
          role: "user",
          content: "User note",
          contentBlocks: [{ type: "text", text: "Assistant-only block text" }],
          toolCalls: [readCall],
        })}
      />,
    );

    expect(screen.getByText("User note")).toBeInTheDocument();
    expect(screen.queryByText("Assistant-only block text")).not.toBeInTheDocument();
    expect(screen.getByText("user-tool.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-timeline-text")).not.toBeInTheDocument();
  });

  it.each(["tool", "system"] as const)(
    "keeps %s messages on the legacy non-user path when blocks are present",
    (role) => {
      const readCall = toolCall({
        id: `${role}-read`,
        arguments: { path: `${role}-legacy.ts` },
      });

      render(
        <AssistantChatMessageBubble
          message={message({
            role,
            content: `${role} legacy content`,
            contentBlocks: [{ type: "text", text: `${role} interleaved block` }],
            toolCalls: [readCall],
          })}
        />,
      );

      expect(screen.getByText(`${role} legacy content`)).toBeInTheDocument();
      expect(screen.queryByText(`${role} interleaved block`)).not.toBeInTheDocument();
      expect(screen.getByText(`${role}-legacy.ts`)).toBeInTheDocument();
      expect(screen.queryByTestId("assistant-timeline-text")).not.toBeInTheDocument();
    },
  );

  it("skips missing references and appends orphan activity safely", () => {
    const orphanCall = toolCall({
      id: "orphan-1",
      arguments: { path: "orphan.ts" },
    });

    render(
      <AssistantChatMessageBubble
        message={message({
          content: "Legacy content",
          contentBlocks: [
            { type: "tool", toolCallId: "missing-1" },
            { type: "text", text: "Safe response" },
          ],
          toolCalls: [orphanCall],
        })}
      />,
    );

    expect(screen.getByText("Safe response")).toBeInTheDocument();
    expect(screen.queryByText("Legacy content")).not.toBeInTheDocument();
    expect(screen.getAllByText("orphan.ts")).toHaveLength(1);
  });

  it("falls back to full Markdown when nonempty blocks render no timeline items", () => {
    render(
      <AssistantChatMessageBubble
        message={message({
          content: "Fallback **assistant response**",
          contentBlocks: [{ type: "tool", toolCallId: "missing-tool" }],
          toolCalls: [],
        })}
      />,
    );

    expect(screen.getByText("assistant response").tagName).toBe("STRONG");
    expect(screen.queryByTestId("assistant-timeline-tool-run")).not.toBeInTheDocument();
  });

  it("renders the edited-files summary once in interleaved mode", () => {
    const editCall = toolCall({
      id: "edit-1",
      name: "edit_file",
      arguments: { path: "src/edited.ts" },
      result: {
        paths: ["src/edited.ts"],
        additions: 2,
        deletions: 1,
      },
    });

    render(
      <AssistantChatMessageBubble
        message={message({
          content: "Edited a file",
          contentBlocks: [
            { type: "text", text: "Editing" },
            { type: "tool", toolCallId: "edit-1" },
            { type: "text", text: "Done" },
          ],
          toolCalls: [editCall],
        })}
      />,
    );

    expect(screen.getAllByText("Edited 1 file:")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "View changes to src/edited.ts" })).toHaveLength(1);
  });
});
