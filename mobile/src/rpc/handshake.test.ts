import { fromByteArray, toByteArray } from "base64-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";

import type { PairingOfferV1 } from "../auth/pairing-offer";
import { derivePublicKey, deriveSessionKeys, deriveSharedSecret, encryptFrame } from "./crypto";
import {
  MobileHandshake,
  encodeSequenceFrame,
  handshakeTranscriptHash,
  type HostHelloV1,
} from "./handshake";

const hostSecretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const hostPublicKey = derivePublicKey(hostSecretKey);
const clientSecretKey = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);

const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "wss://host.test/mobile/rpc",
  hostId: "host_01",
  hostName: "Mac Studio",
  hostPublicKey: base64Url(hostPublicKey),
  deviceId: "device_01",
  deviceToken: "device-secret",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

describe("MobileHandshake", () => {
  it("sends no credential in hello and reaches online after encrypted authentication", () => {
    const handshake = new MobileHandshake(offer, {
      randomBytes: () => clientSecretKey,
    });
    const clientHelloRaw = handshake.start();
    const clientHello = JSON.parse(clientHelloRaw);

    expect(clientHello.type).toBe("hello");
    expect(clientHello).not.toHaveProperty("device_token");
    expect(clientHelloRaw).not.toContain(offer.deviceToken);

    const serverNonce = Uint8Array.from({ length: 32 }, (_, index) => 200 + index);
    const serverHello: HostHelloV1 = {
      type: "hello_ack",
      protocol: 1,
      host_id: offer.hostId,
      host_public_key: offer.hostPublicKey,
      server_nonce: base64Url(serverNonce),
    };
    const serverHelloRaw = JSON.stringify(serverHello);

    handshake.acceptServerHello(serverHelloRaw);
    const authFrame = handshake.createAuthFrame();
    expect(new TextDecoder().decode(authFrame)).not.toContain(offer.deviceToken);

    const sharedSecret = deriveSharedSecret(
      hostSecretKey,
      fromBase64Url(clientHello.client_public_key),
    );
    const transcriptHash = handshakeTranscriptHash(clientHelloRaw, serverHelloRaw);
    const keys = deriveSessionKeys(
      sharedSecret,
      transcriptHash,
      sha256(concat(fromBase64Url(clientHello.client_nonce), serverNonce)),
    );
    const ready = new TextEncoder().encode(
      JSON.stringify({ type: "authenticated", protocol: 1, host_id: offer.hostId }),
    );
    const readyFrame = encodeSequenceFrame(1n, encryptFrame(keys.hostToClient, "h2c", 1n, ready));

    expect(handshake.acceptServerFrame(readyFrame)).toEqual({
      type: "authenticated",
      protocol: 1,
      host_id: offer.hostId,
    });
    expect(handshake.state).toBe("online");
  });

  it("fails closed when the host id or pinned static key changes", () => {
    const wrongHost = startHandshake();
    expect(() =>
      wrongHost.handshake.acceptServerHello(
        JSON.stringify({ ...validServerHello(), host_id: "host_attacker" }),
      ),
    ).toThrow("Symphony host identity does not match pairing");
    expect(wrongHost.handshake.state).toBe("host_key_mismatch");

    const wrongKey = startHandshake();
    expect(() =>
      wrongKey.handshake.acceptServerHello(
        JSON.stringify({
          ...validServerHello(),
          host_public_key: base64Url(new Uint8Array(32).fill(9)),
        }),
      ),
    ).toThrow("Symphony host key does not match pairing");
    expect(wrongKey.handshake.state).toBe("host_key_mismatch");
  });

  it("reports incompatible protocol ranges and malformed host keys", () => {
    const incompatible = startHandshake();
    expect(() =>
      incompatible.handshake.acceptServerHello(
        JSON.stringify({ ...validServerHello(), protocol: 2 }),
      ),
    ).toThrow("Symphony host protocol is incompatible");
    expect(incompatible.handshake.state).toBe("protocol_incompatible");

    const malformed = startHandshake();
    expect(() =>
      malformed.handshake.acceptServerHello(
        JSON.stringify({ ...validServerHello(), host_public_key: "bad-key" }),
      ),
    ).toThrow("Symphony host key is malformed");
  });

  it("rejects tampered and replayed encrypted server frames", () => {
    const { handshake, clientHelloRaw } = startHandshake();
    const serverHelloRaw = JSON.stringify(validServerHello());
    handshake.acceptServerHello(serverHelloRaw);

    const readyFrame = serverReadyFrame(clientHelloRaw, serverHelloRaw);
    const tampered = readyFrame.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(() => handshake.acceptServerFrame(tampered)).toThrow(
      "Encrypted RPC frame authentication failed",
    );

    expect(handshake.acceptServerFrame(readyFrame)).toMatchObject({ type: "authenticated" });
    expect(() => handshake.acceptServerFrame(readyFrame)).toThrow(
      "Invalid encrypted RPC frame sequence",
    );
  });

  it("surfaces individual device revocation only after decrypting the host response", () => {
    const { handshake, clientHelloRaw } = startHandshake();
    const serverHelloRaw = JSON.stringify(validServerHello());
    handshake.acceptServerHello(serverHelloRaw);

    const revokedFrame = serverFrame(clientHelloRaw, serverHelloRaw, {
      type: "auth_error",
      code: "revoked",
    });

    expect(() => handshake.acceptServerFrame(revokedFrame)).toThrow(
      "This mobile device was revoked by the Symphony host",
    );
    expect(handshake.state).toBe("revoked");
  });
});

function startHandshake(): { handshake: MobileHandshake; clientHelloRaw: string } {
  const handshake = new MobileHandshake(offer, {
    randomBytes: () => clientSecretKey,
  });
  return { handshake, clientHelloRaw: handshake.start() };
}

function validServerHello(): HostHelloV1 {
  return {
    type: "hello_ack",
    protocol: 1,
    host_id: offer.hostId,
    host_public_key: offer.hostPublicKey,
    server_nonce: base64Url(Uint8Array.from({ length: 32 }, (_, index) => 200 + index)),
  };
}

function serverReadyFrame(clientHelloRaw: string, serverHelloRaw: string): Uint8Array {
  return serverFrame(clientHelloRaw, serverHelloRaw, {
    type: "authenticated",
    protocol: 1,
    host_id: offer.hostId,
  });
}

function serverFrame(
  clientHelloRaw: string,
  serverHelloRaw: string,
  payload: Record<string, unknown>,
): Uint8Array {
  const clientHello = JSON.parse(clientHelloRaw);
  const serverHello = JSON.parse(serverHelloRaw);
  const sharedSecret = deriveSharedSecret(
    hostSecretKey,
    fromBase64Url(clientHello.client_public_key),
  );
  const transcriptHash = handshakeTranscriptHash(clientHelloRaw, serverHelloRaw);
  const keys = deriveSessionKeys(
    sharedSecret,
    transcriptHash,
    sha256(
      concat(fromBase64Url(clientHello.client_nonce), fromBase64Url(serverHello.server_nonce)),
    ),
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  return encodeSequenceFrame(1n, encryptFrame(keys.hostToClient, "h2c", 1n, plaintext));
}

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return toByteArray(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}
