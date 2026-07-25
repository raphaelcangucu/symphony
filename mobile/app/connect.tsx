import { router } from "expo-router";
import { useState } from "react";

import type { PairingOfferV1 } from "@/auth/pairing-offer";
import type { HostProfile } from "@/auth/connection-profile";
import { useConnection } from "@/auth/ConnectionProvider";
import { hostPublicKeyFingerprint } from "@/auth/host-profile";
import { ConnectScreen } from "@/features/connect/ConnectScreen";
import { PairHostScreen } from "@/features/connect/PairHostScreen";
import { HandshakeWebSocketAdapter } from "@/rpc/websocket-adapter";

export default function ConnectRoute() {
  const [legacy, setLegacy] = useState(false);
  const { saveHostProfile } = useConnection();

  if (legacy) return <ConnectScreen />;

  return (
    <PairHostScreen
      onPaired={() => router.replace("/")}
      onUseLegacy={() => setLegacy(true)}
      pairHost={async (offer) => {
        await authenticateOffer(offer);
        const profile: HostProfile = {
          id: createProfileId(),
          hostId: offer.hostId,
          name: offer.hostName,
          origin: offer.endpoint,
          endpoint: offer.endpoint,
          hostPublicKeyFingerprint: await hostPublicKeyFingerprint(offer.hostPublicKey),
          transport: "rpc",
          protocolVersion: 1,
          createdAt: new Date().toISOString(),
          lastConnectedAt: new Date().toISOString(),
        };
        await saveHostProfile(profile, {
          deviceId: offer.deviceId,
          deviceToken: offer.deviceToken,
          hostPublicKey: offer.hostPublicKey,
        });
      }}
    />
  );
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
