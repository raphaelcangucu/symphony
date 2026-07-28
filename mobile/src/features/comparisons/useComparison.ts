import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { HostTransport } from "@/transport/HostTransport";

import type {
  ComparisonCellId,
  ComparisonDecisionInput,
  ComparisonSnapshot,
} from "./comparison-contract";
import { createRpcComparison, type ComparisonConnectionState } from "./rpc-comparison";

export function comparisonQueryKey(hostId: string, projectSlug: string, identifier: string) {
  return ["host", hostId, "comparison", projectSlug, identifier] as const;
}

export function useComparison({
  transport,
  projectSlug,
  identifier,
}: {
  transport: HostTransport | null;
  projectSlug: string;
  identifier: string;
}) {
  const queryClient = useQueryClient();
  const hostId = transport?.hostId ?? "unavailable";
  const queryKey = useMemo(
    () => comparisonQueryKey(hostId, projectSlug, identifier),
    [hostId, identifier, projectSlug],
  );
  const cachedSnapshot = useQuery<ComparisonSnapshot>({
    queryKey,
    queryFn: () => Promise.reject(new Error("Comparison snapshots are populated over RPC")),
    enabled: false,
  });
  const snapshot = cachedSnapshot.data ?? null;
  const [connectionState, setConnectionState] = useState<ComparisonConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const onSnapshot = useCallback(
    (next: ComparisonSnapshot) => {
      queryClient.setQueryData(queryKey, next);
    },
    [queryClient, queryKey],
  );

  const client = useMemo(
    () =>
      transport
        ? createRpcComparison({
            transport,
            projectSlug,
            identifier,
            onSnapshot,
            onConnection: setConnectionState,
            onError: setError,
          })
        : null,
    [identifier, onSnapshot, projectSlug, transport],
  );

  useEffect(() => {
    client?.connect();
    return () => client?.disconnect();
  }, [client]);

  const start = useCallback(
    async (requestKey: string, signal?: AbortSignal) => {
      if (!client) throw new Error("Symphony host is offline");
      return client.start(requestKey, signal);
    },
    [client],
  );

  const retryCell = useCallback(
    async (cellId: ComparisonCellId, requestKey: string, signal?: AbortSignal) => {
      if (!client) throw new Error("Symphony host is offline");
      return client.retryCell(cellId, requestKey, signal);
    },
    [client],
  );
  const saveDecision = useCallback(
    async (decision: ComparisonDecisionInput, signal?: AbortSignal) => {
      if (!client) throw new Error("Symphony host is offline");
      return client.saveDecision(decision, signal);
    },
    [client],
  );
  const effectiveConnectionState = transport ? connectionState : ("offline" as const);

  return {
    snapshot,
    connectionState: effectiveConnectionState,
    error,
    start,
    retryCell,
    saveDecision,
    reconnect: () => client?.reconnect(),
    cached: effectiveConnectionState === "offline" && snapshot !== null,
  };
}
