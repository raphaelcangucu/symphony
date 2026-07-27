import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { HostTransport } from "@/transport/HostTransport";

import type { ComparisonCellId, ComparisonSnapshot } from "./comparison-contract";
import { createRpcComparison, type ComparisonConnectionState } from "./rpc-comparison";

export function comparisonQueryKey(hostId: string, projectSlug: string, identifier: string) {
  return ["comparison", hostId, projectSlug, identifier] as const;
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
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot | null>(
    () => queryClient.getQueryData<ComparisonSnapshot>(queryKey) ?? null,
  );
  const [connectionState, setConnectionState] = useState<ComparisonConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const onSnapshot = useCallback(
    (next: ComparisonSnapshot) => {
      setSnapshot(next);
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
    setSnapshot(queryClient.getQueryData<ComparisonSnapshot>(queryKey) ?? null);
  }, [queryClient, queryKey]);

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
  const effectiveConnectionState = transport ? connectionState : ("offline" as const);

  return {
    snapshot,
    connectionState: effectiveConnectionState,
    error,
    start,
    retryCell,
    reconnect: () => client?.reconnect(),
    cached: effectiveConnectionState === "offline" && snapshot !== null,
  };
}
