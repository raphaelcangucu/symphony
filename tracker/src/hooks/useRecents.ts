import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { listRecents } from "@/services/recents";
import type { RecentSession } from "@/types/recents";

const DEFAULT_INTERVAL_MS = 8_000;
const DEFAULT_LIMIT = 20;

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
 * Polls the recents feed focus-aware so the sidebar stays current while the
 * window is in view, and pauses ongoing polling while it is blurred or hidden.
 * The initial load runs regardless of focus so a background tab still resolves
 * its loading state instead of spinning forever.
 */
export function useRecents({
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
  limit = DEFAULT_LIMIT,
}: UseRecentsArgs = {}): UseRecentsResult {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const refetch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const items = await listRecents(limit);
      setSessions(items);
    } catch {
      /* Recents are best-effort; keep the last known state on failure. */
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (!enabled) {
      setSessions([]);
      setLoading(false);
      return undefined;
    }

    void refetch();

    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, refetch]);

  useEffect(() => {
    if (!enabled || !focused) return;
    void refetch();
  }, [enabled, focused, refetch]);

  return { sessions, loading, refetch };
}
