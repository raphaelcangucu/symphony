import { useEffect, useRef, useState } from "react";

import { listObservability } from "@/services/observability";
import { bindObservabilityEvents, OBSERVABILITY_TOPIC } from "@/services/phoenix/observabilityChannel";
import { createTrackerSocket } from "@/services/phoenix/socket";
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

    const socket = createTrackerSocket();
    socket.connect();
    const channel = socket.channel(OBSERVABILITY_TOPIC);

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
    });

    channel.join().receive("error", (reason) => console.error("observability channel join failed", reason));

    return () => {
      active = false;
      channel.leave();
      socket.disconnect();
    };
  }, []);

  return { runtimes, loading };
}
