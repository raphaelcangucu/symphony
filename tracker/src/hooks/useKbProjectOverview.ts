import { useCallback, useEffect, useRef, useState } from "react";
import type { KbProjectOverview } from "@/types/knowledgeBase";
import { getProjectOverview } from "@/services/knowledgeBase";

export interface UseKbProjectOverviewResult {
  overview: KbProjectOverview | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useKbProjectOverview(projectSlug: string): UseKbProjectOverviewResult {
  const [overview, setOverview] = useState<KbProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getProjectOverview(projectSlug);
      if (requestId === requestIdRef.current) setOverview(result);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { overview, loading, error, reload };
}
