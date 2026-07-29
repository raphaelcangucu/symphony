import { describe, expect, it, vi } from "vitest";

import type { RpcClient } from "./rpc-client";
import { createHostTrackerClient } from "./host-tracker-client";

describe("createHostTrackerClient", () => {
  it("uses the paired host E2EE client for project, task and session requests", async () => {
    const sendRequest = vi.fn(async (method: string, params?: { method?: string }) => {
      if (method === "projects.request") {
        return success({ data: [{ id: "project_1", slug: "symphony", name: "Symphony" }] });
      }
      if (method === "tasks.request") {
        if (params?.method === "POST") {
          return success({
            data: {
              id: "issue_2",
              identifier: "SYM-2",
              display_identifier: "SYM-2",
              project_slug: "symphony",
              title: "Criar pelo app",
              description: null,
              status: { name: "Todo" },
              priority: null,
              position: 0,
              labels: [],
              assignee: null,
              creator: null,
              agent: null,
              agent_goal: null,
              branch_name: null,
              created_at: "2026-07-28T00:00:00Z",
              updated_at: "2026-07-28T00:00:00Z",
            },
          });
        }
        return success({ data: [] });
      }
      if (method === "sessions.request") {
        return success({
          data: {
            id: 42,
            scope: "project_session",
            status: "idle",
            updated_at: "2026-07-28T00:00:00Z",
          },
        });
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const rpc = {
      sendRequest,
      subscribe: vi.fn(() => vi.fn()),
      notifyForeground: vi.fn(),
      close: vi.fn(),
    } as unknown as RpcClient;
    const client = createHostTrackerClient("paired-profile-1", rpc);

    await expect(client.projects()).resolves.toEqual([
      { id: "project_1", slug: "symphony", name: "Symphony" },
    ]);
    await client.issues("symphony");
    await client.createIssue("symphony", { title: "Criar pelo app", status: "Todo" });
    await client.createThread({
      requestKey: "single-cell-1",
      scope: "project_session",
      projectSlug: "symphony",
      agentKind: "codex",
    });

    expect(sendRequest).toHaveBeenNthCalledWith(
      1,
      "projects.request",
      expect.objectContaining({ path: "/projects", method: "GET" }),
    );
    expect(sendRequest).toHaveBeenNthCalledWith(
      2,
      "tasks.request",
      expect.objectContaining({ path: "/projects/symphony/issues", method: "GET" }),
    );
    expect(sendRequest).toHaveBeenNthCalledWith(
      3,
      "tasks.request",
      expect.objectContaining({ path: "/projects/symphony/issues", method: "POST" }),
    );
    expect(sendRequest).toHaveBeenNthCalledWith(
      4,
      "sessions.request",
      expect.objectContaining({
        path: "/assistant/threads",
        method: "POST",
        idempotency_key: "single-cell-1",
      }),
    );
  });
});

function success(result: unknown) {
  return { id: "request-1", ok: true as const, result, _meta: { runtimeId: "paired-profile-1" } };
}
