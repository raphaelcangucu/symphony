import { useCallback, useEffect, useRef, useState } from "react";
import type { KbSyncState } from "@/types/knowledgeBase";
import { getSyncStatus, requestSync } from "@/services/knowledgeBase";

const POLL_INTERVAL_MS = 10_000;

export interface UseKbSyncResult {
  state: KbSyncState | null;
  loading: boolean;
  triggerSync: () => Promise<void>;
}

export function useKbSync(projectSlug: string, repoSlug: string | null): UseKbSyncResult {
  const [state, setState] = useState<KbSyncState | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!repoSlug) {
      setState(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await getSyncStatus(projectSlug, repoSlug);
      if (requestId === requestIdRef.current) setState(result);
    } catch {
      // Sync status is best-effort; keep the last known state on error.
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [projectSlug, repoSlug]);

  const triggerSync = useCallback(async () => {
    if (!repoSlug) return;
    await requestSync(projectSlug, repoSlug);
    await refresh();
  }, [projectSlug, repoSlug, refresh]);

  useEffect(() => {
    if (!repoSlug) return;
    void refresh();
    const handle = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [repoSlug, refresh]);

  return { state, loading, triggerSync };
}
