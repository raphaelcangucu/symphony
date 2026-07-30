import { describe, expect, it, vi } from "vitest";

import type { TrackerClient } from "@/api/contracts";
import { RpcError, type RpcClient } from "@/rpc/client";

import { LegacyHostTransport } from "./LegacyHostTransport";
import { RpcHostTransport } from "./RpcHostTransport";
import type { HostTransport } from "./HostTransport";

const fixtures = {
  health: { status: "healthy" },
  projects: [{ id: "project_1", slug: "symphony", name: "Symphony" }],
  tasks: [
    {
      id: "task_1",
      identifier: "SYM-1",
      displayIdentifier: "SYM-1",
      projectSlug: "symphony",
      title: "Direct host RPC",
      description: null,
      status: "In Progress",
      priority: 2,
      position: 1,
      labels: [],
      assignee: null,
      creator: null,
      agentKind: "codex" as const,
      agentGoal: null,
      branchName: null,
      createdAt: "2026-07-25T12:00:00Z",
      updatedAt: "2026-07-25T12:00:00Z",
    },
  ],
  threads: [],
  capabilities: { methods: ["projects.list", "tasks.list", "sessions.list"] },
};

describe.each([
  ["rpc", createRpcTransport],
  ["legacy", createLegacyTransport],
] as const)("HostTransport contract: %s", (_kind, createTransport) => {
  it("returns the same host health, project, task, thread and capability models", async () => {
    const transport = createTransport();

    await expect(transport.call("system.health", {})).resolves.toEqual(fixtures.health);
    await expect(transport.call("projects.list", {})).resolves.toEqual(fixtures.projects);
    await expect(transport.call("tasks.list", { project_slug: "symphony" })).resolves.toEqual(
      fixtures.tasks,
    );
    await expect(transport.call("sessions.list", {})).resolves.toEqual(fixtures.threads);
    await expect(transport.call("system.capabilities", {})).resolves.toEqual(fixtures.capabilities);
  });

  it("supports stream cleanup, reconnect and close without changing domain payloads", async () => {
    const transport = createTransport();
    const events: unknown[] = [];
    const unsubscribe = await transport.subscribe("sessions.events", {}, (event) =>
      events.push(event),
    );

    expect(events).toEqual([{ type: "session.updated", id: "thread_1" }]);
    unsubscribe();
    transport.reconnect();
    transport.deactivate();
    transport.close();
  });
});

