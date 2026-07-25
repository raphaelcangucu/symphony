import type { PairingOfferV1 } from "@/auth/pairing-offer";
import type { HostProfile } from "@/auth/connection-profile";
import type { HostCredential } from "@/auth/host-credential-storage";
import { hostPublicKeyFingerprint } from "@/auth/host-profile";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";

type SaveHostProfile = (profile: HostProfile, credential: HostCredential) => Promise<HostProfile>;

export async function pairHostOffer(
  offer: PairingOfferV1,
  saveHostProfile: SaveHostProfile,
): Promise<void> {
  await authenticateOffer(offer);
  const now = new Date().toISOString();
  const profile: HostProfile = {
    id: createProfileId(),
    hostId: offer.hostId,
    name: offer.hostName,
    origin: offer.endpoint,
    endpoint: offer.endpoint,
    hostPublicKeyFingerprint: await hostPublicKeyFingerprint(offer.hostPublicKey),
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

function authenticateOffer(offer: PairingOfferV1): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let adapter: HandshakeWebSocketAdapter;
    const timeout = setTimeout(() => finish(() => reject(new Error("Pairing timed out"))), 12_000);
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      adapter.close();
      operation();
    };
    adapter = new HandshakeWebSocketAdapter(offer, {
      onStateChange: () => undefined,
      onOnline: () => finish(resolve),
      onError: (error) => finish(() => reject(error)),
    });
    adapter.connect();
  });
}

function createProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `host-${Date.now().toString(36)}`;
}
