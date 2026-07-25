import { afterEach, describe, expect, it } from "vitest";

import type { AssistantChatMessage } from "@/services/assistant";
import type { AssistantTurnStatus } from "@/services/phoenix/assistantChannel";
import {
  MAX_CACHED_ASSISTANT_SESSIONS,
  MAX_CACHED_MESSAGES_PER_SESSION,
  clearAssistantSessionCache,
  evictAssistantSessionCache,
  getAssistantSessionSnapshot,
  preferCachedTranscript,
  putAssistantSessionSnapshot,
  resetAssistantSessionStoreForTests,
  type AssistantSessionSnapshot,
} from "@/stores/assistantSessionStore";

function message(id: string, content = id): AssistantChatMessage {
  return {
    id,
    role: "assistant",
    content,
    toolCalls: [],
    metadata: {},
  };
}

function runningTurn(toolId = "tool-1"): AssistantTurnStatus {
  return {
    status: "running",
    provider: "codex",
    conversationId: "conversation-1",
    runId: "run-1",
    executionId: "execution-1",
    queuedCount: 0,
    error: null,
    startedAt: "2026-07-17T10:00:00.000Z",
    finishedAt: null,
    canResume: false,
    activeTools: [
      {
        id: toolId,
        name: "shell",
        argumentsSummary: "yarn build",
        startedAt: "2026-07-17T10:00:01.000Z",
      },
    ],
    lastActivityAt: "2026-07-17T10:00:01.000Z",
  };
}

function snapshot(partial: Partial<AssistantSessionSnapshot> & { threadId: number }): AssistantSessionSnapshot {
  return {
    messages: [],
    turnRunning: false,
    lastTurn: null,
    historyRevealStartIndex: null,
    historyHasMoreBefore: false,
    historyOldestSequence: null,
    updatedAt: Date.now(),
    ...partial,
  };
}

afterEach(() => {
  resetAssistantSessionStoreForTests();
});

describe("assistantSessionStore", () => {
  it("round-trips a snapshot by threadId", () => {
    const entry = snapshot({
      threadId: 42,
      messages: [message("m1")],
      turnRunning: true,
      lastTurn: runningTurn(),
    });

    putAssistantSessionSnapshot(entry);

    expect(getAssistantSessionSnapshot(42)).toEqual(entry);
  });

  it("evicts a thread when the workspace tab closes", () => {
    putAssistantSessionSnapshot(snapshot({ threadId: 7, messages: [message("a")] }));
    evictAssistantSessionCache(7);
    expect(getAssistantSessionSnapshot(7)).toBeNull();
  });

  it("clears every cached session", () => {
    putAssistantSessionSnapshot(snapshot({ threadId: 1 }));
    putAssistantSessionSnapshot(snapshot({ threadId: 2 }));
    clearAssistantSessionCache();
    expect(getAssistantSessionSnapshot(1)).toBeNull();
    expect(getAssistantSessionSnapshot(2)).toBeNull();
  });

  it("evicts the least-recently-updated session when over the session cap", () => {
    for (let i = 1; i <= MAX_CACHED_ASSISTANT_SESSIONS; i += 1) {
      putAssistantSessionSnapshot(snapshot({ threadId: i, updatedAt: i }));
    }

    putAssistantSessionSnapshot(
      snapshot({ threadId: MAX_CACHED_ASSISTANT_SESSIONS + 1, updatedAt: MAX_CACHED_ASSISTANT_SESSIONS + 1 }),
    );

    expect(getAssistantSessionSnapshot(1)).toBeNull();
    expect(getAssistantSessionSnapshot(2)).not.toBeNull();
    expect(getAssistantSessionSnapshot(MAX_CACHED_ASSISTANT_SESSIONS + 1)).not.toBeNull();
  });

  it("trims the oldest messages when over the per-session message cap", () => {
    const messages = Array.from({ length: MAX_CACHED_MESSAGES_PER_SESSION + 5 }, (_, index) =>
      message(`m${index}`),
    );

    putAssistantSessionSnapshot(snapshot({ threadId: 9, messages }));

    const cached = getAssistantSessionSnapshot(9);
    expect(cached).not.toBeNull();
    expect(cached!.messages).toHaveLength(MAX_CACHED_MESSAGES_PER_SESSION);
    expect(cached!.messages[0]?.id).toBe("m5");
    expect(cached!.messages.at(-1)?.id).toBe(`m${MAX_CACHED_MESSAGES_PER_SESSION + 4}`);
  });

  it("rejects non-positive thread ids", () => {
    expect(() => putAssistantSessionSnapshot(snapshot({ threadId: 0 }))).toThrow(/threadId/i);
    expect(() => getAssistantSessionSnapshot(-1)).toThrow(/threadId/i);
    expect(() => evictAssistantSessionCache(Number.NaN)).toThrow(/threadId/i);
  });
});

describe("preferCachedTranscript", () => {
  it("prefers cache while a turn is running and cache has at least as many messages", () => {
    const cached = snapshot({
      threadId: 1,
      turnRunning: true,
      messages: [message("a"), message("b")],
      lastTurn: runningTurn(),
    });
    const server = [message("a")];

    expect(preferCachedTranscript(cached, server)).toBe(true);
  });

  it("does not prefer an idle cache over a longer server history", () => {
    const cached = snapshot({
      threadId: 1,
      turnRunning: false,
      messages: [message("a")],
    });
    const server = [message("a"), message("b")];

    expect(preferCachedTranscript(cached, server)).toBe(false);
  });

  it("does not prefer cache when server history is longer", () => {
    const cached = snapshot({
      threadId: 1,
      turnRunning: true,
      messages: [message("a")],
      lastTurn: runningTurn(),
    });
    const server = [message("a"), message("b"), message("c")];

    expect(preferCachedTranscript(cached, server)).toBe(false);
  });
});
