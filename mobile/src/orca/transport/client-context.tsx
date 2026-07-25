import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHostRuntime, type HostRuntimeContextValue } from "@/runtime/HostRuntimeProvider";

import { createSymphonyOrcaRpcClient, type RpcClient } from "./rpc-client";
import type { ConnectionState, HostProfile } from "./types";

type ClientContextValue = {
  client(hostId: string): RpcClient | null;
  closeHost(hostId: string): void;
  forceReconnect(hostId: string): Promise<void>;
  state(hostId: string): ConnectionState;
  reconnectAttempt(hostId: string): number;
  lastConnectedAt(hostId: string): number | null;
  subscribe(hostId: string, listener: () => void): () => void;
};

const ClientContext = createContext<ClientContextValue | null>(null);

export function RpcClientProvider({ children }: { children: ReactNode }) {
  const runtime = useHostRuntime();
  const clientsRef = useRef(new Map<string, { transport: object; client: RpcClient }>());

  const client = useCallback(
    (hostId: string): RpcClient | null => {
      const transport = runtime.transport(hostId);
      if (!transport) return null;
      const cached = clientsRef.current.get(hostId);
      if (cached?.transport === transport) return cached.client;
      const next = createSymphonyOrcaRpcClient(hostId, transport, connectionSource(runtime, hostId));
      clientsRef.current.set(hostId, { transport, client: next });
      return next;
    },
    [runtime],
  );
  const value = useMemo<ClientContextValue>(
    () => ({
      client,
      closeHost: (hostId) => runtime.transport(hostId)?.deactivate(),
      forceReconnect: async (hostId) => runtime.transport(hostId)?.reconnect(),
      state: (hostId) => connectionState(runtime.state(hostId).status),
      reconnectAttempt: (hostId) => runtime.state(hostId).reconnectAttempt,
      lastConnectedAt: (hostId) => runtime.state(hostId).lastHeartbeatAt,
      subscribe: runtime.subscribe,
    }),
    [client, runtime],
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

function useClientContext(): ClientContextValue {
  const value = useContext(ClientContext);
  if (!value) throw new Error("Orca client hooks require RpcClientProvider");
  return value;
}

export function useHostClient(hostId: string | undefined): {
  client: RpcClient | null;
  state: ConnectionState;
} {
  const context = useClientContext();
  const [, refresh] = useState(0);
  useEffect(
    () => (hostId ? context.subscribe(hostId, () => refresh((value) => value + 1)) : undefined),
    [context, hostId],
  );
  return {
    client: hostId ? context.client(hostId) : null,
    state: hostId ? context.state(hostId) : "disconnected",
  };
}

export function useAllHostClients(hostIds: string[]): Array<{
  hostId: string;
  client: RpcClient;
  state: ConnectionState;
}> {
  const context = useClientContext();
  const key = useMemo(() => [...hostIds].sort().join(","), [hostIds]);
  const [, refresh] = useState(0);
  useEffect(() => {
    const cleanups = hostIds.map((hostId) =>
      context.subscribe(hostId, () => refresh((value) => value + 1)),
    );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [context, key]);

  return hostIds.flatMap((hostId) => {
    const client = context.client(hostId);
    return client ? [{ hostId, client, state: context.state(hostId) }] : [];
  });
}

export function useCloseHost(): (hostId: string) => void {
  return useClientContext().closeHost;
}

export function useForceReconnect(): (hostId: string) => Promise<void> {
  return useClientContext().forceReconnect;
}

export function usePrimeHosts(): (hosts: HostProfile[]) => void {
  return useCallback(() => undefined, []);
}

export function useReconnectAttempt(hostId: string | undefined): number {
  const context = useClientContext();
  const [, refresh] = useState(0);
  useEffect(
    () => (hostId ? context.subscribe(hostId, () => refresh((value) => value + 1)) : undefined),
    [context, hostId],
  );
  return hostId ? context.reconnectAttempt(hostId) : 0;
}

export function useLastConnectedAt(hostId: string | undefined): number | null {
  const context = useClientContext();
  const [, refresh] = useState(0);
  useEffect(
    () => (hostId ? context.subscribe(hostId, () => refresh((value) => value + 1)) : undefined),
    [context, hostId],
  );
  return hostId ? context.lastConnectedAt(hostId) : null;
}

function connectionSource(
  runtime: HostRuntimeContextValue,
  hostId: string,
) {
  return {
    getState: () => connectionState(runtime.state(hostId).status),
    getReconnectAttempt: () => runtime.state(hostId).reconnectAttempt,
    getLastConnectedAt: () => runtime.state(hostId).lastHeartbeatAt,
    subscribe: (listener: (state: ConnectionState) => void) =>
      runtime.subscribe(hostId, () => listener(connectionState(runtime.state(hostId).status))),
  };
}

function connectionState(
  status: ReturnType<HostRuntimeContextValue["state"]>["status"],
): ConnectionState {
  if (status === "online") return "connected";
  if (status === "connecting") return "connecting";
  if (status === "reconnecting") return "reconnecting";
  if (
    status === "revoked" ||
    status === "host_key_mismatch" ||
    status === "protocol_incompatible"
  ) {
    return "auth-failed";
  }
  return "disconnected";
}
