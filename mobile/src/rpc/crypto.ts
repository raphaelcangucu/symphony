import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type CryptoDirection = "c2h" | "h2c";

export type SessionKeys = {
  clientToHost: Uint8Array;
  hostToClient: Uint8Array;
};

const KEY_BYTES = 32;
const TAG_BYTES = 16;
const MAX_SEQUENCE = 2n ** 64n - 1n;
const encoder = new TextEncoder();

export class CryptoFrameError extends Error {
  constructor(message = "Encrypted RPC frame authentication failed") {
    super(message);
    this.name = "CryptoFrameError";
  }
}

export class CryptoSequenceError extends Error {
  constructor(message = "Invalid encrypted RPC frame sequence") {
    super(message);
    this.name = "CryptoSequenceError";
  }
}

export function generateEphemeralKeyPair(randomBytes: (length: number) => Uint8Array): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const secretKey = randomBytes(KEY_BYTES);
  requireBytes(secretKey, KEY_BYTES, "X25519 random secret");
  return {
    secretKey,
    publicKey: derivePublicKey(secretKey),
  };
}

export function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  requireBytes(secretKey, KEY_BYTES, "X25519 secret key");
  return x25519.getPublicKey(secretKey);
}

export function deriveSharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  requireBytes(secretKey, KEY_BYTES, "X25519 secret key");
  requireBytes(peerPublicKey, KEY_BYTES, "X25519 public key");
  return x25519.getSharedSecret(secretKey, peerPublicKey);
}

export function hkdfSha256(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): { prk: Uint8Array; okm: Uint8Array } {
  if (!Number.isSafeInteger(length) || length < 0 || length > 255 * sha256.outputLen) {
    throw new RangeError("Invalid HKDF output length");
  }
  const prk = extract(sha256, inputKeyMaterial, salt);
  return {
    prk,
    okm: expand(sha256, prk, info, length),
  };
}

export function deriveSessionKeys(
  sharedSecret: Uint8Array,
  transcriptHash: Uint8Array,
  salt: Uint8Array,
): SessionKeys {
  requireBytes(sharedSecret, KEY_BYTES, "X25519 shared secret");
  requireBytes(transcriptHash, sha256.outputLen, "handshake transcript hash");
  const clientInfo = concat(
    encoder.encode("symphony-mobile-rpc-v1/client-to-host/"),
    transcriptHash,
  );
  const hostInfo = concat(encoder.encode("symphony-mobile-rpc-v1/host-to-client/"), transcriptHash);

  return {
    clientToHost: hkdfSha256(sharedSecret, salt, clientInfo, KEY_BYTES).okm,
    hostToClient: hkdfSha256(sharedSecret, salt, hostInfo, KEY_BYTES).okm,
  };
}

export function nonceForSequence(sequence: bigint): Uint8Array {
  validateSequenceRange(sequence);
  const nonce = new Uint8Array(12);
  writeSequence(nonce, 4, sequence);
  return nonce;
}

export function aadForFrame(direction: CryptoDirection, sequence: bigint): Uint8Array {
  validateDirection(direction);
  validateSequenceRange(sequence);
  const prefix = encoder.encode(`symphony-mobile-rpc-v1|${direction}|`);
  const aad = new Uint8Array(prefix.length + 8);
  aad.set(prefix);
  writeSequence(aad, prefix.length, sequence);
  return aad;
}

export function encryptFrame(
  key: Uint8Array,
  direction: CryptoDirection,
  sequence: bigint,
  plaintext: Uint8Array,
): Uint8Array {
  requireBytes(key, KEY_BYTES, "session key");
  return chacha20poly1305(
    key,
    nonceForSequence(sequence),
    aadForFrame(direction, sequence),
  ).encrypt(plaintext);
}

export function decryptFrame(
  key: Uint8Array,
  direction: CryptoDirection,
  sequence: bigint,
  frame: Uint8Array,
): Uint8Array {
  requireBytes(key, KEY_BYTES, "session key");
  if (!(frame instanceof Uint8Array) || frame.length < TAG_BYTES) {
    throw new CryptoFrameError();
  }

  try {
    return chacha20poly1305(
      key,
      nonceForSequence(sequence),
      aadForFrame(direction, sequence),
    ).decrypt(frame);
  } catch {
    throw new CryptoFrameError();
  }
}

export class SessionCipher {
  private readonly keys: SessionKeys;
  private readonly sent: Record<CryptoDirection, bigint> = { c2h: 0n, h2c: 0n };
  private readonly received: Record<CryptoDirection, bigint> = { c2h: 0n, h2c: 0n };

  constructor(keys: SessionKeys) {
    requireBytes(keys.clientToHost, KEY_BYTES, "client-to-host key");
    requireBytes(keys.hostToClient, KEY_BYTES, "host-to-client key");
    this.keys = {
      clientToHost: keys.clientToHost.slice(),
      hostToClient: keys.hostToClient.slice(),
    };
  }

  encrypt(direction: CryptoDirection, sequence: bigint, plaintext: Uint8Array): Uint8Array {
    this.requireNext(this.sent, direction, sequence);
    const frame = encryptFrame(this.key(direction), direction, sequence, plaintext);
    this.sent[direction] = sequence;
    return frame;
  }

  decrypt(direction: CryptoDirection, sequence: bigint, frame: Uint8Array): Uint8Array {
    this.requireNext(this.received, direction, sequence);
    const plaintext = decryptFrame(this.key(direction), direction, sequence, frame);
    this.received[direction] = sequence;
    return plaintext;
  }

  private key(direction: CryptoDirection): Uint8Array {
    validateDirection(direction);
    return direction === "c2h" ? this.keys.clientToHost : this.keys.hostToClient;
  }

  private requireNext(
    counters: Record<CryptoDirection, bigint>,
    direction: CryptoDirection,
    sequence: bigint,
  ): void {
    validateDirection(direction);
    validateSequenceRange(sequence);
    if (sequence !== counters[direction] + 1n) {
      throw new CryptoSequenceError();
    }
  }
}

function requireBytes(value: Uint8Array, length: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${label} must be ${length} bytes`);
  }
}

function validateDirection(direction: CryptoDirection): void {
  if (direction !== "c2h" && direction !== "h2c") {
    throw new TypeError("Invalid encrypted RPC frame direction");
  }
}

function validateSequenceRange(sequence: bigint): void {
  if (typeof sequence !== "bigint" || sequence < 1n || sequence > MAX_SEQUENCE) {
    throw new CryptoSequenceError();
  }
}

function writeSequence(target: Uint8Array, offset: number, sequence: bigint): void {
  let remaining = sequence;
  for (let index = 7; index >= 0; index -= 1) {
    target[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
