import type { AssistantChatMessage } from "@/services/assistant";

export interface ToolActivityTiming {
  startedAt: number;
  durationMs: number | null;
}

export type ToolActivityTimings = Readonly<Record<string, ToolActivityTiming>>;

interface ReconcileToolActivityTimingsInput {
  activeTools: readonly { id: string; startedAt: number | null }[];
  messages: readonly AssistantChatMessage[];
  nowMs: number;
}

export function reconcileToolActivityTimings(
  current: ToolActivityTimings,
  { activeTools, messages, nowMs }: ReconcileToolActivityTimingsInput,
): ToolActivityTimings {
  let next = current;
  let changed = false;

  const update = (id: string, timing: ToolActivityTiming) => {
    if (!changed) {
      next = { ...current };
      changed = true;
    }
    (next as Record<string, ToolActivityTiming>)[id] = timing;
  };

  for (const activeTool of activeTools) {
    if (!next[activeTool.id]) {
      update(activeTool.id, {
        startedAt: activeTool.startedAt ?? nowMs,
        durationMs: null,
      });
    }
  }

  for (const message of messages) {
    for (const call of message.toolCalls) {
      if (!call.id) continue;
      if (call.status === "running") {
        if (!next[call.id]) {
          update(call.id, { startedAt: nowMs, durationMs: null });
        }
        continue;
      }
      const timing = next[call.id];
      if (!timing || timing.durationMs != null) continue;
      update(call.id, {
        ...timing,
        durationMs: Math.max(0, nowMs - timing.startedAt),
      });
    }
  }

  return next;
}
