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

  it("hydrates copied Orca task surfaces without fabricating external providers", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    for (const [id, method] of [
      ["status", "status.get"],
      ["settings", "settings.get"],
      ["ui", "ui.get"],
      ["preflight", "preflight.check"],
    ] as const) {
      handleRequest({ type: "rpc", id, method, params: {} }, send, socket);
    }

    expect(sent[0]).toMatchObject({
      ok: true,
      result: {
        product: "Symphony",
        protocolVersion: 3,
        minCompatibleMobileVersion: 2,
        capabilities: expect.arrayContaining([
          "mobile.tasks.v1",
          "symphony.tasks.list",
          "notifications.subscribe",
        ]),
      },
    });
    expect(sent[0]).not.toMatchObject({
      result: {
        capabilities: expect.arrayContaining([
          "github.listWorkItems",
          "linear.listIssues",
          "speech.dictation.start",
        ]),
      },
    });
    expect(sent[1]).toMatchObject({
      result: {
        settings: {
          defaultTaskSource: "dev10x",
          visibleTaskProviders: ["dev10x"],
        },
      },
    });
    expect(sent[2]).toMatchObject({ result: { ui: {} } });
    expect(sent[3]).toMatchObject({
      result: {
        git: { installed: true },
        gh: { installed: false },
        glab: { installed: false },
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

  it("supports development-only orchestrator lists, transcripts and steer", async () => {
    vi.useFakeTimers();
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "runs",
        method: "orchestrator.executions.list",
        params: {},
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "run-subscribe",
        method: "orchestrator.session.subscribe",
        params: { execution_session_id: 101 },
      },
      send,
      socket,
    );
    await vi.runOnlyPendingTimersAsync();

    expect(sent[0]).toMatchObject({
      id: "runs",
      result: {
        executions: [
          {
            issue_identifier: "SYM-101",
            execution_session_id: 101,
            agent_kind: "codex",
          },
        ],
      },
    });
    expect(sent[2]).toMatchObject({
      type: "event",
      event: "orchestrator.session.joined",
      payload: {
        entries: expect.arrayContaining([
          expect.objectContaining({ kind: "assistant", body: expect.stringContaining("Dev10x") }),
        ]),
      },
    });

    handleRequest(
      {
        type: "rpc",
        id: "steer",
        method: "orchestrator.session.command",
        params: {
          execution_session_id: 101,
          event: "steer",
          payload: { message: "Focus on the RPC" },
        },
      },
      send,
      socket,
    );
    await vi.runOnlyPendingTimersAsync();
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "event",
        event: "orchestrator.session.entries",
        payload: {
          entries: expect.arrayContaining([
            expect.objectContaining({ kind: "user", body: "Focus on the RPC" }),
          ]),
        },
      }),
    );
  });

  it("serves generic task-scoped evidence without a comparison aggregate", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "evidence",
        method: "evidence.list",
        params: { project_slug: "symphony", identifier: "SYM-101" },
      },
      send,
      socket,
    );

    expect(sent[0]).toMatchObject({
      ok: true,
      result: {
        records: [
          {
            run_id: "mock-run-1",
            provenance: {
              execution_path: "session",
              thread_id: 101,
            },
          },
        ],
      },
    });
    expect(JSON.stringify(sent[0])).not.toContain("parent_identifier");
  });

  it("serves the copied Dev10x session and terminal DTOs", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "tabs",
        method: "session.tabs.list",
        params: { worktree: "id:101" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "terminals",
        method: "terminal.list",
        params: { worktree: "id:101" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "markdown",
        method: "markdown.readTab",
        params: { worktree: "id:101", tabId: "docs/mock-evidence.md" },
      },
      send,
      socket,
    );

    expect(sent[0]).toMatchObject({
      ok: true,
      result: {
        worktree: "101",
        snapshotVersion: 1,
        activeTabType: "terminal",
        tabs: [
          {
            type: "terminal",
            id: "thread:101",
            terminal: "thread:101",
            launchAgent: "codex",
            isActive: true,
          },
        ],
      },
    });
    expect(sent[1]).toMatchObject({
      ok: true,
      result: {
        terminals: [{ handle: "thread:101", isActive: true }],
        totalCount: 1,
        truncated: false,
      },
    });
    expect(sent[2]).toMatchObject({
      ok: true,
      result: {
        tabId: "docs/mock-evidence.md",
        content: expect.stringContaining("Dev10x"),
        editable: false,
      },
    });
  });

  it("streams copied session snapshots and terminal scrollback after binding", async () => {
    vi.useFakeTimers();
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "tabs-subscribe",
        method: "session.tabs.subscribe",
        params: { worktree: "id:101" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "terminal-subscribe",
        method: "terminal.subscribe",
        params: {
          terminal: "thread:101",
          client: { id: "device_mock", type: "mobile" },
          viewport: { cols: 48, rows: 18 },
          capabilities: { terminalBinaryStream: 1 },
        },
      },
      send,
      socket,
    );

    await vi.runOnlyPendingTimersAsync();

    expect(sent[0]).toMatchObject({
      id: "tabs-subscribe",
      ok: true,
      result: { subscription_id: expect.any(String) },
    });
    expect(sent[1]).toMatchObject({
      id: "terminal-subscribe",
      ok: true,
      result: { subscription_id: expect.any(String) },
    });
    expect(sent[2]).toMatchObject({
      type: "event",
      sequence: 1,
      event: "session.tabs.snapshot",
      payload: { type: "snapshot", worktree: "101", snapshotVersion: 1 },
    });
    expect(sent[3]).toMatchObject({
      type: "event",
      sequence: 1,
      event: "terminal.scrollback",
      payload: {
        type: "scrollback",
        serialized: expect.stringContaining("Dev10x mock host"),
        cols: 48,
        rows: 18,
      },
    });
  });

  it("serves copied file previews and chunked clipboard uploads", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "directory",
        method: "files.readDir",
        params: { worktree: "id:101", relativePath: "" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "read",
        method: "files.read",
        params: { worktree: "id:101", relativePath: "README.md" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "preview",
        method: "files.readPreview",
        params: { worktree: "id:101", relativePath: "assets/logo.png" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "upload-start",
        method: "clipboard.startImageUpload",
        params: { expectedBase64Length: 8, connectionId: "mock-mobile" },
      },
      send,
      socket,
    );

    const uploadId = (sent[3] as { result: { uploadId: string } }).result.uploadId;
    handleRequest(
      {
        type: "rpc",
        id: "upload-chunk",
        method: "clipboard.appendImageUploadChunk",
        params: { uploadId, offset: 0, contentBase64: "ZGV2MTB4" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "upload-commit",
        method: "clipboard.commitImageUpload",
        params: { uploadId },
      },
      send,
      socket,
    );

    expect(sent[0]).toMatchObject({
      ok: true,
      result: [
        { name: "assets", isDirectory: true, isSymlink: false },
        { name: "dist", isDirectory: true, isSymlink: false },
        { name: "public", isDirectory: true, isSymlink: false },
        { name: "src", isDirectory: true, isSymlink: false },
        { name: "README.md", isDirectory: false, isSymlink: false },
      ],
    });
    expect(sent[1]).toMatchObject({
      ok: true,
      result: {
        relativePath: "README.md",
        content: expect.stringContaining("Dev10x"),
        truncated: false,
      },
    });
    expect(sent[2]).toMatchObject({
      ok: true,
      result: {
        isBinary: true,
        isImage: true,
        mimeType: "image/png",
      },
    });
    expect(sent[4]).toMatchObject({
      ok: true,
      result: { receivedBase64Length: 8 },
    });
    expect(sent[5]).toMatchObject({
      ok: true,
      result: expect.stringContaining("dev10x-mobile-clipboard"),
    });
  });

  it("serves Orca-compatible Git state and deterministic source-control mutations", () => {
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "git-status",
        method: "git.status",
        params: { worktree: "id:101" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "git-history",
        method: "git.history",
        params: { worktree: "id:101", limit: 20 },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "git-compare",
        method: "git.branchCompare",
        params: { worktree: "id:101", baseRef: "main" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "git-generate-pr",
        method: "git.generatePullRequestFields",
        params: {
          worktree: "id:101",
          base: "main",
          title: "",
          body: "",
          draft: false,
        },
      },
      send,
      socket,
    );

    expect(sent[0]).toMatchObject({
      id: "git-status",
      ok: true,
      result: {
        branch: "refs/heads/feature/dev10x-mobile",
        entries: [
          { path: "mobile/src/app.tsx", status: "modified", area: "unstaged" },
          {
            path: "mobile/assets/dev10x.png",
            status: "untracked",
            area: "untracked",
          },
          { path: "README.md", status: "modified", area: "staged" },
        ],
        upstreamStatus: { hasUpstream: true, ahead: 1, behind: 0 },
      },
    });
    expect(sent[1]).toMatchObject({
      id: "git-history",
      ok: true,
      result: {
        items: [
          {
            id: expect.any(String),
            displayId: expect.any(String),
            subject: expect.stringContaining("Dev10x"),
          },
        ],
      },
    });
    expect(sent[2]).toMatchObject({
      id: "git-compare",
      ok: true,
      result: {
        summary: {
          baseRef: "main",
          status: "ready",
          changedFiles: 3,
        },
      },
    });
    expect(sent[3]).toMatchObject({
      id: "git-generate-pr",
      ok: true,
      result: {
        success: true,
        fields: {
          base: "main",
          title: expect.stringContaining("Dev10x"),
          body: expect.stringContaining("Dev10x"),
          draft: false,
        },
      },
    });
  });

  it("serves native Dev10x tasks and host-routed notification events", async () => {
    vi.useFakeTimers();
    const sent: RpcResponse[] = [];
    const send = (message: RpcResponse) => sent.push(message);

    handleRequest(
      {
        type: "rpc",
        id: "dev10x-tasks",
        method: "symphony.tasks.list",
        params: { query: "mobile" },
      },
      send,
      socket,
    );
    handleRequest(
      {
        type: "rpc",
        id: "notifications",
        method: "notifications.subscribe",
        params: {},
      },
      send,
      socket,
    );

    await vi.runOnlyPendingTimersAsync();

    expect(sent[0]).toMatchObject({
      id: "dev10x-tasks",
      ok: true,
      result: {
        provider: "symphony",
        items: [
          {
            identifier: "DEV-101",
            projectName: "Dev10x Symphony",
            pendingApproval: true,
          },
        ],
      },
    });
    expect(sent[1]).toMatchObject({
      id: "notifications",
      ok: true,
      result: { subscription_id: expect.any(String) },
    });
    expect(sent.slice(2)).toMatchObject([
      {
        type: "event",
        sequence: 1,
        event: "notifications.ready",
      },
      {
        type: "event",
        sequence: 2,
        event: "notifications.notification",
        payload: { source: "dev10x-host", title: "Dev10x host" },
      },
    ]);
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
      { identifier: "SYM-101", title: "Exercise Dev10x and Symphony mobile" },
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
      {
        type: "rpc",
        id: "closing-health",
        method: "system.health",
        params: {},
      },
      (message) => sent.push(message),
      socket,
    );

    cleanupConnection(socket);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sent).toEqual([]);
    expect(cancelRequest(socket, "closing-health")).toBe(false);
  });
});
