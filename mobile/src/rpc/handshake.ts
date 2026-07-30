import { fromByteArray, toByteArray } from "base64-js";
import { sha256 } from "@noble/hashes/sha2.js";

import type { PairingOfferV1 } from "../auth/pairing-offer";
import {
  CryptoFrameError,
  SessionCipher,
  deriveSessionKeys,
  deriveSharedSecret,
  generateEphemeralKeyPair,
} from "./crypto";

export type HandshakeState =
  | "connecting"
  | "handshaking"
  | "authenticating"
  | "online"
  | "revoked"
  | "host_key_mismatch"
  | "protocol_incompatible";

export type HostHelloV1 = {
  type: "hello_ack";
  protocol: 1;
  host_id: string;
  host_public_key: string;
  server_nonce: string;
};

export type AuthenticatedV1 = {
  type: "authenticated";
  protocol: 1;
  host_id: string;
};

type MobileHandshakeOptions = {
  randomBytes: (length: number) => Uint8Array;
};

const PROTOCOL_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MobileHandshake {
  private readonly offer: PairingOfferV1;
  private readonly randomBytes: (length: number) => Uint8Array;
  private clientHelloRaw: string | null = null;
  private clientNonce: Uint8Array | null = null;
  private ephemeralSecret: Uint8Array | null = null;
  private transcriptHash: Uint8Array | null = null;
  private cipher: SessionCipher | null = null;
  private nextClientSequence = 2n;
  private nextServerSequence = 2n;
  private currentState: HandshakeState = "connecting";

  constructor(offer: PairingOfferV1, options: MobileHandshakeOptions) {
    this.offer = offer;
    this.randomBytes = options.randomBytes;
  }

  get state(): HandshakeState {
    return this.currentState;
  }

  start(): string {
    if (this.currentState !== "connecting") {
      throw new Error("Symphony handshake has already started");
    }

    const ephemeral = generateEphemeralKeyPair(this.randomBytes);
    const clientNonce = this.randomBytes(32);
    requireBytes(clientNonce, 32, "client nonce");

    this.ephemeralSecret = ephemeral.secretKey;
    this.clientNonce = clientNonce;
    this.clientHelloRaw = JSON.stringify({
      type: "hello",
      protocol_min: PROTOCOL_VERSION,
      protocol_max: PROTOCOL_VERSION,
      host_id: this.offer.hostId,
      client_public_key: base64Url(ephemeral.publicKey),
      client_nonce: base64Url(clientNonce),
    });
    this.currentState = "handshaking";
    return this.clientHelloRaw;
  }

  acceptServerHello(raw: string): void {
    if (
      this.currentState !== "handshaking" ||
      !this.clientHelloRaw ||
      !this.clientNonce ||
      !this.ephemeralSecret
    ) {
      throw new Error("Unexpected Symphony host hello");
    }

    let hello: HostHelloV1 | { type: "hello_error"; code?: string };
    try {
      hello = JSON.parse(raw) as HostHelloV1 | { type: "hello_error"; code?: string };
    } catch {
      throw new Error("Symphony host hello is malformed");
    }

    if (hello.type === "hello_error") {
      if (hello.code === "protocol_incompatible") {
        this.currentState = "protocol_incompatible";
        throw new Error("Symphony host protocol is incompatible");
      }
      if (hello.code === "host_mismatch") {
        this.currentState = "host_key_mismatch";
        throw new Error("Symphony host identity does not match pairing");
      }
      throw new Error("Symphony host rejected the encrypted handshake");
    }
    if (hello.type !== "hello_ack") throw new Error("Symphony host hello is malformed");
    if (hello.protocol !== PROTOCOL_VERSION) {
      this.currentState = "protocol_incompatible";
      throw new Error("Symphony host protocol is incompatible");
    }
    if (hello.host_id !== this.offer.hostId) {
      this.currentState = "host_key_mismatch";
      throw new Error("Symphony host identity does not match pairing");
    }

    let hostKey: Uint8Array;
    let pinnedHostKey: Uint8Array;
    let serverNonce: Uint8Array;
    try {
      hostKey = fromBase64Url(hello.host_public_key);
      pinnedHostKey = fromBase64Url(this.offer.hostPublicKey);
      serverNonce = fromBase64Url(hello.server_nonce);
      requireBytes(hostKey, 32, "host key");
      requireBytes(pinnedHostKey, 32, "pinned host key");
      requireBytes(serverNonce, 32, "server nonce");
    } catch {
      throw new Error("Symphony host key is malformed");
    }

    if (!equalBytes(hostKey, pinnedHostKey)) {
      this.currentState = "host_key_mismatch";
      throw new Error("Symphony host key does not match pairing");
    }

    const transcriptHash = handshakeTranscriptHash(this.clientHelloRaw, raw);
    const sharedSecret = deriveSharedSecret(this.ephemeralSecret, hostKey);
    const salt = sha256(concat(this.clientNonce, serverNonce));
    this.transcriptHash = transcriptHash;
    this.cipher = new SessionCipher(deriveSessionKeys(sharedSecret, transcriptHash, salt));
    this.currentState = "authenticating";
  }

  createAuthFrame(): Uint8Array {
    if (this.currentState !== "authenticating" || !this.cipher || !this.transcriptHash) {
      throw new Error("Symphony handshake is not ready to authenticate");
    }

    const plaintext = encoder.encode(
      JSON.stringify({
        type: "auth",
        device_id: this.offer.deviceId,
        device_token: this.offer.deviceToken,
        transcript_hash: base64Url(this.transcriptHash),
      }),
    );
    return encodeSequenceFrame(1n, this.cipher.encrypt("c2h", 1n, plaintext));
  }

  acceptServerFrame(frame: Uint8Array): AuthenticatedV1 {
    if (
      !this.cipher ||
      (this.currentState !== "authenticating" && this.currentState !== "online")
    ) {
      throw new Error("Unexpected encrypted Symphony handshake frame");
    }

    const { sequence, ciphertext } = decodeSequenceFrame(frame);
    const plaintext = this.cipher.decrypt("h2c", sequence, ciphertext);

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(decoder.decode(plaintext)) as Record<string, unknown>;
    } catch {
      throw new CryptoFrameError("Encrypted Symphony handshake payload is malformed");
    }

    if (message.type === "auth_error") {
      if (message.code === "revoked") this.currentState = "revoked";
      throw new Error(
        message.code === "revoked"
          ? "This mobile device was revoked by the Symphony host"
          : "Symphony mobile authentication failed",
      );
    }
    if (
      message.type !== "authenticated" ||
      message.protocol !== PROTOCOL_VERSION ||
      message.host_id !== this.offer.hostId
    ) {
      throw new Error("Unexpected encrypted Symphony handshake response");
    }

    this.currentState = "online";
    return message as AuthenticatedV1;
  }

  encryptRpcMessage(message: string): Uint8Array {
    if (this.currentState !== "online" || !this.cipher) {
      throw new Error("Symphony RPC channel is not online");
    }
    const sequence = this.nextClientSequence;
    const frame = encodeSequenceFrame(
      sequence,
      this.cipher.encrypt("c2h", sequence, encoder.encode(message)),
    );
    this.nextClientSequence += 1n;
    return frame;
  }

  decryptRpcFrame(frame: Uint8Array): string {
    if (this.currentState !== "online" || !this.cipher) {
      throw new Error("Symphony RPC channel is not online");
    }
    const { sequence, ciphertext } = decodeSequenceFrame(frame);
    if (sequence !== this.nextServerSequence) {
      throw new Error("Invalid encrypted RPC frame sequence");
    }
    const plaintext = this.cipher.decrypt("h2c", sequence, ciphertext);
    this.nextServerSequence += 1n;
    return decoder.decode(plaintext);
  }
}

