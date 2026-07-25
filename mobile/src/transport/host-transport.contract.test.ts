import { describe, expect, it, vi } from "vitest";

import type { TrackerClient } from "@/api/contracts";
import type { RpcClient } from "@/rpc/client";

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
    transport.close();
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
