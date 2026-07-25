import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PairingOfferV1 } from "../auth/pairing-offer";
import { HandshakeWebSocketAdapter } from "./websocket-adapter";

vi.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
}));

const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "wss://host.test/mobile/rpc",
  hostId: "host_1",
  hostName: "Studio",
  hostPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  deviceId: "device_1",
  deviceToken: "device-token",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly close = vi.fn(() => this.onclose?.());
  readonly send = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
}

describe("HandshakeWebSocketAdapter lifecycle", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an unexpected socket close exactly once", () => {
    const onError = vi.fn();
    const adapter = createAdapter(onError);
    adapter.connect();

    FakeWebSocket.instances[0]?.onclose?.();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message: "Symphony host closed the RPC connection",
    });
  });

  it("does not report intentional close or report error and close twice", () => {
    const onError = vi.fn();
    const adapter = createAdapter(onError);
    adapter.connect();
    const socket = FakeWebSocket.instances[0]!;

    adapter.close();
    expect(onError).not.toHaveBeenCalled();

    adapter.connect();
    const failedSocket = FakeWebSocket.instances[1]!;
    failedSocket.onerror?.();
    failedSocket.onclose?.();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("publishes terminal handshake state before its error", () => {
    const onStateChange = vi.fn();
    const onError = vi.fn();
    const adapter = new HandshakeWebSocketAdapter(offer, {
      onStateChange,
      onOnline: vi.fn(),
      onError,
    });
    adapter.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.onopen?.();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "hello_ack",
        protocol: 1,
        host_id: "host_attacker",
        host_public_key: offer.hostPublicKey,
        server_nonce: offer.hostPublicKey,
      }),
    });

    expect(onStateChange).toHaveBeenLastCalledWith("host_key_mismatch");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

function createAdapter(onError: (error: Error) => void): HandshakeWebSocketAdapter {
  return new HandshakeWebSocketAdapter(offer, {
    onStateChange: vi.fn(),
    onOnline: vi.fn(),
    onError,
  });
}
