import { describe, expect, it, vi } from "vitest";

import {
  assistantIssueTopic,
  assistantThreadTopic,
  assistantTopic,
  bindAssistantEvents,
  clearAuthoringGoal,
  fetchToolOutput,
  isTerminalTurnStatus,
  killTool,
  loadOlderMessages,
  normalizeGoalStatus,
  normalizeAssistantError,
  normalizeTurnStatus,
  pauseAuthoringGoal,
  readGoalStatus,
  readAgentCapabilities,
  readLastTurn,
  requestGoalStatus,
  requestHistorySync,
  resumeAuthoringGoal,
  resumeTurn,
  dismissInterruptedTurn,
  setAuthoringGoalObjective,
  shouldAcceptGoalStatus,
  stopTurn,
} from "../assistantChannel";

function mockReceiveChannel() {
  const responders: Record<string, (payload: unknown) => void> = {};
  const chain = {
    receive: (status: string, callback: (payload: unknown) => void) => {
      responders[status] = callback;
      return chain;
    },
  };
  const push = vi.fn(() => chain);
  return { channel: { push } as never, push, responders };
}

describe("assistantThreadTopic", () => {
  it("builds a thread topic from a numeric id", () => {
    expect(assistantThreadTopic(7)).toBe("assistant:thread:7");
  });
  it("builds a thread topic from a string id", () => {
    expect(assistantThreadTopic("7")).toBe("assistant:thread:7");
  });
  it("rejects an empty id", () => {
    expect(() => assistantThreadTopic("")).toThrow();
  });
});

describe("assistantTopic", () => {
  it("still builds a project topic", () => {
    expect(assistantTopic("demo")).toBe("assistant:demo");
  });
});

describe("assistantIssueTopic", () => {
  it("builds an encoded issue assistant topic", () => {
    expect(assistantIssueTopic("macro-markets", "MAC-1")).toBe("assistant:issue:macro-markets:MAC-1");
    expect(assistantIssueTopic("a/b c", "#508")).toBe("assistant:issue:a%2Fb%20c:%23508");
  });

  it("rejects empty issue topic parts", () => {
    expect(() => assistantIssueTopic(" ", "MAC-1")).toThrow("projectSlug is required");
    expect(() => assistantIssueTopic("macro", " ")).toThrow("identifier is required");
  });
});

