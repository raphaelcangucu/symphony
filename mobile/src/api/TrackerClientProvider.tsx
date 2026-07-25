import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useConnection } from "@/auth/ConnectionProvider";
import { HostConnectionManager, type HostConnectionStatus } from "@/rpc/host-connection-manager";
import { LegacyHostTransport } from "@/transport/LegacyHostTransport";
import { RpcHostTransport } from "@/transport/RpcHostTransport";
import type { HostTransport } from "@/transport/HostTransport";
import { RpcClient } from "@/rpc/client";
import type { HandshakeState } from "@/rpc/handshake";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";

import { createTrackerClient } from "./client";
import type { TrackerClient } from "./contracts";
import { HostTransportContextProvider, type HostTransportState } from "./HostTransportContext";
import { createRpcTrackerClient } from "./rpc-tracker-client";

type TrackerClientProviderProps = {
  children: ReactNode;
  createClient?: typeof createTrackerClient;
  createTransport?: (hostId: string, client: TrackerClient) => HostTransport;
  locale?: string;
};

const TrackerClientContext = createContext<TrackerClient | null>(null);

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
      let rpcTransport: RpcHostTransport | null = null;
      let manager: HostConnectionManager | null = null;
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
            if (status === "online") manager?.markOnline(hostId);
            setRpcState({ hostId, status, error: null });
          },
          onOnline: () => {
            manager?.markOnline(hostId);
            void rpcTransport?.handleOnline().catch((error: unknown) => {
              rpcTransport?.handleDisconnect();
              manager?.markFailure(hostId, "offline");
              setRpcState({
                hostId,
                status: "offline",
                error: errorMessage(error),
              });
            });
          },
          onError: (error) => {
            const terminalStatus = terminalHandshakeState(latestState);
            const status = terminalStatus ?? "offline";
            if (terminalStatus) rpcTransport?.close();
            else rpcTransport?.handleDisconnect();
            manager?.markFailure(hostId, status);
            setRpcState({
              hostId,
              status,
              error: error.message,
            });
          },
        },
      );
      const rpc = new RpcClient(adapter, { createId: createRpcId });
      rpcTransport = new RpcHostTransport(activeProfile.hostId, rpc, {
        reconnect: () => adapter.connect(),
        close: () => adapter.close(),
      });
      manager = new HostConnectionManager();
      manager.register({
        hostId,
        endpoint: activeProfile.endpoint,
        fingerprint: activeHostCredential.hostPublicKey,
        protocolVersion: 1,
        transport: rpcTransport,
      });
      manager.select(hostId);
      const activeManager = manager;
      return {
        hostId,
        call: <TResult,>(method: string, params: unknown, signal?: AbortSignal) =>
          activeManager.call<TResult>(method, params, signal),
        subscribe: <TEvent,>(
          method: string,
          params: unknown,
          onEvent: (event: TEvent, eventName?: string) => void,
        ) => activeManager.subscribe(method, params, onEvent),
        reconnect: () => {
          activeManager.startHeartbeat();
          activeManager.onNetworkReachable();
        },
        deactivate: () => rpcTransport?.deactivate(),
        close: () => activeManager.close(),
      } satisfies HostTransport;
    }
    return client ? createTransport(activeProfile.id, client) : null;
  }, [activeHostCredential, activeProfile, client, createTransport]);

  useEffect(() => {
    if (activeProfile?.transport === "rpc") transport?.reconnect();
    const appStateSubscription =
      activeProfile?.transport === "rpc"
        ? AppState.addEventListener("change", (state) => {
            if (state === "active") transport?.reconnect();
          })
        : null;
    return () => {
      appStateSubscription?.remove();
      transport?.close();
    };
  }, [activeProfile?.transport, transport]);

  const trackerClient = useMemo(
    () =>
      activeProfile?.transport === "rpc" && transport ? createRpcTrackerClient(transport) : client,
    [activeProfile?.transport, client, transport],
  );
  const transportState =
    activeProfile?.transport === "rpc" && activeProfile.hostId
      ? rpcState?.hostId === activeProfile.hostId
        ? rpcState
        : { hostId: activeProfile.hostId, status: "connecting" as const, error: null }
      : null;

  return (
    <HostTransportContextProvider state={transportState} transport={transport}>
      <TrackerClientContext.Provider value={trackerClient}>
        {children}
      </TrackerClientContext.Provider>
    </HostTransportContextProvider>
  );
}

export function useTrackerClient(): TrackerClient | null {
  return useContext(TrackerClientContext);
}

function createLegacyTransport(hostId: string, client: TrackerClient): HostTransport {
  return new LegacyHostTransport(hostId, client);
}

export { useHostTransport, useHostTransportState } from "./HostTransportContext";
export type { HostTransportState } from "./HostTransportContext";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to restore Symphony RPC streams";
}

function terminalHandshakeState(
  state: HandshakeState,
): Extract<HostConnectionStatus, "revoked" | "host_key_mismatch" | "protocol_incompatible"> | null {
  return state === "revoked" || state === "host_key_mismatch" || state === "protocol_incompatible"
    ? state
    : null;
}
