import { createContext, useContext, type ReactNode } from "react";

import type { HandshakeState } from "@/rpc/handshake";
import type { HostTransport } from "@/transport/HostTransport";

export type HostTransportState = {
  hostId: string;
  status: HandshakeState | "offline";
  error: string | null;
};

const HostTransportContext = createContext<HostTransport | null>(null);
const HostTransportStateContext = createContext<HostTransportState | null>(null);

export function HostTransportContextProvider({
  children,
  state,
  transport,
}: {
  children: ReactNode;
  state: HostTransportState | null;
  transport: HostTransport | null;
}) {
  return (
    <HostTransportStateContext.Provider value={state}>
      <HostTransportContext.Provider value={transport}>{children}</HostTransportContext.Provider>
    </HostTransportStateContext.Provider>
  );
}

export function useHostTransport(): HostTransport | null {
  return useContext(HostTransportContext);
}

export function useHostTransportState(): HostTransportState | null {
  return useContext(HostTransportStateContext);
}
