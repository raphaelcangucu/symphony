import { describe, expect, it } from "vitest";

import {
  createSessionTimelineState,
  sessionTimelineReducer,
  type AssistantMessage,
} from "./session-reducer";

const userMessage: AssistantMessage = {
  id: "1",
  role: "user",
  content: "Build it",
  toolCalls: [],
  insertedAt: "2026-07-24T02:00:00Z",
};
const assistantMessage: AssistantMessage = {
  id: "2",
  role: "assistant",
  content: "Done",
  toolCalls: [],
  insertedAt: "2026-07-24T02:01:00Z",
};

describe("session timeline reducer", () => {
  it("replaces history and deduplicates messages by id", () => {
    let state = sessionTimelineReducer(createSessionTimelineState(), {
      type: "history_loaded",
      messages: [userMessage],
    });
    state = sessionTimelineReducer(state, {
      type: "message_created",
      message: userMessage,
    });
    state = sessionTimelineReducer(state, {
      type: "message_created",
      message: assistantMessage,
    });

    expect(state.messages).toEqual([userMessage, assistantMessage]);
  });

  it("accumulates deltas and replaces them with the completed message", () => {
    let state = sessionTimelineReducer(createSessionTimelineState(), {
      type: "assistant_delta",
      delta: "Clean ",
    });
    state = sessionTimelineReducer(state, {
      type: "assistant_delta",
      delta: "flow",
    });
    expect(state.streamingText).toBe("Clean flow");

    state = sessionTimelineReducer(state, {
      type: "assistant_completed",
      message: assistantMessage,
    });
    expect(state.streamingText).toBe("");
    expect(state.messages).toEqual([assistantMessage]);
  });

  it("updates tool state without duplicating the call", () => {
    let state = sessionTimelineReducer(createSessionTimelineState(), {
      type: "tool_call_started",
      toolCall: {
        id: "tool-1",
        name: "run_tests",
        status: "running",
        output: null,
      },
    });
    state = sessionTimelineReducer(state, {
      type: "tool_call_completed",
      toolCall: {
        id: "tool-1",
        name: "run_tests",
        status: "complete",
        output: "32 passed",
      },
    });

    expect(state.activeTools).toEqual([
      {
        id: "tool-1",
        name: "run_tests",
        status: "complete",
        output: "32 passed",
      },
    ]);
  });

  it("replaces stale history on reconnect sync while preserving connection state", () => {
    const stale = {
      ...createSessionTimelineState(),
      messages: [userMessage],
      connectionState: "reconnecting" as const,
      streamingText: "stale",
    };

    expect(
      sessionTimelineReducer(stale, {
        type: "history_synced",
        messages: [userMessage, assistantMessage],
      }),
    ).toMatchObject({
      messages: [userMessage, assistantMessage],
      connectionState: "live",
      streamingText: "",
      error: null,
    });
  });

  it("tracks approvals, user questions, and resumable turn state explicitly", () => {
    let state = sessionTimelineReducer(createSessionTimelineState(), {
      type: "approval_required",
      request: {
        requestId: "approval-1",
        command: "git push",
        cwd: "/work/symphony",
        reason: "Push the branch",
        toolName: "exec",
        agent: "codex",
      },
    });
    state = sessionTimelineReducer(state, {
      type: "user_input_required",
      request: {
        requestId: "question-1",
        questions: [
          {
            id: "target",
            header: "Target",
            question: "Where should this deploy?",
            isOther: false,
            isSecret: false,
            options: [{ label: "Production", description: "Public app" }],
          },
        ],
      },
    });
    state = sessionTimelineReducer(state, {
      type: "turn_status",
      status: { status: "interrupted", canResume: true, queuedMessages: [] },
    });

    expect(state.pendingApproval?.requestId).toBe("approval-1");
    expect(state.pendingUserInput?.questions[0]?.id).toBe("target");
    expect(state.turnStatus).toEqual({ status: "interrupted", canResume: true, queuedMessages: [] });

    state = sessionTimelineReducer(state, { type: "approval_resolved", requestId: "approval-1" });
    state = sessionTimelineReducer(state, {
      type: "user_input_resolved",
      requestId: "question-1",
    });
    expect(state.pendingApproval).toBeNull();
    expect(state.pendingUserInput).toBeNull();
  });

  it("settles an active tool when a provider ends the turn without a completion event", () => {
    let state = sessionTimelineReducer(createSessionTimelineState(), {
      type: "tool_call_started",
      toolCall: { id: "tool-1", name: "apply_patch", status: "running", output: null },
    });

    state = sessionTimelineReducer(state, {
      type: "turn_status",
      status: { status: "completed", canResume: false, queuedMessages: [] },
    });

    expect(state.activeTools).toEqual([
      { id: "tool-1", name: "apply_patch", status: "complete", output: "" },
    ]);
  });
});
