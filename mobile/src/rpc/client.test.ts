import { describe, expect, it, vi } from "vitest";

import { RpcClient, RpcError, type RpcWireTransport } from "./client";

class FakeTransport implements RpcWireTransport {
  readonly sent: string[] = [];
  private handler: ((message: string) => void) | null = null;

  send(message: string): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: string) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  receive(message: unknown): void {
    this.handler?.(JSON.stringify(message));
  }
}

describe("RpcClient", () => {
  it("assigns unique ids and resolves only schema-valid matching results", async () => {
    const transport = new FakeTransport();
    let nextId = 0;
    const client = new RpcClient(transport, { createId: () => `rpc_${++nextId}` });

    const first = client.call<{ status: string }>("system.health", {});
    const second = client.call<{ host_id: string }>("system.identity", {});
    expect(transport.sent.map((frame) => JSON.parse(frame).id)).toEqual(["rpc_1", "rpc_2"]);

    transport.receive({
      type: "result",
      id: "rpc_2",
      ok: true,
      result: { host_id: "host_01" },
      meta: metadata(),
    });
    transport.receive({
      type: "result",
      id: "rpc_1",
      ok: true,
      result: { status: "healthy" },
      meta: metadata(),
    });

    await expect(first).resolves.toEqual({ status: "healthy" });
    await expect(second).resolves.toEqual({ host_id: "host_01" });
    client.close();
  });

  it("turns structured failures into RpcError without leaking diagnostic secrets", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport, { createId: () => "rpc_error" });
    const request = client.call("unknown.secret", { device_token: "never-log-this" });

    transport.receive({
      type: "result",
      id: "rpc_error",
      ok: false,
      error: {
        code: "method_not_allowed",
        message: "RPC method is not available to mobile",
        retryable: false,
      },
      meta: metadata(),
    });

    const error = await request.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: "method_not_allowed", retryable: false });
    expect(String(error)).not.toContain("never-log-this");
    client.close();
  });

  it("sends cancellation on deadline and abort", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    let nextId = 0;
    const client = new RpcClient(transport, { createId: () => `rpc_${++nextId}` });

    const timedOut = client.call("system.usage", {}, { deadlineMs: 25 });
    const timedOutExpectation = expect(timedOut).rejects.toMatchObject({
      code: "deadline_exceeded",
    });
    await vi.advanceTimersByTimeAsync(25);
    await timedOutExpectation;
    expect(JSON.parse(transport.sent.at(-1) ?? "{}")).toEqual({ type: "cancel", id: "rpc_1" });

    const controller = new AbortController();
    const aborted = client.call("system.health", {}, { signal: controller.signal });
    const abortedExpectation = expect(aborted).rejects.toMatchObject({ code: "cancelled" });
    controller.abort();
    await abortedExpectation;
    expect(JSON.parse(transport.sent.at(-1) ?? "{}")).toEqual({ type: "cancel", id: "rpc_2" });

    client.close();
    vi.useRealTimers();
  });

  it("routes ordered stream events and cleans subscriptions on unsubscribe and close", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport, { createId: () => "rpc_subscribe" });
    const events: string[] = [];
    const subscription = client.trackSubscription("sub_01", (event) =>
      events.push(event as string),
    );

    transport.receive({
      type: "event",
      subscription_id: "sub_01",
      sequence: 1,
      event: "session.delta",
      payload: "first",
    });
    transport.receive({
      type: "event",
      subscription_id: "sub_01",
      sequence: 2,
      event: "session.delta",
      payload: "second",
    });

    expect(events).toEqual(["first", "second"]);
    subscription();
    expect(JSON.parse(transport.sent.at(-1) ?? "{}")).toEqual({
      type: "unsubscribe",
      subscription_id: "sub_01",
    });

    client.close();
    expect(client.subscriptionCount).toBe(0);
  });
});

function metadata() {
  return {
    host_id: "host_01",
    protocol: 1,
    server_timestamp: "2026-07-25T12:00:00.000000Z",
  };
}
