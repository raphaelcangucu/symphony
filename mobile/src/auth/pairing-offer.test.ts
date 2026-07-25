import { describe, expect, it } from "vitest";

import {
  encodePairingOffer,
  parsePairingOffer,
  redactPairingSecrets,
  type PairingOfferV1,
} from "./pairing-offer";

const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "wss://mac-studio.example.test/symphony/mobile/rpc",
  hostId: "host_01JZXYZ",
  hostName: "Mac Studio",
  hostPublicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  deviceId: "device_01JZABC",
  deviceToken: "pairing-secret-token",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

describe("parsePairingOffer", () => {
  it("round-trips a versioned mobile offer from the dedicated pair route", () => {
    const link = encodePairingOffer(offer);

    expect(parsePairingOffer(link)).toEqual(offer);
  });

  it("rejects another route, unsupported offer versions and non-mobile scope", () => {
    const link = encodePairingOffer(offer);

    expect(() => parsePairingOffer(link.replace("symphony://pair", "symphony://connect"))).toThrow(
      "Unsupported Symphony pairing link",
    );
    expect(() => parsePairingOffer(encodePairingOffer({ ...offer, v: 2 as 1 }))).toThrow(
      "Unsupported Symphony pairing version",
    );
    expect(() =>
      parsePairingOffer(encodePairingOffer({ ...offer, scope: "admin" as "mobile" })),
    ).toThrow("Pairing offer does not grant mobile access");
  });

  it("requires a compatible protocol and a reachable credential-free WebSocket endpoint", () => {
    expect(() =>
      parsePairingOffer(encodePairingOffer({ ...offer, protocolMin: 2, protocolMax: 3 })),
    ).toThrow("Symphony host protocol is incompatible");
    expect(() =>
      parsePairingOffer(
        encodePairingOffer({
          ...offer,
          endpoint: "https://mac-studio.example.test/mobile/rpc",
        }),
      ),
    ).toThrow("Pairing endpoint must use ws or wss");
    expect(() =>
      parsePairingOffer(
        encodePairingOffer({
          ...offer,
          endpoint: "wss://user:password@mac-studio.example.test/mobile/rpc",
        }),
      ),
    ).toThrow("Pairing endpoint must not contain credentials");
  });

  it("rejects malformed host keys, blank identities and extra link parameters", () => {
    expect(() =>
      parsePairingOffer(encodePairingOffer({ ...offer, hostPublicKey: "not-a-key" })),
    ).toThrow("Pairing host key must be 32 bytes");
    expect(() => parsePairingOffer(encodePairingOffer({ ...offer, deviceToken: " " }))).toThrow(
      "Pairing offer is missing a device token",
    );
    expect(() => parsePairingOffer(`${encodePairingOffer(offer)}&token=leak`)).toThrow(
      "Pairing link contains unsupported parameters",
    );
  });
});

describe("redactPairingSecrets", () => {
  it("redacts both the encoded offer and the raw device token", () => {
    const link = encodePairingOffer(offer);
    const diagnostic = `pair=${link} token=${offer.deviceToken}`;
    const redacted = redactPairingSecrets(diagnostic, offer);

    expect(redacted).not.toContain(offer.deviceToken);
    expect(redacted).not.toContain(new URL(link).searchParams.get("code"));
    expect(redacted).toBe("pair=symphony://pair?code=[REDACTED] token=[REDACTED]");
  });
});
