import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { LegacyHostTransport } from "@/transport/LegacyHostTransport";
import { RpcHostTransport } from "@/transport/RpcHostTransport";
import type { HostTransport } from "@/transport/HostTransport";
import { RpcClient } from "@/rpc/client";
import type { HandshakeState } from "@/rpc/handshake";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";

import { createTrackerClient } from "./client";
import type { TrackerClient } from "./contracts";

type TrackerClientProviderProps = {
  children: ReactNode;
  createClient?: typeof createTrackerClient;
  createTransport?: (hostId: string, client: TrackerClient) => HostTransport;
  locale?: string;
};

const TrackerClientContext = createContext<TrackerClient | null>(null);
const HostTransportContext = createContext<HostTransport | null>(null);
export type HostTransportState = {
  hostId: string;
  status: HandshakeState | "offline";
  error: string | null;
};
const HostTransportStateContext = createContext<HostTransportState | null>(null);

export function TrackerClientProvider({
  children,
  createClient = createTrackerClient,
  createTransport = createLegacyTransport,
  locale = resolvedLocale(),
}: TrackerClientProviderProps) {
  const { activeHostCredential, activeProfile, activeToken } = useConnection();
  const [rpcState, setRpcState] = useState<HostTransportState | null>(null);
  const client = useMemo(
    () =>
      activeProfile && activeToken && activeProfile.transport !== "rpc"
        ? createClient({
            origin: activeProfile.origin,
            token: activeToken,
            locale,
          })
        : null,
    [activeProfile, activeToken, createClient, locale],
  );
  const transport = useMemo(() => {
    if (!activeProfile) return null;
    if (
      activeProfile.transport === "rpc" &&
      activeProfile.hostId &&
      activeProfile.endpoint &&
      activeHostCredential
    ) {
      const hostId = activeProfile.hostId;
      let latestState: HandshakeState = "connecting";
      const adapter = new HandshakeWebSocketAdapter(
        {
          v: 1,
          endpoint: activeProfile.endpoint,
          hostId: activeProfile.hostId,
          hostName: activeProfile.name,
          hostPublicKey: activeHostCredential.hostPublicKey,
          deviceId: activeHostCredential.deviceId,
          deviceToken: activeHostCredential.deviceToken,
          scope: "mobile",
          protocolMin: 1,
          protocolMax: 1,
        },
        {
          onStateChange: (status) => {
            latestState = status;
            setRpcState({ hostId, status, error: null });
          },
          onOnline: () => undefined,
          onError: (error) => {
            const terminal =
              latestState === "revoked" ||
              latestState === "host_key_mismatch" ||
              latestState === "protocol_incompatible";
            setRpcState({
              hostId,
              status: terminal ? latestState : "offline",
              error: error.message,
            });
          },
        },
      );
      const rpc = new RpcClient(adapter, { createId: createRpcId });
      return new RpcHostTransport(activeProfile.hostId, rpc, {
        reconnect: () => adapter.connect(),
        close: () => adapter.close(),
      });
    }
    return client ? createTransport(activeProfile.id, client) : null;
  }, [activeHostCredential, activeProfile, client, createTransport]);

  useEffect(() => {
    if (activeProfile?.transport === "rpc") transport?.reconnect();
    return () => transport?.close();
  }, [activeProfile?.transport, transport]);

  const transportState =
    activeProfile?.transport === "rpc" && activeProfile.hostId
      ? rpcState?.hostId === activeProfile.hostId
        ? rpcState
        : { hostId: activeProfile.hostId, status: "connecting" as const, error: null }
      : null;

  return (
    <HostTransportStateContext.Provider value={transportState}>
      <HostTransportContext.Provider value={transport}>
        <TrackerClientContext.Provider value={client}>{children}</TrackerClientContext.Provider>
      </HostTransportContext.Provider>
    </HostTransportStateContext.Provider>
  );
}

export function useTrackerClient(): TrackerClient | null {
  return useContext(TrackerClientContext);
}

export function useHostTransport(): HostTransport | null {
  return useContext(HostTransportContext);
}

export function useHostTransportState(): HostTransportState | null {
  return useContext(HostTransportStateContext);
}

function createLegacyTransport(hostId: string, client: TrackerClient): HostTransport {
  return new LegacyHostTransport(hostId, client);
}

function createRpcId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rpc-${Date.now().toString(36)}-${Math.random()}`;
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
