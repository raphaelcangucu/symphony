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
  turnStatus: { status: "running", canResume: false, queuedMessages: [] },
  turnPreferences: {
    executionMode: null,
    skillProfile: null,
    model: null,
    effort: null,
  },
  metadata: {
    projectSlug: null,
    issueIdentifier: null,
    agentKind: null,
    requestedModel: null,
    requestedEffort: null,
    resolvedModel: null,
    resolvedEffort: null,
  },
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

  it("keeps a completed tool terminal even when the host has no printable output", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "assistant-empty-tool",
          role: "assistant",
          content: "Finished",
          toolCalls: [
            {
              id: "silent-tool",
              name: "apply_patch",
              status: "complete",
              output: null,
            },
          ],
          insertedAt: "2026-07-26T01:00:02Z",
        },
      ],
    });

    expect(messages[0]).toMatchObject({
      content: [
        { type: "text", text: "Finished" },
        {
          type: "tool-call",
          toolCallId: "silent-tool",
          toolName: "apply_patch",
          result: "",
        },
      ],
    });
  });

  it("repairs missing provider paragraph boundaries without touching inline code", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "provider-prose",
          role: "assistant",
          content:
            "Review passed.Publish the branch next. Keep `PR.Publish` unchanged.",
          toolCalls: [],
          insertedAt: null,
        },
      ],
    });

    expect(messages[0]).toMatchObject({
      content: [
        {
          type: "text",
          text: "Review passed.\n\nPublish the branch next. Keep `PR.Publish` unchanged.",
        },
      ],
    });
  });

  it("keeps protocol-only tool records out of the readable chat timeline", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "assistant-turn",
          role: "assistant",
          content: "The implementation is complete.",
          toolCalls: [
            { id: "shell-1", name: "shell", status: "complete", output: "ok" },
          ],
          insertedAt: null,
        },
        {
          id: "raw-tool",
          role: "tool",
          content: 'Custom Tool Call Output\n\n{\\"output\\":\\"ok\\"}',
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "raw-system-tool",
          role: "system",
          content: 'Custom Tool Call Output\n\n{\\"output\\":\\"ok\\"}',
          toolCalls: [],
          insertedAt: null,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "The implementation is complete." },
        {
          type: "tool-call",
          toolCallId: "shell-1",
          toolName: "shell",
          result: "ok",
        },
      ],
    });
  });

  it("keeps provider envelopes and the initial runtime prompt out of the chat", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "initial-prompt",
          role: "system",
          content: "Initial prompt\n\nA long opaque provider instruction",
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "agent-envelope",
          role: "assistant",
          content: 'Agent_Message:\n\n{"delta":"internal"}',
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "reply",
          role: "assistant",
          content: "The task is ready for review.",
          toolCalls: [],
          insertedAt: null,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "The task is ready for review." }],
    });
  });

  it("suppresses one-line provider envelopes and empty transcript placeholders", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "inline-tool-output",
          role: "system",
          content: 'Custom Tool Call Output: {"output":"internal"}',
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "stream-event",
          role: "assistant",
          content: 'Agent Message Streaming: {"delta":"internal"}',
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "placeholder",
          role: "assistant",
          content: "",
          toolCalls: [],
          insertedAt: null,
        },
        {
          id: "reply",
          role: "assistant",
          content: "The task is ready for review.",
          toolCalls: [],
          insertedAt: null,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "The task is ready for review." }],
    });
  });

  it("groups adjacent provider tool records into one compact activity timeline", () => {
    const messages = buildAssistantUiMessages({
      ...timeline,
      streamingText: "",
      activeTools: [],
      messages: [
        {
          id: "tool-1",
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "shell-1", name: "shell", status: "complete", output: "pwd" },
          ],
          insertedAt: null,
        },
        {
          id: "tool-2",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "patch-1",
              name: "apply_patch",
              status: "complete",
              output: "done",
            },
          ],
          insertedAt: null,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toEqual([
      expect.objectContaining({ toolCallId: "shell-1", type: "tool-call" }),
      expect.objectContaining({ toolCallId: "patch-1", type: "tool-call" }),
    ]);
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
      submitAssistantUiMessage(
        { role: "user", content: [{ type: "text", text: "  " }] },
        onSend,
      ),
    ).rejects.toThrow("Message is required");
    expect(onSend).not.toHaveBeenCalled();
  });
});
