import { describe, expect, it, vi } from "vitest";

import { assistantThreadTopic, assistantTopic, bindAssistantEvents } from "../assistantChannel";

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

describe("assistant channel binding", () => {
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

    bindAssistantEvents(channel, {
      onHistoryLoaded,
      onMessageCreated,
      onAssistantDelta,
      onToolCallStarted,
      onToolCallCompleted,
      onAssistantCompleted,
      onAssistantError,
      onAssistantDocumentChanged,
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

    expect(assistantTopic("macro-markets")).toBe("assistant:macro-markets");
    expect(onHistoryLoaded).toHaveBeenCalledWith([expect.objectContaining({ id: "1", role: "user", content: "Oi" })]);
    expect(onMessageCreated).toHaveBeenCalledWith(expect.objectContaining({ role: "user", content: "Oi" }));
    expect(onAssistantDelta).toHaveBeenCalledWith("Olá");
    expect(onToolCallStarted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "running" }));
    expect(onToolCallCompleted).toHaveBeenCalledWith(expect.objectContaining({ name: "list_issues", status: "complete" }));
    expect(onAssistantCompleted).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", content: "Olá!" }));
    expect(onAssistantError).toHaveBeenCalledWith("Codex unavailable");
    expect(onAssistantDocumentChanged).toHaveBeenCalledWith({ identifier: "MAC-1" });
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
