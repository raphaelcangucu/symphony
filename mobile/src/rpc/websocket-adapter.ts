import { getRandomBytes } from "expo-crypto";

import type { PairingOfferV1 } from "../auth/pairing-offer";
import type { RpcWireTransport } from "./client";
import { MobileHandshake, type HandshakeState } from "./handshake";

export type HandshakeWebSocketCallbacks = {
  onStateChange: (state: HandshakeState) => void;
  onOnline: (transport: RpcWireTransport) => void;
  onError: (error: Error) => void;
};

export class HandshakeWebSocketAdapter implements RpcWireTransport {
  private readonly offer: PairingOfferV1;
  private readonly callbacks: HandshakeWebSocketCallbacks;
  private socket: WebSocket | null = null;
  private handshake: MobileHandshake | null = null;
  private readonly messageHandlers = new Set<(message: string) => void>();

  constructor(offer: PairingOfferV1, callbacks: HandshakeWebSocketCallbacks) {
    this.offer = offer;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.close();
    const handshake = new MobileHandshake(this.offer, {
      randomBytes: (length) => getRandomBytes(length),
    });
    this.handshake = handshake;
    const socket = new WebSocket(this.offer.endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.callbacks.onStateChange("connecting");

    socket.onopen = () => {
      try {
        socket.send(handshake.start());
        this.callbacks.onStateChange(handshake.state);
      } catch (error) {
        this.fail(error, socket);
      }
    };

    socket.onmessage = (event) => {
      try {
        if (typeof event.data === "string" && handshake.state !== "online") {
          handshake.acceptServerHello(event.data);
          this.callbacks.onStateChange(handshake.state);
          socket.send(handshake.createAuthFrame());
          return;
        }

        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new Uint8Array(event.data as ArrayBufferLike);
        if (handshake.state === "authenticating") {
          handshake.acceptServerFrame(bytes);
          this.callbacks.onStateChange(handshake.state);
          this.callbacks.onOnline(this);
        } else {
          const message = handshake.decryptRpcFrame(bytes);
          for (const handler of this.messageHandlers) handler(message);
        }
      } catch (error) {
        this.fail(error, socket);
      }
    };

    socket.onerror = () => this.fail(new Error("Unable to reach the Symphony host"), socket);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handshake = null;
      this.callbacks.onError(new Error("Symphony host closed the RPC connection"));
    };
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.handshake = null;
    if (!socket) return;
    detachSocket(socket);
    socket.close();
  }

  send(message: string): void {
    if (!this.socket || !this.handshake || this.handshake.state !== "online") {
      throw new Error("Symphony RPC socket is not online");
    }
    this.socket.send(this.handshake.encryptRpcMessage(message));
  }

  onMessage(handler: (message: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private fail(error: unknown, socket: WebSocket): void {
    if (this.socket !== socket) return;
    const normalized = error instanceof Error ? error : new Error("Symphony handshake failed");
    const state = this.handshake?.state;
    this.socket = null;
    this.handshake = null;
    detachSocket(socket);
    socket.close();
    if (state === "revoked" || state === "host_key_mismatch" || state === "protocol_incompatible") {
      this.callbacks.onStateChange(state);
    }
    this.callbacks.onError(normalized);
  }
}

function detachSocket(socket: WebSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
}