describe("assistant channel binding", () => {
  it("forwards last_turn from history_loaded to onTurnStatus", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onTurnStatus = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onTurnStatus,
    });

    handlers["history_loaded"]({
      messages: [],
      last_turn: { status: "interrupted", can_resume: true },
    });

    expect(onTurnStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "interrupted", canResume: true }),
    );
  });

  it("normalizes history, streaming deltas, tool calls, completion, and errors", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;

    const onHistoryLoaded = vi.fn();
    const onMessageCreated = vi.fn();
    const onAssistantDelta = vi.fn();
    const onToolCallStarted = vi.fn();
    const onToolCallCompleted = vi.fn();
    const onAssistantCompleted = vi.fn();
    const onAssistantError = vi.fn();
    const onAssistantDocumentChanged = vi.fn();
    const onAssistantIssueCreated = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded,
      onMessageCreated,
      onAssistantDelta,
      onToolCallStarted,
      onToolCallCompleted,
      onAssistantCompleted,
      onAssistantError,
      onAssistantDocumentChanged,
      onAssistantIssueCreated,
    });

    handlers["history_loaded"]({
      messages: [{ id: 1, role: "user", content: "Oi", tool_calls: [], inserted_at: "2026-05-30T20:00:00Z" }],
    });
    handlers["message_created"]({ message: { role: "user", content: "Oi" } });
    handlers["assistant_delta"]({ delta: "Olá" });
    handlers["tool_call_started"]({ tool_call: { name: "list_issues", status: "running", result: {} } });
    handlers["tool_call_completed"]({ tool_call: { name: "list_issues", status: "complete", result: { issues: [] } } });
    handlers["assistant_completed"]({ message: { role: "assistant", content: "Olá!", tool_calls: [] } });
    handlers["assistant_error"]({ message: "Codex unavailable" });
    handlers["assistant_document_changed"]({ identifier: "MAC-1" });
    handlers["assistant_document_changed"]({ thread_id: 7006 });
    handlers["assistant_issue_created"]({ identifier: "MAC-7", thread_id: 42 });

    expect(assistantTopic("macro-markets")).toBe("assistant:macro-markets");
    expect(onHistoryLoaded).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "1", role: "user", content: "Oi" })],
      expect.objectContaining({
        executionMode: null,
        skillProfile: null,
        scope: null,
        threadId: null,
      }),
    );
    expect(onMessageCreated).toHaveBeenCalledWith(expect.objectContaining({ role: "user", content: "Oi" }));
    expect(onAssistantDelta).toHaveBeenCalledWith("Olá");
    expect(onToolCallStarted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "running" }));
    expect(onToolCallCompleted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "complete" }));
    expect(onAssistantCompleted).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", content: "Olá!" }));
    expect(onAssistantError).toHaveBeenCalledWith("Invalid assistant error payload.", {
      code: "invalid_error_payload",
      category: "protocol",
      retryable: false,
      message: "Invalid assistant error payload.",
      details: {},
    });
    expect(onAssistantDocumentChanged).toHaveBeenCalledWith({ identifier: "MAC-1" });
    expect(onAssistantDocumentChanged).toHaveBeenCalledWith({ threadId: 7006 });
    expect(onAssistantIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-7", threadId: 42 });
  });

  it("forwards stable structured assistant errors without breaking the message callback", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onAssistantError = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError,
    });

    handlers["assistant_error"]({
      code: "provider_disconnected",
      category: "provider",
      retryable: true,
      message: "Provider disconnected",
      details: { provider: "claude" },
    });

    expect(onAssistantError).toHaveBeenCalledWith("Provider disconnected", {
      code: "provider_disconnected",
      category: "provider",
      retryable: true,
      message: "Provider disconnected",
      details: { provider: "claude" },
    });
  });

  it("forwards steer failures with canonical code and prompt fields", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onSteerFailed = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onSteerFailed,
    });

    handlers["steer_failed"]({
      code: "active_turn_not_steerable",
      prompt: "prefer the simpler fix",
    });

    expect(onSteerFailed).toHaveBeenCalledWith({
      code: "active_turn_not_steerable",
      prompt: "prefer the simpler fix",
    });
  });

  it("normalizes user_input_required questions", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onUserInputRequired = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onUserInputRequired,
    });

    handlers["user_input_required"]({
      request_id: 112,
      questions: [
        {
          id: "q1",
          header: "Pick one",
          question: "How?",
          isOther: false,
          isSecret: false,
          options: [{ label: "A", description: "first" }],
        },
      ],
    });

    expect(onUserInputRequired).toHaveBeenCalledWith({
      requestId: 112,
      questions: [
        {
          id: "q1",
          header: "Pick one",
          question: "How?",
          isOther: false,
          isSecret: false,
          options: [{ label: "A", description: "first" }],
        },
      ],
    });
  });

  it("does not emit document-change callbacks for malformed payloads", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onAssistantDocumentChanged = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onAssistantDocumentChanged,
    });

    handlers["assistant_document_changed"]({});
    handlers["assistant_document_changed"]({ identifier: " " });

    expect(onAssistantDocumentChanged).not.toHaveBeenCalled();
  });

  it("fails fast for blank project slugs", () => {
    expect(() => assistantTopic(" ")).toThrow("projectSlug is required");
  });
});

describe("provider capabilities", () => {
  it("normalizes backend capabilities exposed by the join payload", () => {
    expect(
      readAgentCapabilities({
        agent_capabilities: {
          provider: "codex",
          resume: true,
          interrupt: true,
          steer: true,
          native_goal: true,
          model_selection: true,
          reasoning_effort: true,
          multi_agent: true,
        },
      }),
    ).toEqual({
      provider: "codex",
      resume: true,
      interrupt: true,
      steer: true,
      nativeGoal: true,
      modelSelection: true,
      reasoningEffort: true,
      multiAgent: true,
    });

    expect(readAgentCapabilities({ agent_capabilities: {} })).toBeNull();
  });

  it("rejects malformed structured errors", () => {
    expect(normalizeAssistantError({ message: "missing machine fields" })).toBeNull();
  });
});

