import { useCallback } from "react";

import { useRecentsContext } from "@/hooks/RecentsProvider";
import type { RecentSession } from "@/types/recents";

interface UseRecentsArgs {
  enabled?: boolean;
  intervalMs?: number;
  limit?: number;
}

export interface UseRecentsResult {
  sessions: RecentSession[];
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Reads the layout-level recents snapshot.
 *
 * Legacy arguments are intentionally ignored: only RecentsProvider owns the
 * channel lifecycle, so consumers cannot create another request loop.
 */
export function useRecents(_args: UseRecentsArgs = {}): UseRecentsResult {
  const { sessions, loading } = useRecentsContext();
  const refetch = useCallback(async () => undefined, []);
  return { sessions: [...sessions], loading, refetch };
}
