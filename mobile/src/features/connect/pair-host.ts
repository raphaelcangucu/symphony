import type { PairingOfferV1 } from "@/auth/pairing-offer";
import type { HostProfile } from "@/auth/connection-profile";
import type { HostCredential } from "@/auth/host-credential-storage";
import { hostPublicKeyFingerprint } from "@/auth/host-profile";
import { RpcClient } from "@/rpc/client";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";

type SaveHostProfile = (profile: HostProfile, credential: HostCredential) => Promise<HostProfile>;
type PairingStatus = {
  runtimeId: string;
  product: string;
  displayName?: string;
  version?: string;
};
type PairHostDependencies = {
  authenticate(offer: PairingOfferV1): Promise<PairingStatus>;
  fingerprint(hostPublicKey: string): Promise<string>;
  now(): string;
};

const productionDependencies: PairHostDependencies = {
  authenticate: authenticateOffer,
  fingerprint: hostPublicKeyFingerprint,
  now: () => new Date().toISOString(),
};

export async function pairHostOffer(
  offer: PairingOfferV1,
  saveHostProfile: SaveHostProfile,
  dependencies: PairHostDependencies = productionDependencies,
): Promise<void> {
  const status = await dependencies.authenticate(offer);
  if (status.product !== "Symphony") {
    throw new Error("Pairing endpoint is not a Symphony host");
  }
  if (status.runtimeId !== offer.hostId) {
    throw new Error("Authenticated Symphony host identity does not match the pairing offer");
  }
  const now = dependencies.now();
  const profile: HostProfile = {
    id: offer.hostId,
    hostId: offer.hostId,
    name: status.displayName?.trim() || offer.hostName,
    origin: offer.endpoint,
    endpoint: offer.endpoint,
    hostPublicKeyFingerprint: await dependencies.fingerprint(offer.hostPublicKey),
    transport: "rpc",
    protocolVersion: 1,
    createdAt: now,
    lastConnectedAt: now,
  };
  await saveHostProfile(profile, {
    deviceId: offer.deviceId,
    deviceToken: offer.deviceToken,
    hostPublicKey: offer.hostPublicKey,
  });
}

function authenticateOffer(offer: PairingOfferV1): Promise<PairingStatus> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let client: RpcClient | null = null;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client?.close();
      adapter.close();
      operation();
    };
    const adapter = new HandshakeWebSocketAdapter(offer, {
      onStateChange: () => undefined,
      onOnline: () => {
        void client
          ?.call<PairingStatus>("status.get", {}, { deadlineMs: 5_000 })
          .then((status) => finish(() => resolve(status)))
          .catch((error: unknown) =>
            finish(() =>
              reject(error instanceof Error ? error : new Error("Symphony status failed")),
            ),
          );
      },
      onError: (error) => finish(() => reject(error)),
    });
    client = new RpcClient(adapter, { createId: createRpcId });
    const timeout = setTimeout(() => finish(() => reject(new Error("Pairing timed out"))), 25_000);
    adapter.connect();
  });
}

function createRpcId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `pair-${Date.now().toString(36)}`;
}