describe("authoring goal channel", () => {
  it("normalizes goal_status payloads and the native goal", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onGoalStatus = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onGoalStatus,
    });

    handlers["goal_status"]({
      thread_id: 17,
      enabled: true,
      objective: "Audit the admin UI",
      native: true,
      status: "paused",
      provider: "codex",
      source: "native",
      capabilities: ["resume", "edit", "resume", " "],
      goal: {
        kind: "goal",
        source: "native",
        status: "paused",
        time_used_seconds: 73,
        token_budget: 200000,
        revision: "11",
      },
      process_running: false,
      process_started_at: "2026-07-13T12:00:00Z",
      process_elapsed_seconds: 73,
      resumable: true,
      interrupted: false,
      revision: "11",
      request_order: 8,
      event_order: 7,
      updated_at: "2026-07-13T12:01:13Z",
    });

    expect(onGoalStatus).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 17,
      enabled: true,
      objective: "Audit the admin UI",
      native: true,
      status: "paused",
      provider: "codex",
      source: "native",
      capabilities: ["resume", "edit"],
      goal: expect.objectContaining({
        status: "paused",
        timeUsedSeconds: 73,
        tokenBudget: 200000,
        revision: "11",
      }),
      processRunning: false,
      processElapsedSeconds: 73,
      resumable: true,
      revision: "11",
      requestOrder: 8,
      eventOrder: 7,
      running: false,
    }));
  });

  it("treats a blank objective and missing goal as empty", () => {
    const status = normalizeGoalStatus({ enabled: true, objective: "  ", native: false, goal: null });
    expect(status).toMatchObject({
      enabled: true,
      objective: null,
      native: false,
      status: null,
      provider: null,
      source: null,
      capabilities: [],
      goal: null,
      processRunning: false,
      revision: null,
      requestOrder: null,
      eventOrder: null,
      running: false,
    });
  });

  it("reads the complete goal snapshot nested in join payloads", () => {
    expect(
      readGoalStatus({
        goal_status: {
          thread_id: "22",
          enabled: true,
          status: "running",
          provider: "claude",
          capabilities: ["stop", "pause"],
          revision: "91",
          request_order: 14,
        },
      }),
    ).toMatchObject({
      threadId: 22,
      enabled: true,
      status: "running",
      provider: "claude",
      capabilities: ["stop", "pause"],
      revision: "91",
      requestOrder: 14,
    });
  });

  it("pushes goal control intents with empty payloads", () => {
    const push = vi.fn();
    const channel = { push } as never;

    requestGoalStatus(channel);
    pauseAuthoringGoal(channel);
    resumeAuthoringGoal(channel);
    clearAuthoringGoal(channel);
    setAuthoringGoalObjective(channel, "Finish the spec");

    expect(push).toHaveBeenCalledWith("goal_status", {});
    expect(push).toHaveBeenCalledWith("goal_pause", {});
    expect(push).toHaveBeenCalledWith("goal_resume", {});
    expect(push).toHaveBeenCalledWith("goal_clear", {});
    expect(push).toHaveBeenCalledWith("goal_set_objective", { objective: "Finish the spec" });
  });
});

