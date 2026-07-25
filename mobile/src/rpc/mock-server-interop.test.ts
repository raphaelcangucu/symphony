import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import WebSocket, { type RawData } from "ws";
import { describe, expect, it } from "vitest";

import { parsePairingOffer } from "../auth/pairing-offer";
import { MobileHandshake } from "./handshake";

describe("standalone Symphony mock server", () => {
  it("pairs through the production handshake and serves encrypted RPC plus streams", async () => {
    const port = 42_000 + Math.floor(Math.random() * 1_000);
    const privateDirectory = mkdtempSync(path.join(tmpdir(), "symphony-mock-"));
    const pairingFile = path.join(privateDirectory, "pairing.txt");
    const child = startServer(port, pairingFile);
    let socket: WebSocket | null = null;
    try {
      const pairingUrl = await readPairingUrl(child, pairingFile);
      const offer = parsePairingOffer(pairingUrl);
      const handshake = new MobileHandshake(offer, {
        randomBytes: (length) => new Uint8Array(randomBytes(length)),
      });
      socket = new WebSocket(offer.endpoint);
      const inbox = messageInbox(socket);
      await once(socket, "open");

      socket.send(handshake.start());
      const hello = await inbox.read();
      expect(hello.binary).toBe(false);
      handshake.acceptServerHello(hello.text);
      socket.send(handshake.createAuthFrame());
      const authenticated = await inbox.read();
      expect(authenticated.binary).toBe(true);
      expect(handshake.acceptServerFrame(authenticated.bytes)).toMatchObject({
        type: "authenticated",
        host_id: "host_mock",
      });

      socket.send(
        handshake.encryptRpcMessage(
          JSON.stringify({
            type: "rpc",
            id: "health",
            method: "system.health",
            params: {},
          }),
        ),
      );
      expect(decrypt(handshake, await inbox.read())).toMatchObject({
        id: "health",
        ok: true,
        result: { status: "healthy" },
        meta: { host_id: "host_mock", protocol: 1 },
      });

      socket.send(
        handshake.encryptRpcMessage(
          JSON.stringify({
            type: "rpc",
            id: "terminal",
            method: "terminal.subscribe",
            params: { thread_id: 101 },
          }),
        ),
      );
      const subscribed = decrypt(handshake, await inbox.read());
      expect(subscribed).toMatchObject({
        id: "terminal",
        result: { subscription_id: expect.any(String) },
      });
      expect(decrypt(handshake, await inbox.read())).toMatchObject({
        type: "event",
        sequence: 1,
        event: "terminal.joined",
      });
      expect(decrypt(handshake, await inbox.read())).toMatchObject({
        type: "event",
        sequence: 2,
        event: "terminal.output",
      });
    } finally {
      socket?.close();
      child.kill("SIGINT");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      rmSync(privateDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});

function startServer(port: number, pairingFile: string): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/mock-server.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        MOCK_PAIRING_FILE: pairingFile,
      },
      stdio: "pipe",
    },
  );
}

async function readPairingUrl(
  child: ChildProcessWithoutNullStreams,
  pairingFile: string,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(pairingFile)) return readFileSync(pairingFile, "utf8").trim();
    if (child.exitCode !== null) {
      throw new Error(`Mock server exited during startup (${String(child.exitCode)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Mock server startup timed out");
}

function messageInbox(socket: WebSocket): {
  read(): Promise<{ binary: boolean; bytes: Uint8Array; text: string }>;
} {
  type Message = { binary: boolean; bytes: Uint8Array; text: string };
  const queue: Message[] = [];
  const waiters: Array<(message: Message) => void> = [];
  socket.on("message", (data, binary) => {
    const bytes = rawBytes(data);
    const message = { binary, bytes, text: Buffer.from(bytes).toString("utf8") };
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return {
    read: () =>
      new Promise((resolve) => {
        const message = queue.shift();
        if (message) resolve(message);
        else waiters.push(resolve);
      }),
  };
}

function decrypt(
  handshake: MobileHandshake,
  message: { bytes: Uint8Array },
): Record<string, unknown> {
  return JSON.parse(handshake.decryptRpcFrame(message.bytes)) as Record<string, unknown>;
}

function rawBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
