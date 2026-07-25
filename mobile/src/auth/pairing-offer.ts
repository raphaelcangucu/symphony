import { fromByteArray, toByteArray } from "base64-js";

export type PairingOfferV1 = {
  v: 1;
  endpoint: string;
  hostId: string;
  hostName: string;
  hostPublicKey: string;
  deviceId: string;
  deviceToken: string;
  scope: "mobile";
  protocolMin: 1;
  protocolMax: 1;
};

const SUPPORTED_PROTOCOL = 1;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function encodePairingOffer(offer: PairingOfferV1): string {
  const wireOffer = {
    v: offer.v,
    endpoint: offer.endpoint,
    host_id: offer.hostId,
    host_name: offer.hostName,
    host_public_key: offer.hostPublicKey,
    device_id: offer.deviceId,
    device_token: offer.deviceToken,
    scope: offer.scope,
    protocol_min: offer.protocolMin,
    protocol_max: offer.protocolMax,
  };
  const code = encodeBase64Url(textEncoder.encode(JSON.stringify(wireOffer)));
  return `symphony://pair?code=${code}`;
}

export function parsePairingOffer(input: string): PairingOfferV1 {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Unsupported Symphony pairing link");
  }

  if (
    url.protocol !== "symphony:" ||
    url.hostname !== "pair" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("Unsupported Symphony pairing link");
  }
  if ([...url.searchParams.keys()].some((key) => key !== "code") || url.searchParams.size !== 1) {
    throw new Error("Pairing link contains unsupported parameters");
  }

  const code = url.searchParams.get("code");
  if (!code) throw new Error("Pairing link is missing its offer");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(textDecoder.decode(decodeBase64Url(code))) as Record<string, unknown>;
  } catch {
    throw new Error("Pairing offer is malformed");
  }

  if (payload.v !== 1) throw new Error("Unsupported Symphony pairing version");
  if (payload.scope !== "mobile") throw new Error("Pairing offer does not grant mobile access");

  const protocolMin = requiredInteger(payload.protocol_min, "minimum protocol");
  const protocolMax = requiredInteger(payload.protocol_max, "maximum protocol");
  if (
    protocolMin > protocolMax ||
    protocolMin > SUPPORTED_PROTOCOL ||
    protocolMax < SUPPORTED_PROTOCOL
  ) {
    throw new Error("Symphony host protocol is incompatible");
  }

  const endpoint = validateEndpoint(requiredString(payload.endpoint, "endpoint"));
  const hostPublicKey = requiredString(payload.host_public_key, "host key");
  if (decodeBase64Url(hostPublicKey).length !== 32) {
    throw new Error("Pairing host key must be 32 bytes");
  }

  return {
    v: 1,
    endpoint,
    hostId: requiredString(payload.host_id, "host identity"),
    hostName: requiredString(payload.host_name, "host name"),
    hostPublicKey,
    deviceId: requiredString(payload.device_id, "device identity"),
    deviceToken: requiredString(payload.device_token, "device token"),
    scope: "mobile",
    protocolMin: 1,
    protocolMax: 1,
  };
}

export function redactPairingSecrets(message: string, offer: PairingOfferV1): string {
  const encodedOffer = encodePairingOffer(offer);
  const code = new URL(encodedOffer).searchParams.get("code") ?? "";

  return [offer.deviceToken, code]
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), message);
}

function validateEndpoint(input: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    throw new Error("Pairing endpoint must include a host");
  }

  if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
    throw new Error("Pairing endpoint must use ws or wss");
  }
  if (!endpoint.hostname) throw new Error("Pairing endpoint must include a host");
  if (endpoint.username || endpoint.password) {
    throw new Error("Pairing endpoint must not contain credentials");
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error("Pairing endpoint must not contain query parameters or fragments");
  }
  return endpoint.toString();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pairing offer is missing a ${label}`);
  }
  return value.trim();
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Pairing offer has an invalid ${label}`);
  return value as number;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return toByteArray(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
}
