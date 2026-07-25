#!/usr/bin/env npx tsx
// Standalone mock copied from Orca's proven mobile development workflow.
// It uses Symphony's production pairing and encrypted RPC wire protocol.
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { encodePairingOffer } from "../src/auth/pairing-offer";
import { generateEphemeralKeyPair } from "../src/rpc/crypto";
import {
  acceptHello,
  authenticate,
  decryptClientFrame,
  encryptHostFrame,
  type E2EEState,
} from "./mock-server-encryption";
import {
  cleanupConnection,
  cancelRequest,
  error,
  handleRequest,
  mockScenarioSummary,
  success,
  unsubscribe,
  type RpcRequest,
} from "./mock-server-rpc-handlers";

const PORT = positivePort(process.env.PORT, 4103);
const BIND = process.env.MOCK_BIND || "127.0.0.1";
const ENDPOINT = process.env.MOCK_PUBLIC_ENDPOINT || `ws://127.0.0.1:${PORT}/mobile/rpc`;
const HOST_ID = process.env.MOCK_HOST_ID || "host_mock";
const HOST_NAME = process.env.MOCK_HOST_NAME || "Symphony Mock Host — NOT REAL";
const DEVICE_ID = "device_mock";
const AUTH_TOKEN = "mock-device-token";
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD_BYTES = 1_048_576;
const disconnectAfterMs = nonNegativeInteger(process.env.MOCK_DISCONNECT_AFTER_MS);
const disconnectOnce = process.env.MOCK_DISCONNECT_ONCE === "1";
let disconnectTriggered = false;

if (process.env.NODE_ENV === "production" && process.env.MOCK_ALLOW_PRODUCTION !== "1") {
  throw new Error("Symphony mock server refuses to run with NODE_ENV=production");
}
if (BIND !== "127.0.0.1" && BIND !== "::1" && BIND !== "localhost") {
  console.warn(
    `[mock] WARNING: explicitly exposed on ${BIND}; use only on a trusted private development network`,
  );
}

const hostKeys = generateEphemeralKeyPair((length) => new Uint8Array(randomBytes(length)));
const connectionState = new Map<WebSocket, E2EEState>();
const handshakeTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
const wss = new WebSocketServer({
  host: BIND,
  port: PORT,
  maxPayload: MAX_PAYLOAD_BYTES,
});

