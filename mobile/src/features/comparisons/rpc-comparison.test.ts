import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcComparison } from "./rpc-comparison";

describe("comparison RPC lifecycle", () => {
  it("gets before subscribing, follows snapshots, and propagates start/retry keys", async () => {
    const transport = fakeTransport();
    vi.mocked(transport.call).mockImplementation(async (method) => {
      if (method === "comparisons.get") return snapshot("starting");
      if (method === "comparisons.start") return snapshot("live");
      if (method === "comparisons.retry_cell") return snapshot("retrying");
      if (method === "comparisons.save_decision") return snapshot("passed");
      return {};
    });
    const onSnapshot = vi.fn();
    const onConnection = vi.fn();
    const comparison = createRpcComparison({
      transport,
      projectSlug: "dev10x",
      identifier: "DEV-1",
      onSnapshot,
      onConnection,
      onError: vi.fn(),
    });

    comparison.connect();
    await vi.waitFor(() => expect(onConnection).toHaveBeenLastCalledWith("live"));

    expect(vi.mocked(transport.call).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(transport.subscribe).mock.invocationCallOrder[0]!,
    );
    expect(transport.call).toHaveBeenCalledWith("comparisons.get", {
      project_slug: "dev10x",
      identifier: "DEV-1",
    });
    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ cells: [expect.objectContaining({ status: "starting" })] }),
    );

    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.(snapshot("passed"), "comparisons.snapshot");
    handler?.(snapshot("failed"), "comparisons.ignored");
    expect(onSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ cells: [expect.objectContaining({ status: "passed" })] }),
    );

    await comparison.start("mobile-start-1");
    expect(transport.call).toHaveBeenCalledWith("comparisons.start", {
      project_slug: "dev10x",
      identifier: "DEV-1",
      request_key: "mobile-start-1",
    });

    await comparison.retryCell("session-codex", "mobile-retry-1");
    expect(transport.call).toHaveBeenCalledWith("comparisons.retry_cell", {
      project_slug: "dev10x",
      identifier: "DEV-1",
      request_key: "mobile-retry-1",
      cell_id: "session-codex",
    });

    const decision = {
      ranking: [
        { rank: 1, cell_id: "session-codex" as const, score: 99 },
        { rank: 2, cell_id: "session-cursor" as const, score: 98 },
        { rank: 3, cell_id: "session-claude" as const, score: 97 },
        { rank: 4, cell_id: "orchestrator-codex" as const, score: 96 },
        { rank: 5, cell_id: "orchestrator-cursor" as const, score: 95 },
        { rank: 6, cell_id: "orchestrator-claude" as const, score: 94 },
      ],
      summary: "Reviewed in the mobile app.",
    };
    await comparison.saveDecision(decision);
    expect(transport.call).toHaveBeenCalledWith("comparisons.save_decision", {
      project_slug: "dev10x",
      identifier: "DEV-1",
      ...decision,
    });
  });

  it("cleans up and ignores late events from an older generation", async () => {
    const transport = fakeTransport();
    let resolveSubscribe!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    vi.mocked(transport.call).mockResolvedValue(snapshot("starting"));
    vi.mocked(transport.subscribe).mockReturnValue(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    const onSnapshot = vi.fn();
    const comparison = createRpcComparison({
      transport,
      projectSlug: "dev10x",
      identifier: "DEV-1",
      onSnapshot,
      onConnection: vi.fn(),
      onError: vi.fn(),
    });

    comparison.connect();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());
    const staleHandler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    comparison.disconnect();
    resolveSubscribe(cleanup);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());

    staleHandler?.(snapshot("passed"), "comparisons.snapshot");
    expect(onSnapshot).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ cells: [expect.objectContaining({ status: "passed" })] }),
    );
  });

  it("explicitly reconnects the selected host and starts a fresh generation", async () => {
    const transport = fakeTransport();
    vi.mocked(transport.call).mockResolvedValue(snapshot("starting"));
    const onConnection = vi.fn();
    const comparison = createRpcComparison({
      transport,
      projectSlug: "dev10x",
      identifier: "DEV-1",
      onSnapshot: vi.fn(),
      onConnection,
      onError: vi.fn(),
    });

    comparison.connect();
    await vi.waitFor(() => expect(onConnection).toHaveBeenLastCalledWith("live"));
    comparison.reconnect();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledTimes(2));

    expect(transport.reconnect).toHaveBeenCalledOnce();
    expect(transport.call).toHaveBeenCalledTimes(2);
  });
});

function snapshot(status: string) {
  return {
    project_slug: "dev10x",
    identifier: "DEV-1",
    cells: [
      {
        id: "session-codex",
        path: "session",
        provider: "codex",
        requested_model: "gpt-5.6-sol",
        requested_effort: "high",
        effective_effort: "high",
        status,
        issue_identifier: "DEV-2",
      },
    ],
  };
}

function fakeTransport(): HostTransport {
  return {
    hostId: "host-1",
    call: vi.fn(async () => ({})),
    subscribe: vi.fn(async () => vi.fn()),
    reconnect: vi.fn(),
    deactivate: vi.fn(),
    close: vi.fn(),
  };
}
