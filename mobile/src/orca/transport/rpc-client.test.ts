import { describe, expect, it, vi } from "vitest";

import { RpcError } from "@/rpc/client";
import type { HostTransport } from "@/transport/HostTransport";

import {
  createSymphonyOrcaRpcClient,
  type OrcaConnectionStateSource,
} from "./rpc-client";

function fakeTransport(responses: Record<string, unknown>): HostTransport {
  return {
    hostId: "host-a",
    call: vi.fn(async (method) => responses[method]),
    subscribe: vi.fn(async () => () => undefined),
    reconnect: vi.fn(),
    deactivate: vi.fn(),
    close: vi.fn(),
  };
}

function rejectingTransport(error: Error): HostTransport {
  return {
    ...fakeTransport({}),
    call: vi.fn(async () => {
      throw error;
    }),
  };
}

function stateSource(
  state: ReturnType<OrcaConnectionStateSource["getState"]>,
): OrcaConnectionStateSource {
  return {
    getState: () => state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    subscribe: () => () => undefined,
  };
}

describe("Symphony Orca RPC facade", () => {
  it("presents Symphony results with the response shape expected by Orca", async () => {
    const transport = fakeTransport({
      "status.get": { runtimeId: "host-a", version: "1" },
    });
    const client = createSymphonyOrcaRpcClient("host-a", transport, stateSource("connected"));

    await expect(client.sendRequest("status.get")).resolves.toEqual({
      id: expect.any(String),
      ok: true,
      result: { runtimeId: "host-a", version: "1" },
      _meta: { runtimeId: "host-a" },
    });
  });

  it("returns Orca failure envelopes without exposing encrypted transport details", async () => {
    const transport = rejectingTransport(new RpcError("offline", "Host offline", true));
    const client = createSymphonyOrcaRpcClient("host-a", transport, stateSource("disconnected"));

    await expect(client.sendRequest("status.get")).resolves.toMatchObject({
      ok: false,
      error: { code: "offline", message: "Host offline" },
    });
  });
});
