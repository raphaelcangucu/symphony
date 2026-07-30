import { describe, expect, it } from "vitest";

import {
  acceptHello,
  authenticate,
  decryptClientFrame,
  encryptHostFrame,
} from "../../scripts/mock-server-encryption";
import type { PairingOfferV1 } from "../auth/pairing-offer";
import { derivePublicKey } from "./crypto";
import { MobileHandshake } from "./handshake";

const hostSecretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const hostPublicKey = derivePublicKey(hostSecretKey);
const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "ws://127.0.0.1:4103/mobile/rpc",
  hostId: "host_mock",
  hostName: "Symphony Mock Host",
  hostPublicKey: base64Url(hostPublicKey),
  deviceId: "device_mock",
  deviceToken: "mock-device-token",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

describe("Symphony mock server encryption interop", () => {
  it("completes the production mobile handshake and starts RPC at sequence two", () => {
    const mobile = new MobileHandshake(offer, {
      randomBytes: deterministicBytes(100),
    });
    const hello = mobile.start();
    const accepted = acceptHello(
      hello,
      {
        id: offer.hostId,
        publicKey: hostPublicKey,
        secretKey: hostSecretKey,
      },
      deterministicBytes(200),
    );

    mobile.acceptServerHello(accepted.reply);
    const authPayload = decryptClientFrame(mobile.createAuthFrame(), accepted.state);
    authenticate(authPayload, accepted.state, {
      deviceId: offer.deviceId,
      deviceToken: offer.deviceToken,
    });
    const authenticated = encryptHostFrame(
      JSON.stringify({ type: "authenticated", protocol: 1, host_id: offer.hostId }),
      accepted.state,
    );
    expect(mobile.acceptServerFrame(authenticated)).toMatchObject({
      type: "authenticated",
      host_id: offer.hostId,
    });

    const rpc = mobile.encryptRpcMessage(
      JSON.stringify({ type: "rpc", id: "rpc_1", method: "system.health", params: {} }),
    );
    expect(JSON.parse(decryptClientFrame(rpc, accepted.state))).toMatchObject({
      id: "rpc_1",
      method: "system.health",
    });
    expect(() => decryptClientFrame(rpc, accepted.state)).toThrow(
      "Invalid encrypted RPC frame sequence",
    );
  });

  it("rejects a wrong device token inside the encrypted channel", () => {
    const mobile = new MobileHandshake(offer, {
      randomBytes: deterministicBytes(50),
    });
    const hello = mobile.start();
    const accepted = acceptHello(
      hello,
      {
        id: offer.hostId,
        publicKey: hostPublicKey,
        secretKey: hostSecretKey,
      },
      deterministicBytes(150),
    );
    mobile.acceptServerHello(accepted.reply);
    const authPayload = decryptClientFrame(mobile.createAuthFrame(), accepted.state);

    expect(() =>
      authenticate(authPayload, accepted.state, {
        deviceId: offer.deviceId,
        deviceToken: "different-token",
      }),
    ).toThrow("Mock mobile authentication failed");
  });
});

function deterministicBytes(seed: number): (length: number) => Uint8Array {
  let call = 0;
  return (length) => Uint8Array.from({ length }, (_, index) => (seed + call++ * 17 + index) % 256);
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
