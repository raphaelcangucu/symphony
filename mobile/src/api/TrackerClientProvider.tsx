import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { LegacyHostTransport } from "@/transport/LegacyHostTransport";
import type { HostTransport } from "@/transport/HostTransport";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";

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
  const { activeProfile, activeToken } = useConnection();
  const hostRuntime = useHostRuntime();
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
    if (activeProfile.transport === "rpc" && activeProfile.hostId)
      return hostRuntime.transport(activeProfile.hostId);
    return client ? createTransport(activeProfile.id, client) : null;
  }, [activeProfile, client, createTransport, hostRuntime]);

  useEffect(() => {
    if (activeProfile?.transport === "rpc") return;
    return () => transport?.close();
  }, [activeProfile?.transport, transport]);

  const trackerClient = useMemo(
    () =>
      activeProfile?.transport === "rpc" && transport ? createRpcTrackerClient(transport) : client,
    [activeProfile?.transport, client, transport],
  );
  const transportState =
    activeProfile?.transport === "rpc" && activeProfile.hostId
      ? presentTransportState(activeProfile.hostId, hostRuntime)
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

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}

function presentTransportState(
  hostId: string,
  runtime: ReturnType<typeof useHostRuntime>,
): HostTransportState {
  const state = runtime.state(hostId);
  const status =
    state.status === "online"
      ? "online"
      : state.status === "revoked" ||
          state.status === "host_key_mismatch" ||
          state.status === "protocol_incompatible"
        ? state.status
        : state.status === "offline"
          ? "offline"
          : "connecting";
  return { hostId, status, error: state.error };
}
