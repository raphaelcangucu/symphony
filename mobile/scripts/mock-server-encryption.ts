import { sha256 } from "@noble/hashes/sha2.js";

import { SessionCipher, deriveSessionKeys, deriveSharedSecret } from "../src/rpc/crypto";
import { decodeSequenceFrame, encodeSequenceFrame } from "../src/rpc/handshake";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type MockHostKeyPair = {
  id: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export type E2EEState = {
  phase: "awaiting_auth" | "ready";
  hostId: string;
  session: SessionCipher;
  transcriptHash: Uint8Array;
  deviceToken: string | null;
  nextHostSequence: bigint;
};

export function acceptHello(
  raw: string,
  host: MockHostKeyPair,
  randomBytes: (length: number) => Uint8Array,
): { reply: string; state: E2EEState } {
  const hello = parseRecord(raw, "Mock mobile hello is malformed");
  if (
    hello.type !== "hello" ||
    hello.protocol_min !== 1 ||
    hello.protocol_max !== 1 ||
    hello.host_id !== host.id
  ) {
    throw new Error("Mock mobile hello is incompatible");
  }

  const clientPublicKey = decodeBase64Url(hello.client_public_key);
  const clientNonce = decodeBase64Url(hello.client_nonce);
  requireBytes(clientPublicKey, 32, "client public key");
  requireBytes(clientNonce, 32, "client nonce");
  requireBytes(host.publicKey, 32, "host public key");
  requireBytes(host.secretKey, 32, "host secret key");

  const serverNonce = randomBytes(32);
  requireBytes(serverNonce, 32, "server nonce");
  const reply = JSON.stringify({
    type: "hello_ack",
    protocol: 1,
    host_id: host.id,
    host_public_key: encodeBase64Url(host.publicKey),
    server_nonce: encodeBase64Url(serverNonce),
  });
  const transcriptHash = sha256(encoder.encode(`${raw}\n${reply}`));
  const sharedSecret = deriveSharedSecret(host.secretKey, clientPublicKey);
  const salt = sha256(concat(clientNonce, serverNonce));

  return {
    reply,
    state: {
      phase: "awaiting_auth",
      hostId: host.id,
      session: new SessionCipher(deriveSessionKeys(sharedSecret, transcriptHash, salt)),
      transcriptHash,
      deviceToken: null,
      nextHostSequence: 1n,
    },
  };
}

export function decryptClientFrame(frame: Uint8Array, state: E2EEState): string {
  const { sequence, ciphertext } = decodeSequenceFrame(frame);
  return decoder.decode(state.session.decrypt("c2h", sequence, ciphertext));
}

export function encryptHostFrame(plaintext: string, state: E2EEState): Uint8Array {
  const sequence = state.nextHostSequence;
  const ciphertext = state.session.encrypt("h2c", sequence, encoder.encode(plaintext));
  state.nextHostSequence += 1n;
  return encodeSequenceFrame(sequence, ciphertext);
}

export function authenticate(
  plaintext: string,
  state: E2EEState,
  expected: { deviceId: string; deviceToken: string },
): void {
  if (state.phase !== "awaiting_auth") {
    throw new Error("Mock mobile authentication was already completed");
  }
  const auth = parseRecord(plaintext, "Mock mobile authentication failed");
  const transcriptHash = decodeBase64Url(auth.transcript_hash);
  if (
    auth.type !== "auth" ||
    auth.device_id !== expected.deviceId ||
    typeof auth.device_token !== "string" ||
    !equalBytes(encoder.encode(auth.device_token), encoder.encode(expected.deviceToken)) ||
    !equalBytes(transcriptHash, state.transcriptHash)
  ) {
    throw new Error("Mock mobile authentication failed");
  }
  state.deviceToken = auth.device_token;
  state.phase = "ready";
}

function parseRecord(raw: string, message: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Normalize malformed input below.
  }
  throw new Error(message);
}

function decodeBase64Url(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Mock mobile base64url value is malformed");
  }
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function requireBytes(value: Uint8Array, length: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`Mock mobile ${label} must be ${length} bytes`);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
