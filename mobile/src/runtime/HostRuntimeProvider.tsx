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
import { AppState } from "react-native";

import { useConnection } from "@/auth/ConnectionProvider";
import type { ConnectionProfile, HostProfile } from "@/auth/connection-profile";
import type { HostCredential } from "@/auth/host-credential-storage";
import { RpcClient } from "@/rpc/client";
import {
  HostConnectionManager,
  type HostConnectionStatus,
  type HostState,
} from "@/rpc/host-connection-manager";
import type { HandshakeState } from "@/rpc/handshake";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";
import type { HostTransport } from "@/transport/HostTransport";
import { RpcHostTransport } from "@/transport/RpcHostTransport";

export type HostRuntimeState = Readonly<
  HostState & {
    hostId: string;
    error: string | null;
  }
>;

export type HostRuntimeTransportCallbacks = {
  onStatus(status: HostConnectionStatus, error?: string): void;
};

export type HostRuntimeTransportFactory = (
  profile: HostProfile,
  credential: HostCredential,
  callbacks: HostRuntimeTransportCallbacks,
) => HostTransport;

export type HostRuntimeContextValue = {
  selectedHostId: string | null;
  selectHost(hostId: string): Promise<void>;
  transport(hostId: string): HostTransport | null;
  state(hostId: string): HostRuntimeState;
  subscribe(hostId: string, listener: () => void): () => void;
};

const HostRuntimeContext = createContext<HostRuntimeContextValue | null>(null);

export function HostRuntimeProvider({
  children,
  createTransport = createEncryptedHostTransport,
}: {
  children: ReactNode;
  createTransport?: HostRuntimeTransportFactory;
}) {
  const { activeProfile, hydrated, loadHostCredential, profiles, selectProfile } =
    useConnection();
  const managerRef = useRef<HostConnectionManager | null>(null);
  if (!managerRef.current) managerRef.current = new HostConnectionManager();
  const manager = managerRef.current;
  const errorsRef = useRef(new Map<string, string | null>());
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const rpcProfiles = profiles.filter(isRpcHostProfile);

    void Promise.all(
      rpcProfiles.map(async (profile) => {
        if (manager.transport(profile.hostId)) return;
        const credential = await loadHostCredential(profile.id);
        if (cancelled || !credential) return;
        const transport = createTransport(profile, credential, {
          onStatus: (status, error) => {
            errorsRef.current.set(profile.hostId, error ?? null);
            if (status === "online") manager.markOnline(profile.hostId);
            else if (status !== "connecting") manager.markFailure(profile.hostId, status);
            refresh();
          },
        });
        if (cancelled) {
          transport.close();
          return;
        }
        manager.register({
          hostId: profile.hostId,
          endpoint: profile.endpoint,
          fingerprint: profile.hostPublicKeyFingerprint,
          protocolVersion: profile.protocolVersion,
          transport,
        });
      }),
    ).then(() => {
      if (cancelled) return;
      const retainedIds = new Set(rpcProfiles.map((profile) => profile.hostId));
      for (const hostId of manager.registeredHostIds()) {
        if (!retainedIds.has(hostId)) manager.unregister(hostId);
      }
      const selected =
        activeProfile && isRpcHostProfile(activeProfile) ? activeProfile.hostId : null;
      if (selected && manager.transport(selected)) {
        manager.select(selected);
        manager.startHeartbeat();
        manager.transport(selected)?.reconnect();
      }
      refresh();
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeProfile,
    createTransport,
    hydrated,
    loadHostCredential,
    manager,
    profiles,
    refresh,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") manager.onForeground();
    });
    return () => subscription.remove();
  }, [manager]);

  useEffect(() => () => manager.close(), [manager]);

  const selectHost = useCallback(
    async (hostId: string) => {
      const profile = profiles.find(
        (candidate) => isRpcHostProfile(candidate) && candidate.hostId === hostId,
      );
      if (!profile) throw new Error("Symphony host is not registered");
      manager.select(hostId);
      manager.transport(hostId)?.reconnect();
      await selectProfile(profile.id);
      refresh();
    },
    [manager, profiles, refresh, selectProfile],
  );
  const transport = useCallback((hostId: string) => manager.transport(hostId), [manager]);
  const state = useCallback(
    (hostId: string): HostRuntimeState => {
      const transport = manager.transport(hostId);
      if (!transport) return offlineState(hostId);
      return {
        ...manager.state(hostId),
        hostId,
        error: errorsRef.current.get(hostId) ?? null,
      };
    },
    [manager],
  );
  const subscribe = useCallback(
    (hostId: string, listener: () => void) => manager.subscribeState(hostId, listener),
    [manager],
  );
  const selectedHostId =
    manager.activeHostId ??
    (activeProfile && isRpcHostProfile(activeProfile) ? activeProfile.hostId : null);
  const value = useMemo<HostRuntimeContextValue>(
    () => ({ selectedHostId, selectHost, state, subscribe, transport }),
    [revision, selectHost, selectedHostId, state, subscribe, transport],
  );

  return <HostRuntimeContext.Provider value={value}>{children}</HostRuntimeContext.Provider>;
}