describe("RpcHostTransport reconnectable streams", () => {
  it("rejects the disconnected generation and re-subscribes logical streams when online again", async () => {
    const remoteCleanups: Array<ReturnType<typeof vi.fn>> = [];
    const rpc = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ subscription_id: "sub_1" })
        .mockResolvedValueOnce({ subscription_id: "sub_2" }),
      trackSubscription: vi.fn((_id: string, _handler: (event: unknown) => void) => {
        const cleanup = vi.fn();
        remoteCleanups.push(cleanup);
        return cleanup;
      }),
      resetConnection: vi.fn(),
      close: vi.fn(),
    } as unknown as RpcClient;
    const transport = new RpcHostTransport("host_1", rpc, { reconnect: vi.fn() });

    const unsubscribe = await transport.subscribe("sessions.events", {}, vi.fn());
    transport.handleDisconnect();
    await transport.handleOnline();

    expect(rpc.resetConnection).toHaveBeenCalledTimes(1);
    expect(rpc.call).toHaveBeenNthCalledWith(1, "sessions.subscribe", {});
    expect(rpc.call).toHaveBeenNthCalledWith(2, "sessions.subscribe", {});
    unsubscribe();
    expect(remoteCleanups.at(-1)).toHaveBeenCalledTimes(1);
  });

  it("keeps a cold-start subscription pending until the RPC socket comes online", async () => {
    const rpc = {
      call: vi
        .fn()
        .mockRejectedValueOnce(
          new RpcError("connection_unavailable", "RPC connection is offline", true),
        )
        .mockResolvedValueOnce({ subscription_id: "sub_online" }),
      trackSubscription: vi.fn(() => vi.fn()),
      resetConnection: vi.fn(),
      close: vi.fn(),
    } as unknown as RpcClient;
    const transport = new RpcHostTransport("host_1", rpc, { reconnect: vi.fn() });

    const pendingSubscription = transport.subscribe("terminal.events", { thread_id: 7 }, vi.fn());
    await vi.waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1));

    await transport.handleOnline();
    const unsubscribe = await pendingSubscription;

    expect(rpc.call).toHaveBeenNthCalledWith(2, "terminal.subscribe", { thread_id: 7 });
    expect(rpc.trackSubscription).toHaveBeenCalledWith("sub_online", expect.any(Function));
    unsubscribe();
  });

  it("rejects retryable RPC method errors instead of waiting for another socket transition", async () => {
    const rpc = {
      call: vi.fn().mockRejectedValue(new RpcError("deadline_exceeded", "Host timed out", true)),
      trackSubscription: vi.fn(),
      resetConnection: vi.fn(),
      close: vi.fn(),
    } as unknown as RpcClient;
    const transport = new RpcHostTransport("host_1", rpc, { reconnect: vi.fn() });

    await expect(transport.subscribe("sessions.events", {}, vi.fn())).rejects.toMatchObject({
      code: "deadline_exceeded",
    });
  });

  it("rejects a pending cold-start subscription when the transport closes", async () => {
    const rpc = {
      call: vi
        .fn()
        .mockRejectedValue(
          new RpcError("connection_unavailable", "RPC connection is offline", true),
        ),
      trackSubscription: vi.fn(),
      resetConnection: vi.fn(),
      close: vi.fn(),
    } as unknown as RpcClient;
    const transport = new RpcHostTransport("host_1", rpc, { reconnect: vi.fn() });

    const pendingSubscription = transport.subscribe("terminal.events", { thread_id: 7 }, vi.fn());
    await vi.waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1));
    transport.close();

    await expect(pendingSubscription).rejects.toMatchObject({ code: "connection_closed" });
  });
});

function createRpcTransport(): HostTransport {
  let eventHandler: ((event: unknown) => void) | null = null;
  const rpc = {
    call: vi.fn((method: string) => {
      if (method === "sessions.subscribe") {
        eventHandler?.({ type: "session.updated", id: "thread_1" });
        return Promise.resolve({ subscription_id: "sub_1" });
      }
      return Promise.resolve(rpcFixture(method));
    }),
    trackSubscription: vi.fn((_id: string, handler: (event: unknown) => void) => {
      handler({ type: "session.updated", id: "thread_1" });
      return vi.fn();
    }),
    resetConnection: vi.fn(),
    close: vi.fn(),
  } as unknown as RpcClient;

  eventHandler = () => undefined;
  return new RpcHostTransport("host_1", rpc, { reconnect: vi.fn() });
}

function createLegacyTransport(): HostTransport {
  const client = {
    health: vi.fn().mockResolvedValue(fixtures.health),
    projects: vi.fn().mockResolvedValue(fixtures.projects),
    issues: vi.fn().mockResolvedValue(fixtures.tasks),
    threads: vi.fn().mockResolvedValue(fixtures.threads),
  } as unknown as TrackerClient;

  return new LegacyHostTransport("legacy_1", client, {
    subscribe: async (_method, _params, onEvent) => {
      onEvent({ type: "session.updated", id: "thread_1" });
      return vi.fn();
    },
    reconnect: vi.fn(),
    deactivate: vi.fn(),
    close: vi.fn(),
    capabilities: fixtures.capabilities,
  });
}

function rpcFixture(method: string): unknown {
  switch (method) {
    case "system.health":
      return fixtures.health;
    case "projects.list":
      return fixtures.projects;
    case "tasks.list":
      return fixtures.tasks;
    case "sessions.list":
      return fixtures.threads;
    case "system.capabilities":
      return fixtures.capabilities;
    default:
      throw new Error(`Unexpected RPC method ${method}`);
  }
}
