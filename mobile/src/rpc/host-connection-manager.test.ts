import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { HostConnectionManager, hostQueryKey, type ManagedHost } from "./host-connection-manager";

function fakeHost(id: string) {
  const subscriptions = new Set<() => void>();
  const transport: HostTransport = {
    hostId: id,
    call: vi.fn(async (method: string) => {
      if (method === "system.heartbeat") return { nonce: "heartbeat" };
      return { id: "shared-id", hostId: id };
    }),
    subscribe: vi.fn(async (_method, _params, onEvent) => {
      onEvent({ id: "shared-id", hostId: id });
      const cleanup = vi.fn();
      subscriptions.add(cleanup);
      return () => {
        cleanup();
        subscriptions.delete(cleanup);
      };
    }),
    reconnect: vi.fn(),
    close: vi.fn(),
  };
  const host: ManagedHost = {
    hostId: id,
    endpoint: `wss://${id}.test/mobile/rpc`,
    fingerprint: `sha256:${id}`,
    protocolVersion: 1,
    transport,
  };
  return { host, transport, subscriptions };
}

describe("HostConnectionManager isolation", () => {
  it("namespaces identical project, thread and task ids by host", () => {
    expect(hostQueryKey("host_a", "tasks", "shared-id")).toEqual([
      "host",
      "host_a",
      "tasks",
      "shared-id",
    ]);
    expect(hostQueryKey("host_b", "tasks", "shared-id")).not.toEqual(
      hostQueryKey("host_a", "tasks", "shared-id"),
    );
  });

  it("closes old subscriptions and transport before selecting another host", async () => {
    const first = fakeHost("host_a");
    const second = fakeHost("host_b");
    const manager = new HostConnectionManager();
    manager.register(first.host);
    manager.register(second.host);
    manager.select("host_a");
    const unsubscribe = await manager.subscribe("sessions.events", {}, vi.fn());

    manager.select("host_b");

    expect(first.transport.close).toHaveBeenCalledTimes(1);
    expect(first.subscriptions.size).toBe(0);
    expect(manager.activeHostId).toBe("host_b");
    unsubscribe();
  });
});

describe("HostConnectionManager reconnection", () => {
  it("marks stale after two missed heartbeats and uses capped exponential backoff", async () => {
    vi.useFakeTimers();
    const current = fakeHost("host_a");
    vi.mocked(current.transport.call).mockRejectedValue(new Error("offline"));
    const manager = new HostConnectionManager({
      heartbeatIntervalMs: 1_000,
      baseReconnectDelayMs: 500,
      maxReconnectDelayMs: 1_000,
      jitter: () => 0,
    });
    manager.register(current.host);
    manager.select("host_a");
    manager.startHeartbeat();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(manager.state("host_a").status).toBe("reconnecting");
    expect(manager.state("host_a").missedHeartbeats).toBe(2);

    await vi.advanceTimersByTimeAsync(500);
    expect(current.transport.reconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(current.transport.reconnect).toHaveBeenCalledTimes(2);

    manager.close();
    vi.useRealTimers();
  });

  it("retries immediately on foreground/network and preserves terminal security states", () => {
    const current = fakeHost("host_a");
    const manager = new HostConnectionManager();
    manager.register(current.host);
    manager.select("host_a");

    manager.markFailure("host_a", "host_key_mismatch");
    manager.onForeground();
    manager.onNetworkReachable();
    expect(current.transport.reconnect).not.toHaveBeenCalled();

    manager.markFailure("host_a", "offline");
    manager.onForeground();
    manager.onNetworkReachable();
    expect(current.transport.reconnect).toHaveBeenCalledTimes(2);

    manager.markFailure("host_a", "revoked");
    expect(manager.state("host_a").status).toBe("revoked");
    manager.close();
  });

  it("exports only redacted reachability diagnostics", () => {
    const current = fakeHost("host_a");
    const manager = new HostConnectionManager();
    manager.register(current.host);
    manager.markFailure("host_a", "protocol_incompatible");

    expect(manager.diagnostics("host_a")).toEqual({
      hostId: "host_a",
      endpoint: "wss://host_a.test/mobile/rpc",
      fingerprint: "sha256:host_a",
      protocolVersion: 1,
      heartbeatAgeMs: null,
      failureCode: "protocol_incompatible",
    });
    expect(JSON.stringify(manager.diagnostics("host_a"))).not.toMatch(/token|secret/i);
  });
});