export function handshakeTranscriptHash(
  clientHelloRaw: string,
  serverHelloRaw: string,
): Uint8Array {
  return sha256(encoder.encode(`${clientHelloRaw}\n${serverHelloRaw}`));
}

export function encodeSequenceFrame(sequence: bigint, ciphertext: Uint8Array): Uint8Array {
  if (sequence < 1n || sequence > 2n ** 64n - 1n) {
    throw new RangeError("Invalid encrypted RPC frame sequence");
  }
  const frame = new Uint8Array(8 + ciphertext.length);
  let remaining = sequence;
  for (let index = 7; index >= 0; index -= 1) {
    frame[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  frame.set(ciphertext, 8);
  return frame;
}

export function decodeSequenceFrame(frame: Uint8Array): {
  sequence: bigint;
  ciphertext: Uint8Array;
} {
  if (!(frame instanceof Uint8Array) || frame.length < 8 + 16) {
    throw new CryptoFrameError();
  }
  let sequence = 0n;
  for (let index = 0; index < 8; index += 1) {
    sequence = (sequence << 8n) | BigInt(frame[index]!);
  }
  return { sequence, ciphertext: frame.slice(8) };
}

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return toByteArray(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
}

function requireBytes(value: Uint8Array, length: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${label} must be ${length} bytes`);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}