describe("goal status ordering", () => {
  it("accepts newer durable revisions and rejects stale or cross-thread events", () => {
    const current = normalizeGoalStatus({
      thread_id: 7,
      enabled: true,
      revision: "10",
      request_order: 5,
    });

    expect(
      shouldAcceptGoalStatus(
        normalizeGoalStatus({ thread_id: 7, enabled: true, revision: "11", request_order: 1 }),
        current,
      ),
    ).toBe(true);
    expect(
      shouldAcceptGoalStatus(
        normalizeGoalStatus({ thread_id: 7, enabled: true, revision: "9", request_order: 99 }),
        current,
      ),
    ).toBe(false);
    expect(
      shouldAcceptGoalStatus(
        normalizeGoalStatus({ thread_id: 8, enabled: true, revision: "12", request_order: 99 }),
        current,
      ),
    ).toBe(false);
  });

  it("uses request order only when durable revisions are equal", () => {
    const current = normalizeGoalStatus({
      thread_id: 7,
      enabled: true,
      revision: "10",
      request_order: 5,
    });

    expect(
      shouldAcceptGoalStatus(
        normalizeGoalStatus({ thread_id: 7, enabled: true, revision: "10", request_order: 6 }),
        current,
      ),
    ).toBe(true);
    expect(
      shouldAcceptGoalStatus(
        normalizeGoalStatus({ thread_id: 7, enabled: true, revision: "10", request_order: 4 }),
        current,
      ),
    ).toBe(false);
  });

  it("applies the same comparator to channel events and control replies", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = {
      on: (event: string, callback: (payload: unknown) => void) => {
        handlers[event] = callback;
      },
    } as never;
    const onGoalStatus = vi.fn();
    const acceptControlReply = bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onGoalStatus,
    });

    handlers["goal_status"]({ thread_id: 7, enabled: true, revision: "20", request_order: 3 });

    expect(
      acceptControlReply({ thread_id: 7, enabled: false, revision: "19", request_order: 99 }),
    ).toBe(false);
    expect(
      acceptControlReply({ thread_id: 7, enabled: false, revision: "20", request_order: 4 }),
    ).toBe(true);
    expect(onGoalStatus).toHaveBeenCalledTimes(2);
    expect(onGoalStatus).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe("turn status channel", () => {
  it("invokes onTurnStatus when the channel pushes turn_status", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onTurnStatus = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onTurnStatus,
    });

    handlers["turn_status"]({
      status: "interrupted",
      provider: "codex",
      conversation_id: "ct-tn",
      run_id: "run-tn",
      execution_id: "execution-tn",
      can_resume: true,
    });

    expect(onTurnStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "interrupted",
        provider: "codex",
        conversationId: "ct-tn",
        runId: "run-tn",
        executionId: "execution-tn",
        canResume: true,
      }),
    );
  });

  it("normalizes a turn_status payload and falls back for missing fields", () => {
    expect(
      normalizeTurnStatus({
        status: "running",
        provider: "codex",
        conversation_id: "ct-1",
        run_id: "run-1",
        execution_id: "execution-1",
        started_at: "2026-06-22T12:00:00Z",
        finished_at: null,
        can_resume: false,
        active_tools: [
          {
            id: "tool-1",
            name: "Bash",
            arguments_summary: "pest --parallel",
            started_at: "2026-07-09T12:00:00Z",
          },
        ],
        last_activity_at: "2026-07-09T12:01:00Z",
      }),
    ).toEqual({
      status: "running",
      provider: "codex",
      conversationId: "ct-1",
      runId: "run-1",
      executionId: "execution-1",
      queuedCount: 0,
      error: null,
      startedAt: "2026-06-22T12:00:00Z",
      finishedAt: null,
      canResume: false,
      activeTools: [
        {
          id: "tool-1",
          name: "Bash",
          argumentsSummary: "pest --parallel",
          startedAt: "2026-07-09T12:00:00Z",
        },
      ],
      lastActivityAt: "2026-07-09T12:01:00Z",
    });

    expect(normalizeTurnStatus(null)).toEqual({
      status: "unknown",
      provider: null,
      conversationId: null,
      runId: null,
      executionId: null,
      queuedCount: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
      canResume: false,
      activeTools: [],
      lastActivityAt: null,
    });
  });

  it("keeps provider-neutral run identity, durable queue count, and structured errors", () => {
    expect(
      normalizeTurnStatus({
        status: "failed",
        provider: "claude",
        conversation_id: "claude-chat-7",
        run_id: "run-7",
        execution_id: "execution-7",
        queued_count: 2,
        error: {
          code: "provider_disconnected",
          category: "provider",
          retryable: true,
          message: "The provider disconnected.",
          details: {},
        },
      }),
    ).toEqual(
      expect.objectContaining({
        provider: "claude",
        conversationId: "claude-chat-7",
        runId: "run-7",
        executionId: "execution-7",
        queuedCount: 2,
        error: {
          code: "provider_disconnected",
          category: "provider",
          retryable: true,
          message: "The provider disconnected.",
          details: {},
        },
      }),
    );
  });

  it("reads last_turn from a join payload, or null when absent", () => {
    expect(readLastTurn({ last_turn: { status: "interrupted", can_resume: true } })).toEqual(
      expect.objectContaining({ status: "interrupted", canResume: true, activeTools: [] }),
    );
    expect(readLastTurn({})).toBeNull();
    expect(readLastTurn(null)).toBeNull();
  });

  it("pushes resume_turn with an empty payload", () => {
    const push = vi.fn();
    const channel = { push } as never;

    resumeTurn(channel);

    expect(push).toHaveBeenCalledWith("resume_turn", {});
  });

  it("pushes dismiss_interrupted_turn with an empty payload", () => {
    const push = vi.fn();
    const channel = { push } as never;

    dismissInterruptedTurn(channel);

    expect(push).toHaveBeenCalledWith("dismiss_interrupted_turn", {});
  });

  it("pushes stop_turn and kill_tool", () => {
    const push = vi.fn();
    const channel = { push } as never;

    stopTurn(channel);
    killTool(channel, "tool-1");

    expect(push).toHaveBeenCalledWith("stop_turn", {});
    expect(push).toHaveBeenCalledWith("kill_tool", { tool_call_id: "tool-1" });
  });

  it("forwards history_synced to onHistorySynced", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onHistorySynced = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onHistorySynced,
    });

    handlers["history_synced"]({
      messages: [{ id: 1, role: "assistant", content: "synced", tool_calls: [] }],
      has_more_before: true,
      oldest_sequence: 5,
    });

    expect(onHistorySynced).toHaveBeenCalledWith(
      [expect.objectContaining({ role: "assistant", content: "synced" })],
      { hasMoreBefore: true, oldestSequence: 5 },
    );
  });

  it("pushes sync_history with an empty payload", () => {
    const push = vi.fn();
    const channel = { push } as never;

    requestHistorySync(channel);

    expect(push).toHaveBeenCalledWith("sync_history", {});
  });

  it("recognizes terminal turn statuses", () => {
    expect(isTerminalTurnStatus("completed")).toBe(true);
    expect(isTerminalTurnStatus("failed")).toBe(true);
    expect(isTerminalTurnStatus("interrupted")).toBe(true);
    expect(isTerminalTurnStatus("running")).toBe(false);
  });
});

