import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { LegacyHostTransport } from "@/transport/LegacyHostTransport";
import type { HostTransport } from "@/transport/HostTransport";

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

export function TrackerClientProvider({
  children,
  createClient = createTrackerClient,
  createTransport = createLegacyTransport,
  locale = resolvedLocale(),
}: TrackerClientProviderProps) {
  const { activeProfile, activeToken } = useConnection();
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
  const transport = useMemo(
    () => (activeProfile && client ? createTransport(activeProfile.id, client) : null),
    [activeProfile, client, createTransport],
  );

  useEffect(() => () => transport?.close(), [transport]);

  return (
    <HostTransportContext.Provider value={transport}>
      <TrackerClientContext.Provider value={client}>{children}</TrackerClientContext.Provider>
    </HostTransportContext.Provider>
  );
}

export function useTrackerClient(): TrackerClient | null {
  return useContext(TrackerClientContext);
}

export function useHostTransport(): HostTransport | null {
  return useContext(HostTransportContext);
}

function createLegacyTransport(hostId: string, client: TrackerClient): HostTransport {
  return new LegacyHostTransport(hostId, client);
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
