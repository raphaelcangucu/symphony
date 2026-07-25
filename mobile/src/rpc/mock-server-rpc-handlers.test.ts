import { afterEach, describe, expect, it, vi } from "vitest";

import { createRpcTrackerClient } from "../api/rpc-tracker-client";
import type { HostTransport } from "../transport/HostTransport";
import {
  cancelRequest,
  cleanupConnection,
  handleRequest,
  unsubscribe,
  type RpcResponse,
} from "../../scripts/mock-server-rpc-handlers";

describe("Symphony mock RPC handlers", () => {
  const socket = { readyState: 1, OPEN: 1 } as never;

  afterEach(() => {
    cleanupConnection(socket);
    delete process.env.MOCK_RPC_DELAY_SYSTEM_HEALTH_MS;
    vi.useRealTimers();
  });

  it("copies Orca's direct dispatcher shape with Symphony metadata and DTOs", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest({ type: "rpc", id: "health", method: "system.health", params: {} }, send, socket);
    handleRequest(
      {
        type: "rpc",
        id: "tasks",
        method: "tasks.request",
        params: {
          path: "/projects/symphony/issues",
          method: "GET",
          body: null,
          idempotency_key: null,
        },
      },
      send,
      socket,
    );

    expect(sent[0]).toMatchObject({
      type: "result",
      id: "health",
      ok: true,
      result: { status: "healthy" },
      meta: { host_id: "host_mock", protocol: 1 },
    });
    expect(sent[1]).toMatchObject({
      id: "tasks",
      ok: true,
      result: {
        data: [{ identifier: "SYM-101", project_slug: "symphony" }],
      },
    });
  });

  it("returns one subscription result followed by monotonic events and cleanup", async () => {
    vi.useFakeTimers();
    const sent: RpcResponse[] = [];

    handleRequest(
      {
        type: "rpc",
        id: "subscribe",
        method: "terminal.subscribe",
        params: { thread_id: 101 },
      },
      (message) => sent.push(message),
      socket,
    );
    await vi.runOnlyPendingTimersAsync();

    expect(sent[0]).toMatchObject({
      type: "result",
      id: "subscribe",
      ok: true,
      result: { subscription_id: expect.any(String) },
    });
    expect(sent.slice(1, 3)).toMatchObject([
      { type: "event", sequence: 1, event: "terminal.joined" },
      { type: "event", sequence: 2, event: "terminal.output" },
    ]);

    const subscriptionId = (sent[0] as { result: { subscription_id: string } }).result
      .subscription_id;
    expect(unsubscribe(socket, subscriptionId)).toBe(true);
  });

  it("fails closed for unknown methods without reflecting params", () => {
    const sent: RpcResponse[] = [];
    handleRequest(
      {
        type: "rpc",
        id: "unknown",
        method: "admin.secret",
        params: { device_token: "never-reflect" },
      },
      (message) => sent.push(message),
      socket,
    );

    expect(sent[0]).toMatchObject({
      ok: false,
      error: {
        code: "method_not_allowed",
        retryable: false,
      },
    });
    expect(JSON.stringify(sent[0])).not.toContain("never-reflect");
  });

  it("rejects non-allowlisted tracker routes without turning them into transport errors", () => {
    const sent: RpcResponse[] = [];
    handleRequest(
      {
        type: "rpc",
        id: "bad-route",
        method: "tasks.request",
        params: {
          path: "/projects/symphony/issues/SYM-101/admin",
          method: "POST",
        },
      },
      (message) => sent.push(message),
      socket,
    );
    handleRequest(
      { type: "rpc", id: "after-error", method: "system.health", params: {} },
      (message) => sent.push(message),
      socket,
    );

    expect(sent[0]).toMatchObject({
      id: "bad-route",
      ok: false,
      error: { code: "route_not_allowed" },
    });
    expect(sent[1]).toMatchObject({
      id: "after-error",
      ok: true,
      result: { status: "healthy" },
    });
  });

  it("feeds mock DTOs through the production tracker mappers", async () => {
    const transport: HostTransport = {
      hostId: "host_mock",
      call: (method, params) =>
        new Promise((resolve, reject) => {
          handleRequest(
            {
              type: "rpc",
              id: `mapper-${method}`,
              method,
              params: params as Record<string, unknown>,
            },
            (response) => {
              if (response.type !== "result") return;
              if (response.ok) resolve(response.result);
              else reject(new Error(response.error?.message));
            },
            socket,
          );
        }),
      subscribe: vi.fn(),
      reconnect: vi.fn(),
      deactivate: vi.fn(),
      close: vi.fn(),
    };
    const client = createRpcTrackerClient(transport);

    await expect(client.projects()).resolves.toEqual([
      { id: "1", slug: "symphony", name: "Symphony" },
    ]);
    await expect(client.issues("symphony")).resolves.toMatchObject([
      { identifier: "SYM-101", title: "Compare Orca and Symphony mobile" },
    ]);
    const files = await client.threadFiles(101);
    expect(files.available).toBe(true);
    expect(files.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "mobile/scripts/mock-server.ts" })]),
    );
    await expect(client.threadDiffStats(101)).resolves.toMatchObject({
      stats: [{ repo: "symphony", filesChanged: 2 }],
    });
    await expect(client.issuePullRequests("symphony", "SYM-101")).resolves.toMatchObject({
      pullRequests: [{ number: 7, isDraft: true }],
      supported: true,
    });
  });

  it("cancels delayed replies and clears their timers", async () => {
    vi.useFakeTimers();
    process.env.MOCK_RPC_DELAY_SYSTEM_HEALTH_MS = "1000";
    const sent: RpcResponse[] = [];
    handleRequest(
      { type: "rpc", id: "slow-health", method: "system.health", params: {} },
      (message) => sent.push(message),
      socket,
    );

    expect(sent).toEqual([]);
    expect(cancelRequest(socket, "slow-health")).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual([]);
    expect(cancelRequest(socket, "slow-health")).toBe(false);
  });

  it("clears delayed replies when a socket closes without subscriptions", async () => {
    vi.useFakeTimers();
    process.env.MOCK_RPC_DELAY_SYSTEM_HEALTH_MS = "1000";
    const sent: RpcResponse[] = [];
    handleRequest(
      { type: "rpc", id: "closing-health", method: "system.health", params: {} },
      (message) => sent.push(message),
      socket,
    );

    cleanupConnection(socket);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sent).toEqual([]);
    expect(cancelRequest(socket, "closing-health")).toBe(false);
  });
});