wss.on("connection", (ws, request) => {
  if (request.url !== "/mobile/rpc") {
    ws.close(1008, "invalid mobile RPC path");
    return;
  }
  console.log("[mock] Client connected — waiting for Symphony hello");
  handshakeTimers.set(
    ws,
    setTimeout(() => ws.close(1008, "handshake timeout"), HANDSHAKE_TIMEOUT_MS),
  );

  ws.on("message", (data, isBinary) => {
    try {
      const current = connectionState.get(ws);
      if (!current) {
        if (isBinary) throw new Error("Expected plaintext Symphony hello");
        const accepted = acceptHello(
          rawText(data),
          {
            id: HOST_ID,
            publicKey: hostKeys.publicKey,
            secretKey: hostKeys.secretKey,
          },
          (length) => new Uint8Array(randomBytes(length)),
        );
        connectionState.set(ws, accepted.state);
        ws.send(accepted.reply);
        console.log("[mock] Key exchange complete — waiting for encrypted device auth");
        return;
      }

      if (!isBinary) throw new Error("Plaintext is forbidden after Symphony hello");
      const plaintext = decryptClientFrame(rawBytes(data), current);
      const message = parseRecord(plaintext);

      if (current.phase === "awaiting_auth") {
        authenticate(plaintext, current, {
          deviceId: DEVICE_ID,
          deviceToken: AUTH_TOKEN,
        });
        clearHandshakeTimer(ws);
        sendEncrypted(ws, current, {
          type: "authenticated",
          protocol: 1,
          host_id: HOST_ID,
        });
        scheduleMockDisconnect(ws);
        console.log("[mock] Encrypted device authentication complete");
        return;
      }

      if (message.type === "unsubscribe" && typeof message.subscription_id === "string") {
        const removed = unsubscribe(ws, message.subscription_id);
        sendEncrypted(
          ws,
          current,
          removed
            ? success(message.subscription_id, { unsubscribed: true })
            : error(
                message.subscription_id,
                "subscription_not_found",
                "RPC subscription was not found",
                false,
              ),
        );
        return;
      }
      if (message.type === "cancel" && typeof message.id === "string") {
        const cancelled = cancelRequest(ws, message.id);
        sendEncrypted(
          ws,
          current,
          cancelled
            ? error(message.id, "cancelled", "RPC request was cancelled", false)
            : error(message.id, "request_not_found", "RPC request is not running", false),
        );
        return;
      }
      if (!isRpcRequest(message)) {
        sendEncrypted(
          ws,
          current,
          error("unknown", "invalid_envelope", "Invalid RPC envelope", false),
        );
        return;
      }

      console.log(`[mock] ${message.method} (id: ${message.id})`);
      handleRequest(
        message,
        (response) => {
          if (ws.readyState === ws.OPEN) sendEncrypted(ws, current, response);
        },
        ws,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "invalid encrypted RPC frame";
      console.warn(`[mock] Closing invalid client: ${message}`);
      ws.close(1008, "invalid encrypted RPC frame");
    }
  });

  ws.on("close", () => {
    cleanup(ws);
    console.log("[mock] Client disconnected");
  });
  ws.on("error", () => {
    cleanup(ws);
    ws.close();
  });
});

wss.on("listening", () => {
  const hostPublicKey = Buffer.from(hostKeys.publicKey).toString("base64url");
  const pairingUrl = encodePairingOffer({
    v: 1,
    endpoint: ENDPOINT,
    hostId: HOST_ID,
    hostName: HOST_NAME,
    hostPublicKey,
    deviceId: DEVICE_ID,
    deviceToken: AUTH_TOKEN,
    scope: "mobile",
    protocolMin: 1,
    protocolMax: 1,
  });

  console.log(`[mock] Symphony mock server listening on ${ENDPOINT}`);
  console.log(`[mock] Host: ${HOST_NAME} (${HOST_ID})`);
  console.log(`[mock] Host public key: ${hostPublicKey}`);
  publishPairingUrl(pairingUrl);
  console.log(
    `[mock] Scenario: ${mockScenarioSummary.projectCount} project, ${mockScenarioSummary.taskCount} task, ${mockScenarioSummary.sessionCount} session, ${mockScenarioSummary.rpcDelayMs}ms default RPC delay`,
  );
  console.log("[mock] E2EE enabled — only the initial hello is plaintext");
});

function sendEncrypted(ws: WebSocket, state: E2EEState, response: unknown): void {
  ws.send(encryptHostFrame(JSON.stringify(response), state));
}

function publishPairingUrl(pairingUrl: string): void {
  const outputPath = process.env.MOCK_PAIRING_FILE;
  if (outputPath) {
    writeFileSync(outputPath, `${pairingUrl}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(outputPath, 0o600);
    console.log(`[mock] Pairing offer written with mode 0600 to ${outputPath}`);
    return;
  }
  if (process.stdout.isTTY) {
    console.log(`[mock] SECRET LOCAL PAIRING_URL=${pairingUrl}`);
    return;
  }
  console.log(
    "[mock] Pairing secret withheld from non-interactive output; set MOCK_PAIRING_FILE to a private path",
  );
}

function scheduleMockDisconnect(ws: WebSocket): void {
  if (disconnectAfterMs === null) return;
  if (disconnectOnce && disconnectTriggered) return;
  disconnectTriggered = true;
  disconnectTimers.set(
    ws,
    setTimeout(() => {
      disconnectTimers.delete(ws);
      if (ws.readyState === ws.OPEN) ws.close(1012, "mock disconnect");
    }, disconnectAfterMs),
  );
}

function cleanup(ws: WebSocket): void {
  clearHandshakeTimer(ws);
  const disconnectTimer = disconnectTimers.get(ws);
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimers.delete(ws);
  cleanupConnection(ws);
  connectionState.delete(ws);
}

function clearHandshakeTimer(ws: WebSocket): void {
  const timer = handshakeTimers.get(ws);
  if (timer) clearTimeout(timer);
  handshakeTimers.delete(ws);
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

function rawBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function parseRecord(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid RPC envelope");
  }
  return parsed as Record<string, unknown>;
}

function isRpcRequest(message: Record<string, unknown>): message is RpcRequest {
  return (
    message.type === "rpc" &&
    typeof message.id === "string" &&
    message.id.length > 0 &&
    typeof message.method === "string" &&
    message.method.length > 0 &&
    typeof message.params === "object" &&
    message.params !== null &&
    !Array.isArray(message.params)
  );
}

function positivePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

process.once("SIGINT", () => {
  for (const ws of connectionState.keys()) ws.close(1001, "mock server stopping");
  wss.close(() => process.exit(0));
});
