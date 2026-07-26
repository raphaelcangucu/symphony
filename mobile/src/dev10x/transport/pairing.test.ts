import { describe, expect, it } from "vitest";

import { encodePairingOffer, type PairingOfferV1 } from "@/auth/pairing-offer";

import { decodePairingUrl, extractPairingCodeFromUrl, parsePairingCode } from "./pairing";

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

describe("Orca-compatible Symphony pairing parser", () => {
  it("accepts the Symphony QR/deep link and keeps the full host identity", () => {
    const link = encodePairingOffer(offer);

    expect(decodePairingUrl(link)).toEqual({
      ...offer,
      publicKeyB64: offer.hostPublicKey,
    });
    expect(extractPairingCodeFromUrl(link)).toBe(new URL(link).searchParams.get("code"));
  });

  it("accepts a bare Symphony pairing code but rejects the Orca scheme", () => {
    const link = encodePairingOffer(offer);
    const code = new URL(link).searchParams.get("code")!;

    expect(parsePairingCode(code)?.hostId).toBe("host-devbox");
    expect(decodePairingUrl(link.replace("symphony://", "orca://"))).toBeNull();
  });
});
