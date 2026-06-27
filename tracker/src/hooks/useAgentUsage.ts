import { useCallback, useEffect, useRef, useState } from "react";

import { getAgentUsage } from "@/services/agentUsage";
import type { AgentUsageMap } from "@/types/agent-usage";

export const USAGE_REFRESH_MS = 5 * 60 * 1000;

interface UseAgentUsageResult {
  usage: AgentUsageMap | null;
  isFetching: boolean;
  error: boolean;
  refetch: () => void;
}

export function useAgentUsage(refreshMs: number = USAGE_REFRESH_MS): UseAgentUsageResult {
  const [usage, setUsage] = useState<AgentUsageMap | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState(false);
  const activeRef = useRef(true);

  const load = useCallback(async () => {
    setIsFetching(true);
    try {
      const result = await getAgentUsage();
      if (!activeRef.current) return;
      setUsage(result);
      setError(false);
    } catch {
      if (activeRef.current) setError(true);
    } finally {
      if (activeRef.current) setIsFetching(false);
    }
  }, []);

  const refetch = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    activeRef.current = true;
    void load();
    const timer = window.setInterval(() => void load(), refreshMs);

    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [load, refreshMs]);

  return { usage, isFetching, error, refetch };
}
