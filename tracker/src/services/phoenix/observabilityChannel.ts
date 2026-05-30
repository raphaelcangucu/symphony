import type { Channel } from "phoenix";

import { normalizeRuntime, type BackendRuntimeDto } from "@/services/observability";
import type { RuntimeObservability } from "@/types/observability";

export const OBSERVABILITY_TOPIC = "observability:global";

export interface ObservabilityHandlers {
  onUpdated: (runtime: RuntimeObservability) => void;
  onRemoved: (runtimeId: string) => void;
}

export function bindObservabilityEvents(channel: Channel, handlers: ObservabilityHandlers): void {
  channel.on("runtime_updated", (payload) => {
    handlers.onUpdated(normalizeRuntime(payload as BackendRuntimeDto));
  });
  channel.on("runtime_removed", (payload) => {
    const runtimeId = (payload as { runtime_id?: string }).runtime_id;
    if (runtimeId) handlers.onRemoved(runtimeId);
  });
}
