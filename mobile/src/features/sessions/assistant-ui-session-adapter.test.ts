import { describe, expect, it, vi } from "vitest";

import type { SessionTimelineState } from "./session-reducer";
import {
  buildAssistantUiMessages,
  messageText,
  submitAssistantUiMessage,
} from "./assistant-ui-session-adapter";

const timeline: SessionTimelineState = {
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "Build the mobile chat",
      toolCalls: [],
      insertedAt: "2026-07-26T01:00:00Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "I am working on it.",
      toolCalls: [
        {
          id: "tool-complete",
          name: "read_workspace_file",
          status: "complete",
          output: "package.json",
        },
      ],
      insertedAt: "2026-07-26T01:00:01Z",
    },
  ],
  streamingText: "Streaming the final answer",
  activeTools: [
    {
      id: "tool-running",
      name: "exec_command",
      status: "running",
      output: null,
    },
  ],
  connectionState: "live",
  pendingApproval: null,
  pendingUserInput: null,
  turnStatus: { status: "running", canResume: false },
  error: null,
};

describe("assistant-ui Symphony adapter", () => {
  it("maps durable history, completed tools, live text and running tools", () => {
    const messages = buildAssistantUiMessages(timeline);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "Build the mobile chat" }],
    });
    expect(messages[1]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "text", text: "I am working on it." },
        {
          type: "tool-call",
          toolCallId: "tool-complete",
          toolName: "read_workspace_file",
          result: "package.json",
        },
      ],
      status: { type: "complete", reason: "stop" },
    });
    expect(messages[2]).toMatchObject({
      id: "dev10x-streaming-message",
      role: "assistant",
      content: [
        { type: "text", text: "Streaming the final answer" },
        {
          type: "tool-call",
          toolCallId: "tool-running",
          toolName: "exec_command",
        },
      ],
      status: { type: "running" },
    });
  });

  it("extracts only text parts and forwards the composer message through Symphony RPC", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const appendMessage = {
      role: "user",
      content: [
        { type: "text", text: "Steer " },
        { type: "text", text: "the active turn" },
      ],
    };

    expect(messageText(appendMessage)).toBe("Steer the active turn");
    await submitAssistantUiMessage(appendMessage, onSend);

    expect(onSend).toHaveBeenCalledWith("Steer the active turn");
  });

  it("rejects empty composer submissions before reaching the host", async () => {
    const onSend = vi.fn();

    await expect(
      submitAssistantUiMessage({ role: "user", content: [{ type: "text", text: "  " }] }, onSend),
    ).rejects.toThrow("Message is required");
    expect(onSend).not.toHaveBeenCalled();
  });
});
