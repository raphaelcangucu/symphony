import { useEffect, useRef, useState } from "react";

import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { listObservability } from "@/services/observability";
import { bindObservabilityEvents, OBSERVABILITY_TOPIC } from "@/services/phoenix/observabilityChannel";
import type { RuntimeObservability } from "@/types/observability";

interface UseObservabilityResult {
  runtimes: RuntimeObservability[];
  loading: boolean;
}

export function useObservability(): UseObservabilityResult {
  const [runtimes, setRuntimes] = useState<RuntimeObservability[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void listObservability()
      .then((items) => {
        if (active && requestId === requestIdRef.current)
          setRuntimes((current) => {
            const present = new Set(current.map((entry) => entry.runtimeId));
            const additions = items.filter((item) => !present.has(item.runtimeId));
            return [...current, ...additions];
          });
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  usePhoenixChannel({
    topic: OBSERVABILITY_TOPIC,
    onSetup: (channel) =>
      bindObservabilityEvents(channel, {
        onUpdated: (runtime) =>
          setRuntimes((current) => {
            const index = current.findIndex((entry) => entry.runtimeId === runtime.runtimeId);
            if (index === -1) return [...current, runtime];
            const next = current.slice();
            next[index] = runtime;
            return next;
          }),
        onRemoved: (runtimeId) =>
          setRuntimes((current) => current.filter((entry) => entry.runtimeId !== runtimeId)),
      }),
    onJoinError: (reason) => console.error("observability channel join failed", reason),
  });

  return { runtimes, loading };
}
