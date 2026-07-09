import { describe, expect, it, vi } from "vitest";

import {
  assistantIssueTopic,
  assistantThreadTopic,
  assistantTopic,
  bindAssistantEvents,
  clearAuthoringGoal,
  isTerminalTurnStatus,
  killTool,
  normalizeGoalStatus,
  normalizeTurnStatus,
  pauseAuthoringGoal,
  readLastTurn,
  requestGoalStatus,
  requestHistorySync,
  resumeAuthoringGoal,
  resumeTurn,
  setAuthoringGoalObjective,
  stopTurn,
} from "../assistantChannel";

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
    expect(onHistoryLoaded).toHaveBeenCalledWith([expect.objectContaining({ id: "1", role: "user", content: "Oi" })]);
    expect(onMessageCreated).toHaveBeenCalledWith(expect.objectContaining({ role: "user", content: "Oi" }));
    expect(onAssistantDelta).toHaveBeenCalledWith("Olá");
    expect(onToolCallStarted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "running" }));
    expect(onToolCallCompleted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "complete" }));
    expect(onAssistantCompleted).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", content: "Olá!" }));
    expect(onAssistantError).toHaveBeenCalledWith("Codex unavailable");
    expect(onAssistantDocumentChanged).toHaveBeenCalledWith({ identifier: "MAC-1" });
    expect(onAssistantDocumentChanged).toHaveBeenCalledWith({ threadId: 7006 });
    expect(onAssistantIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-7", threadId: 42 });
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

describe("authoring goal channel", () => {
  it("normalizes goal_status payloads and the native goal", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
    const onGoalStatus = vi.fn();
    const onGoalRunning = vi.fn();

    bindAssistantEvents(channel, {
      onHistoryLoaded: vi.fn(),
      onMessageCreated: vi.fn(),
      onAssistantDelta: vi.fn(),
      onToolCallStarted: vi.fn(),
      onToolCallCompleted: vi.fn(),
      onAssistantCompleted: vi.fn(),
      onAssistantError: vi.fn(),
      onGoalStatus,
      onGoalRunning,
    });

    handlers["goal_status"]({
      enabled: true,
      objective: "Audit the admin UI",
      native: true,
      goal: { kind: "goal", source: "native", status: "paused", timeUsedSeconds: 73, token_budget: 200000 },
      running: false,
    });
    handlers["goal_running"]({ running: true });

    expect(onGoalStatus).toHaveBeenCalledWith({
      enabled: true,
      objective: "Audit the admin UI",
      native: true,
      goal: expect.objectContaining({ status: "paused", timeUsedSeconds: 73, tokenBudget: 200000 }),
      running: false,
    });
    expect(onGoalRunning).toHaveBeenCalledWith(true);
  });

  it("treats a blank objective and missing goal as empty", () => {
    const status = normalizeGoalStatus({ enabled: true, objective: "  ", native: false, goal: null });
    expect(status).toEqual({ enabled: true, objective: null, native: false, goal: null, running: false });
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

    handlers["turn_status"]({ status: "interrupted", session_id: "ct-tn", can_resume: true });

    expect(onTurnStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "interrupted", sessionId: "ct-tn", canResume: true }),
    );
  });

  it("normalizes a turn_status payload and falls back for missing fields", () => {
    expect(
      normalizeTurnStatus({
        status: "running",
        session_id: "ct-1",
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
      sessionId: "ct-1",
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
      sessionId: null,
      startedAt: null,
      finishedAt: null,
      canResume: false,
      activeTools: [],
      lastActivityAt: null,
    });
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
    });

    expect(onHistorySynced).toHaveBeenCalledWith([
      expect.objectContaining({ role: "assistant", content: "synced" }),
    ]);
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
