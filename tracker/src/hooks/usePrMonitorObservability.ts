import { useEffect, useRef, useState } from "react";

import { getPrMonitorObservability } from "@/services/observability";
import type { PrMonitorObservability } from "@/types/observability";

const POLL_INTERVAL_MS = 10_000;

interface UsePrMonitorObservabilityResult {
  data: PrMonitorObservability | null;
  loading: boolean;
}

export function usePrMonitorObservability(): UsePrMonitorObservabilityResult {
  const [data, setData] = useState<PrMonitorObservability | null>(null);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    const load = () =>
      getPrMonitorObservability()
        .then((result) => {
          if (activeRef.current) setData(result);
        })
        .catch(() => {
          /* keep last successful snapshot on transient failures */
        })
        .finally(() => {
          if (activeRef.current) setLoading(false);
        });

    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      window.clearInterval(interval);
    };
  }, []);

  return { data, loading };
}
