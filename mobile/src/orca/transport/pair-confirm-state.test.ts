import { describe, expect, it } from "vitest";

import { encodePairingOffer, type PairingOfferV1 } from "@/auth/pairing-offer";

import { resolvePairConfirmRouteState } from "./pair-confirm-state";

const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "wss://devbox.example.test/mobile/rpc",
  hostId: "host-devbox",
  hostName: "Devbox",
  hostPublicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  deviceId: "device-phone",
  deviceToken: "device-secret",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

describe("pair confirmation state", () => {
  it("resolves the Symphony offer from a route code", () => {
    const code = new URL(encodePairingOffer(offer)).searchParams.get("code")!;

    expect(resolvePairConfirmRouteState(code)).toMatchObject({
      kind: "ready",
      offer: { hostId: "host-devbox", hostName: "Devbox" },
    });
  });

  it("uses Dev10x/Symphony copy for malformed offers", () => {
    expect(resolvePairConfirmRouteState("invalid")).toEqual({
      kind: "error",
      offer: null,
      errorMessage: "Not a valid Symphony pairing code",
    });
  });
});
