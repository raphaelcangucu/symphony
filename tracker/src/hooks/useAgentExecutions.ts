import { useCallback, useEffect, useRef, useState } from "react";

import { listAgentExecutions } from "@/services/agentExecutions";
import type { AgentExecution } from "@/types/agent-execution";

const DEFAULT_INTERVAL_MS = 5_000;

interface UseAgentExecutionsArgs {
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseAgentExecutionsResult {
  executions: ReadonlyMap<string, AgentExecution>;
  refetch: () => Promise<void>;
}

/**
 * Polls agent execution status silently and exposes it keyed by issue
 * identifier. Updates never toggle a loading flag, so consumers re-render only
 * the affected status badges without flashing the board.
 */
export function useAgentExecutions({
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseAgentExecutionsArgs = {}): UseAgentExecutionsResult {
  const [executions, setExecutions] = useState<ReadonlyMap<string, AgentExecution>>(new Map());
  const inFlightRef = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const items = await listAgentExecutions();
      setExecutions(new Map(items.map((item) => [item.issueIdentifier, item])));
    } catch {
      /* Agent status is best-effort; keep the last known state on failure. */
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setExecutions(new Map());
      return undefined;
    }

    void refetch();

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const tick = () => {
      if (!isHidden()) void refetch();
    };

    const timer = setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (!isHidden()) void refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, refetch]);

  return { executions, refetch };
}