export function useHostRuntime(): HostRuntimeContextValue {
  const value = useContext(HostRuntimeContext);
  if (!value) throw new Error("useHostRuntime must be used inside HostRuntimeProvider");
  return value;
}

function isRpcHostProfile(profile: ConnectionProfile): profile is HostProfile {
  return (
    profile.transport === "rpc" &&
    typeof profile.hostId === "string" &&
    typeof profile.endpoint === "string" &&
    typeof profile.hostPublicKeyFingerprint === "string"
  );
}

function createEncryptedHostTransport(
  profile: HostProfile,
  credential: HostCredential,
  callbacks: HostRuntimeTransportCallbacks,
): HostTransport {
  let latestState: HandshakeState = "connecting";
  let transport: RpcHostTransport | null = null;
  const adapter = new HandshakeWebSocketAdapter(
    {
      v: 1,
      endpoint: profile.endpoint,
      hostId: profile.hostId,
      hostName: profile.name,
      hostPublicKey: credential.hostPublicKey,
      deviceId: credential.deviceId,
      deviceToken: credential.deviceToken,
      scope: "mobile",
      protocolMin: 1,
      protocolMax: 1,
    },
    {
      onStateChange: (state) => {
        latestState = state;
        callbacks.onStatus(runtimeStatus(state));
      },
      onOnline: () => {
        void transport?.handleOnline().catch((error: unknown) => {
          transport?.handleDisconnect();
          callbacks.onStatus("offline", errorMessage(error));
        });
      },
      onError: (error) => {
        const status = terminalHandshakeState(latestState) ?? "offline";
        if (status === "offline") transport?.handleDisconnect();
        else transport?.close();
        callbacks.onStatus(status, error.message);
      },
    },
  );
  const client = new RpcClient(adapter, { createId: createRpcId });
  transport = new RpcHostTransport(profile.hostId, client, {
    reconnect: () => adapter.connect(),
    close: () => adapter.close(),
  });
  return transport;
}

function runtimeStatus(state: HandshakeState): HostConnectionStatus {
  if (state === "online") return "online";
  return terminalHandshakeState(state) ?? "connecting";
}

function terminalHandshakeState(
  state: HandshakeState,
): Extract<
  HostConnectionStatus,
  "revoked" | "host_key_mismatch" | "protocol_incompatible"
> | null {
  return state === "revoked" || state === "host_key_mismatch" || state === "protocol_incompatible"
    ? state
    : null;
}

function offlineState(hostId: string): HostRuntimeState {
  return {
    hostId,
    status: "offline",
    missedHeartbeats: 0,
    lastHeartbeatAt: null,
    failureCode: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    error: null,
  };
}

function createRpcId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rpc-${Date.now().toString(36)}-${Math.random()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to restore Symphony RPC streams";
}
