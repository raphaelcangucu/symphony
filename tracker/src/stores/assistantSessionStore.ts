import { createStore } from "zustand/vanilla";

import type { AssistantChatMessage } from "@/services/assistant";
import type { AssistantTurnStatus } from "@/services/phoenix/assistantChannel";

/** Max distinct assistant threads kept in memory at once. */
export const MAX_CACHED_ASSISTANT_SESSIONS = 8;

/** Max messages retained per thread (oldest trimmed). Keeps heap bounded. */
export const MAX_CACHED_MESSAGES_PER_SESSION = 200;

export interface AssistantSessionSnapshot {
  threadId: number;
  messages: AssistantChatMessage[];
  turnRunning: boolean;
  lastTurn: AssistantTurnStatus | null;
  historyRevealStartIndex: number | null;
  historyHasMoreBefore: boolean;
  historyOldestSequence: number | null;
  updatedAt: number;
}

interface AssistantSessionStoreState {
  byThreadId: Record<number, AssistantSessionSnapshot>;
}

const store = createStore<AssistantSessionStoreState>(() => ({
  byThreadId: {},
}));

function requirePositiveThreadId(threadId: number): number {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error(`threadId must be a positive integer, got ${String(threadId)}`);
  }
  return threadId;
}

function trimMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  if (messages.length <= MAX_CACHED_MESSAGES_PER_SESSION) return messages;
  return messages.slice(messages.length - MAX_CACHED_MESSAGES_PER_SESSION);
}

function evictOverflow(byThreadId: Record<number, AssistantSessionSnapshot>): Record<number, AssistantSessionSnapshot> {
  const entries = Object.values(byThreadId);
  if (entries.length <= MAX_CACHED_ASSISTANT_SESSIONS) return byThreadId;

  const sorted = [...entries].sort((a, b) => a.updatedAt - b.updatedAt);
  const keep = new Set(sorted.slice(entries.length - MAX_CACHED_ASSISTANT_SESSIONS).map((entry) => entry.threadId));
  const next: Record<number, AssistantSessionSnapshot> = {};
  for (const entry of entries) {
    if (keep.has(entry.threadId)) next[entry.threadId] = entry;
  }
  return next;
}

export function putAssistantSessionSnapshot(snapshot: AssistantSessionSnapshot): void {
  const threadId = requirePositiveThreadId(snapshot.threadId);
  if (!Array.isArray(snapshot.messages)) {
    throw new Error("messages must be an array");
  }

  const nextEntry: AssistantSessionSnapshot = {
    ...snapshot,
    threadId,
    messages: trimMessages(snapshot.messages),
    updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : Date.now(),
  };

  store.setState((state) => {
    const byThreadId = { ...state.byThreadId, [threadId]: nextEntry };
    return { byThreadId: evictOverflow(byThreadId) };
  });
}

export function getAssistantSessionSnapshot(threadId: number): AssistantSessionSnapshot | null {
  const id = requirePositiveThreadId(threadId);
  return store.getState().byThreadId[id] ?? null;
}

export function evictAssistantSessionCache(threadId: number): void {
  const id = requirePositiveThreadId(threadId);
  store.setState((state) => {
    if (!(id in state.byThreadId)) return state;
    const byThreadId = { ...state.byThreadId };
    delete byThreadId[id];
    return { byThreadId };
  });
}

export function clearAssistantSessionCache(): void {
  store.setState({ byThreadId: {} });
}

export function resetAssistantSessionStoreForTests(): void {
  clearAssistantSessionCache();
}

/**
 * Prefer the in-memory cache over a durable history page when the cache is
 * mid-turn and at least as complete — the join history often lags streaming
 * tool detail until the turn finishes or sync_history runs.
 */
export function preferCachedTranscript(
  cached: AssistantSessionSnapshot | null | undefined,
  serverMessages: AssistantChatMessage[],
): boolean {
  if (!cached) return false;
  if (!cached.turnRunning) return false;
  if (!Array.isArray(serverMessages)) {
    throw new Error("serverMessages must be an array");
  }
  return cached.messages.length >= serverMessages.length;
}
