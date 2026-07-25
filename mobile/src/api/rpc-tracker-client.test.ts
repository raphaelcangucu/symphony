import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcTrackerClient } from "./rpc-tracker-client";

describe("createRpcTrackerClient", () => {
  it("preserves tracker DTO mapping while routing every call to the selected host", async () => {
    const transport = fakeTransport();
    const client = createRpcTrackerClient(transport);

    await expect(client.projects()).resolves.toEqual([
      { id: "project-1", slug: "symphony", name: "Symphony" },
    ]);
    await expect(client.issues("mobile app", { query: "Orca" })).resolves.toEqual([
      expect.objectContaining({
        id: "issue-7",
        projectSlug: "mobile app",
        title: "Bring Orca workflows",
      }),
    ]);

    expect(transport.call).toHaveBeenNthCalledWith(
      1,
      "projects.request",
      {
        body: null,
        idempotency_key: null,
        method: "GET",
        path: "/projects",
      },
      undefined,
    );
    expect(transport.call).toHaveBeenNthCalledWith(
      2,
      "tasks.request",
      expect.objectContaining({
        method: "GET",
        path: "/projects/mobile%20app/issues?q=Orca",
      }),
      undefined,
    );
  });

  it("routes idempotent session creation and host health without bearer credentials", async () => {
    const transport = fakeTransport();
    const client = createRpcTrackerClient(transport);

    await expect(client.health()).resolves.toEqual({ status: "healthy" });
    await client.createThread({
      requestKey: "mobile-create-1",
      scope: "freeform",
      agentKind: "codex",
    });

    expect(transport.call).toHaveBeenNthCalledWith(1, "system.health", {}, undefined);
    expect(transport.call).toHaveBeenNthCalledWith(
      2,
      "sessions.request",
      expect.objectContaining({
        idempotency_key: "mobile-create-1",
        method: "POST",
        path: "/assistant/threads",
      }),
      undefined,
    );
    expect(JSON.stringify(vi.mocked(transport.call).mock.calls)).not.toContain("Bearer");
  });

  it("routes workspace, git, preview, PR and notification operations by domain", async () => {
    const transport = fakeTransport();
    const client = createRpcTrackerClient(transport);

    await client.threadFiles(42);
    await client.threadDiffStats(42);
    await client.threadDevServers(42);
    await client.issuePullRequests("symphony", "SYM-7");
    await client.registerMobilePush({
      profileId: "host-1",
      deviceId: "device-1",
      platform: "android",
      token: "expo-push-token",
    });

    expect(vi.mocked(transport.call).mock.calls.map(([method]) => method)).toEqual([
      "workspace.request",
      "git.request",
      "previews.request",
      "pull_requests.request",
      "notifications.request",
    ]);
  });
});

function fakeTransport(): HostTransport {
  return {
    hostId: "host-1",
    call: vi.fn(async (method: string) => {
      if (method === "system.health") return { status: "healthy" };
      if (method === "projects.request") {
        return { data: [{ id: "project-1", slug: "symphony", name: "Symphony" }] };
      }
      if (method === "tasks.request") {
        return {
          data: [
            {
              id: "issue-7",
              identifier: "MOB-7",
              display_identifier: "MOB-7",
              project_slug: "mobile app",
              title: "Bring Orca workflows",
              description: null,
              status: { name: "In Progress" },
              priority: 1,
              position: 0,
              labels: [],
              assignee: null,
              creator: null,
              agent: "codex",
              agent_goal: null,
              branch_name: null,
              created_at: "2026-07-25T00:00:00Z",
              updated_at: "2026-07-25T00:00:00Z",
            },
          ],
        };
      }
      if (method === "sessions.request") {
        return {
          data: {
            id: 42,
            scope: "freeform",
            title: null,
            status: "idle",
            updated_at: "2026-07-25T00:00:00Z",
          },
        };
      }
      if (method === "workspace.request") {
        return { data: { available: true, reason: null, files: [] } };
      }
      if (method === "git.request") {
        return { data: [], workspace: { path: "/work", available: true } };
      }
      if (method === "previews.request") {
        return { data: { available: true, reason: null, servers: [] } };
      }
      if (method === "pull_requests.request") {
        return { data: [], supported: true, available: true, children: [] };
      }
      if (method === "notifications.request") {
        return { data: { registered: true, device_id: "device-1" } };
      }
      throw new Error(`Unexpected method ${method}`);
    }),
    subscribe: vi.fn(),
    reconnect: vi.fn(),
    close: vi.fn(),
  } as HostTransport;
}
