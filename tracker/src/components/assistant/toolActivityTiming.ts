import type { AssistantChatMessage } from "@/services/assistant";

export interface ToolActivityTiming {
  startedAt: number;
  durationMs: number | null;
}

export type ToolActivityTimings = Readonly<Record<string, ToolActivityTiming>>;

interface ReconcileToolActivityTimingsInput {
  activeTool: { id: string; startedAt: number | null } | null;
  messages: readonly AssistantChatMessage[];
  turnStartedAt: number | null;
  nowMs: number;
}

export function reconcileToolActivityTimings(
  current: ToolActivityTimings,
  {
    activeTool,
    messages,
    turnStartedAt,
    nowMs,
  }: ReconcileToolActivityTimingsInput,
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

  if (activeTool && !current[activeTool.id]) {
    update(activeTool.id, {
      startedAt: activeTool.startedAt ?? turnStartedAt ?? nowMs,
      durationMs: null,
    });
  }

  for (const message of messages) {
    for (const call of message.toolCalls) {
      if (!call.id || call.status === "running") continue;
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
