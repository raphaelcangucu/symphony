import type { Channel } from "phoenix";

import { normalizeRecentSession, type BackendRecentItemDto } from "@/services/recents";
import type { RecentSession } from "@/types/recents";

export const RECENTS_TOPIC = "recents";

export interface RecentsHandlers {
  onSnapshot: (sessions: RecentSession[]) => void;
}

function recentItems(payload: unknown): BackendRecentItemDto[] {
  if (Array.isArray(payload)) return payload as BackendRecentItemDto[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as { data?: unknown; recents?: unknown };
  if (Array.isArray(record.data)) return record.data as BackendRecentItemDto[];
  if (Array.isArray(record.recents)) return record.recents as BackendRecentItemDto[];
  return [];
}

export function bindRecentsEvents(channel: Channel, handlers: RecentsHandlers): void {
  channel.on("snapshot", (payload) => {
    handlers.onSnapshot(recentItems(payload).map(normalizeRecentSession));
  });
}
