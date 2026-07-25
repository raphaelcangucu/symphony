import { getRandomBytes } from "expo-crypto";

import type { PairingOfferV1 } from "../auth/pairing-offer";
import { MobileHandshake, type HandshakeState } from "./handshake";

export type HandshakeWebSocketCallbacks = {
  onStateChange: (state: HandshakeState) => void;
  onOnline: (socket: WebSocket) => void;
  onError: (error: Error) => void;
};

export class HandshakeWebSocketAdapter {
  private readonly offer: PairingOfferV1;
  private readonly callbacks: HandshakeWebSocketCallbacks;
  private socket: WebSocket | null = null;

  constructor(offer: PairingOfferV1, callbacks: HandshakeWebSocketCallbacks) {
    this.offer = offer;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.close();
    const handshake = new MobileHandshake(this.offer, {
      randomBytes: (length) => getRandomBytes(length),
    });
    const socket = new WebSocket(this.offer.endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.callbacks.onStateChange("connecting");

    socket.onopen = () => {
      try {
        socket.send(handshake.start());
        this.callbacks.onStateChange(handshake.state);
      } catch (error) {
        this.fail(error);
      }
    };

    socket.onmessage = (event) => {
      try {
        if (typeof event.data === "string") {
          handshake.acceptServerHello(event.data);
          this.callbacks.onStateChange(handshake.state);
          socket.send(handshake.createAuthFrame());
          return;
        }

        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : new Uint8Array(event.data as ArrayBufferLike);
        handshake.acceptServerFrame(bytes);
        this.callbacks.onStateChange(handshake.state);
        this.callbacks.onOnline(socket);
      } catch (error) {
        this.fail(error);
      }
    };

    socket.onerror = () => this.fail(new Error("Unable to reach the Symphony host"));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private fail(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error("Symphony handshake failed");
    this.callbacks.onError(normalized);
    this.close();
  }
}
