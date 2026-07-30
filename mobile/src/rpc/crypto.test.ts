import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CryptoFrameError,
  CryptoSequenceError,
  SessionCipher,
  aadForFrame,
  decryptFrame,
  derivePublicKey,
  deriveSessionKeys,
  deriveSharedSecret,
  encryptFrame,
  generateEphemeralKeyPair,
  hkdfSha256,
  nonceForSequence,
} from "./crypto";

type CryptoVector = {
  x25519: {
    client_secret_hex: string;
    client_public_hex: string;
    host_secret_hex: string;
    host_public_hex: string;
    shared_secret_hex: string;
  };
  session: {
    salt_hex: string;
    transcript_hash_hex: string;
    client_to_host_key_hex: string;
    host_to_client_key_hex: string;
  };
  client_to_host: {
    sequence: string;
    nonce_hex: string;
    aad_hex: string;
    plaintext_utf8: string;
    ciphertext_hex: string;
    tag_hex: string;
  };
  hkdf_rfc5869_case_1: {
    ikm_hex: string;
    salt_hex: string;
    info_hex: string;
    length: number;
    prk_hex: string;
    okm_hex: string;
  };
};

const vector = JSON.parse(
  readFileSync(
    new URL("../../../docs/superpowers/specs/fixtures/mobile-rpc-crypto-v1.json", import.meta.url),
    "utf8",
  ),
) as CryptoVector;

const encoder = new TextEncoder();

describe("mobile RPC crypto", () => {
  it("creates an ephemeral key pair from a secure 32-byte random source", () => {
    const expectedSecret = fromHex(vector.x25519.client_secret_hex);
    const pair = generateEphemeralKeyPair((length) => {
      expect(length).toBe(32);
      return expectedSecret.slice();
    });

    expect(pair.secretKey).toEqual(expectedSecret);
    expect(toHex(pair.publicKey)).toBe(vector.x25519.client_public_hex);
  });

  it("matches the fixed X25519 shared-secret vector from both peers", () => {
    const clientSecret = fromHex(vector.x25519.client_secret_hex);
    const hostSecret = fromHex(vector.x25519.host_secret_hex);
    const clientPublic = derivePublicKey(clientSecret);
    const hostPublic = derivePublicKey(hostSecret);

    expect(toHex(clientPublic)).toBe(vector.x25519.client_public_hex);
    expect(toHex(hostPublic)).toBe(vector.x25519.host_public_hex);
    expect(toHex(deriveSharedSecret(clientSecret, hostPublic))).toBe(
      vector.x25519.shared_secret_hex,
    );
    expect(toHex(deriveSharedSecret(hostSecret, clientPublic))).toBe(
      vector.x25519.shared_secret_hex,
    );
  });

  it("implements RFC 5869 HKDF-SHA-256 and derives directional session keys", () => {
    const rfc = vector.hkdf_rfc5869_case_1;
    const result = hkdfSha256(
      fromHex(rfc.ikm_hex),
      fromHex(rfc.salt_hex),
      fromHex(rfc.info_hex),
      rfc.length,
    );
    expect(toHex(result.prk)).toBe(rfc.prk_hex);
    expect(toHex(result.okm)).toBe(rfc.okm_hex);

    const keys = deriveSessionKeys(
      fromHex(vector.x25519.shared_secret_hex),
      fromHex(vector.session.transcript_hash_hex),
      fromHex(vector.session.salt_hex),
    );
    expect(toHex(keys.clientToHost)).toBe(vector.session.client_to_host_key_hex);
    expect(toHex(keys.hostToClient)).toBe(vector.session.host_to_client_key_hex);
  });

  it("matches and decrypts the ChaCha20-Poly1305 frame vector", () => {
    const frame = vector.client_to_host;
    const sequence = BigInt(frame.sequence);
    const key = fromHex(vector.session.client_to_host_key_hex);
    const plaintext = encoder.encode(frame.plaintext_utf8);

    expect(toHex(nonceForSequence(sequence))).toBe(frame.nonce_hex);
    expect(toHex(aadForFrame("c2h", sequence))).toBe(frame.aad_hex);

    const encrypted = encryptFrame(key, "c2h", sequence, plaintext);
    expect(toHex(encrypted)).toBe(frame.ciphertext_hex + frame.tag_hex);
    expect(decryptFrame(key, "c2h", sequence, encrypted)).toEqual(plaintext);
  });

  it("rejects authentication changes and does not consume the sequence", () => {
    const key = fromHex(vector.session.client_to_host_key_hex);
    const plaintext = encoder.encode(vector.client_to_host.plaintext_utf8);
    const encrypted = encryptFrame(key, "c2h", 1n, plaintext);
    const changed = encrypted.slice();
    changed[changed.length - 1] ^= 1;
    const cipher = new SessionCipher({
      clientToHost: key,
      hostToClient: fromHex(vector.session.host_to_client_key_hex),
    });

    expect(() => cipher.decrypt("c2h", 1n, changed)).toThrow(CryptoFrameError);
    expect(cipher.decrypt("c2h", 1n, encrypted)).toEqual(plaintext);
  });

  it("rejects replayed, skipped, and invalid sequence numbers", () => {
    const keys = {
      clientToHost: fromHex(vector.session.client_to_host_key_hex),
      hostToClient: fromHex(vector.session.host_to_client_key_hex),
    };
    const sender = new SessionCipher(keys);
    const receiver = new SessionCipher(keys);
    const plaintext = encoder.encode("heartbeat");
    const frame = sender.encrypt("c2h", 1n, plaintext);

    expect(receiver.decrypt("c2h", 1n, frame)).toEqual(plaintext);
    expect(() => receiver.decrypt("c2h", 1n, frame)).toThrow(CryptoSequenceError);
    expect(() => receiver.decrypt("c2h", 3n, frame)).toThrow(CryptoSequenceError);
    expect(() => sender.encrypt("h2c", 0n, plaintext)).toThrow(CryptoSequenceError);
    expect(() => nonceForSequence(2n ** 64n)).toThrow(CryptoSequenceError);
  });
});

function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("Invalid test vector hex");
  }
  return Uint8Array.from(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