describe("fetchToolOutput", () => {
  it("pushes fetch_tool_output and resolves with the full output string", async () => {
    const { channel, push, responders } = mockReceiveChannel();

    const promise = fetchToolOutput(channel, 12, " call-1 ");
    responders.ok({ output: "full output", output_byte_size: 11 });

    await expect(promise).resolves.toBe("full output");
    expect(push).toHaveBeenCalledWith("fetch_tool_output", { message_id: 12, tool_call_id: "call-1" });
  });

  it("resolves with an empty string when the payload output is missing", async () => {
    const { channel, responders } = mockReceiveChannel();

    const promise = fetchToolOutput(channel, 12, "call-1");
    responders.ok({});

    await expect(promise).resolves.toBe("");
  });

  it("rejects with the canonical server message on error", async () => {
    const { channel, responders } = mockReceiveChannel();

    const promise = fetchToolOutput(channel, 12, "call-1");
    responders.error({ message: "not found" });

    await expect(promise).rejects.toThrow("not found");
  });

  it("does not read the removed reason alias", async () => {
    const { channel, responders } = mockReceiveChannel();

    const promise = fetchToolOutput(channel, 12, "call-1");
    responders.error({ reason: "legacy error" });

    await expect(promise).rejects.toThrow("fetch_tool_output failed");
  });

  it("rejects for a blank tool call id without pushing", async () => {
    const { channel, push } = mockReceiveChannel();

    await expect(fetchToolOutput(channel, 12, "  ")).rejects.toThrow();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("loadOlderMessages", () => {
  it("pushes load_older_messages and resolves with normalized messages and page meta", async () => {
    const { channel, push, responders } = mockReceiveChannel();

    const promise = loadOlderMessages(channel, 42);
    responders.ok({
      messages: [{ id: 1, role: "user", content: "old", tool_calls: [] }],
      has_more_before: true,
      oldest_sequence: 3,
    });

    await expect(promise).resolves.toEqual({
      messages: [expect.objectContaining({ id: "1", role: "user", content: "old" })],
      hasMoreBefore: true,
      oldestSequence: 3,
    });
    expect(push).toHaveBeenCalledWith("load_older_messages", { before_sequence: 42 });
  });

  it("rejects with the canonical server message on error", async () => {
    const { channel, responders } = mockReceiveChannel();

    const promise = loadOlderMessages(channel, 42);
    responders.error({ message: "invalid cursor" });

    await expect(promise).rejects.toThrow("invalid cursor");
  });
});
