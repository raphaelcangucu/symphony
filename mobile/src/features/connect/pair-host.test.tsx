import { pairHostOffer } from "./pair-host";

import type { PairingOfferV1 } from "@/auth/pairing-offer";

jest.mock("@/rpc/websocket-adapter", () => ({
  HandshakeWebSocketAdapter: jest.fn(),
}));
jest.mock("@/auth/host-profile", () => ({
  hostPublicKeyFingerprint: jest.fn(),
}));

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

describe("pairHostOffer", () => {
  it("persists only after encrypted status authentication", async () => {
    const save = jest.fn(async (profile) => profile);
    const authenticate = jest.fn(async () => ({
      runtimeId: "host-devbox",
      product: "Symphony",
      displayName: "Devbox Pro",
      version: "1.4.0",
    }));

    await pairHostOffer(offer, save, {
      authenticate,
      fingerprint: jest.fn(async () => "sha256:key"),
      now: () => "2026-07-25T00:00:00.000Z",
    });

    expect(authenticate).toHaveBeenCalledWith(offer);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "host-devbox",
        hostId: "host-devbox",
        name: "Devbox Pro",
      }),
      expect.objectContaining({
        deviceId: "device-phone",
        deviceToken: "device-secret",
      }),
    );
  });

  it("rejects a status response from a different runtime", async () => {
    const save = jest.fn();

    await expect(
      pairHostOffer(offer, save, {
        authenticate: jest.fn(async () => ({
          runtimeId: "other-host",
          product: "Symphony",
        })),
        fingerprint: jest.fn(async () => "sha256:key"),
        now: () => "2026-07-25T00:00:00.000Z",
      }),
    ).rejects.toThrow("identity does not match");
    expect(save).not.toHaveBeenCalled();
  });
});
