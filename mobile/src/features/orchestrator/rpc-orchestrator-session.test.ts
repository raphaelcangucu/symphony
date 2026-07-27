import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcOrchestratorSession } from "./rpc-orchestrator-session";

describe("orchestrator RPC session", () => {
  it("restores history, follows live entries and steers the selected execution", async () => {
    const transport = fakeTransport();
    const onSnapshot = vi.fn();
    const onEntries = vi.fn();
    const onConnection = vi.fn();
    const session = createRpcOrchestratorSession({
      executionSessionId: 77,
      transport,
      onSnapshot,
      onEntries,
      onConnection,
      onError: vi.fn(),
    });

    session.connect();
    await vi.waitFor(() => expect(onConnection).toHaveBeenLastCalledWith("live"));

    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.(
      { entries: [{ kind: "assistant", title: "Codex", body: "Restored" }] },
      "orchestrator.session.joined",
    );
    handler?.(
      { entries: [{ kind: "assistant", title: "Codex", body: "Streaming" }] },
      "orchestrator.session.entries",
    );

    expect(onSnapshot).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ body: "Restored" })]),
    );
    expect(onEntries).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ body: "Streaming" })]),
    );

    await session.steer("Focus on the host RPC");
    expect(transport.call).toHaveBeenCalledWith("orchestrator.session.command", {
      execution_session_id: 77,
      event: "steer",
      payload: { message: "Focus on the host RPC", attachments: [], context_refs: [] },
    });
  });

  it("rejects empty steer messages before they reach the host", async () => {
    const session = createRpcOrchestratorSession({
      executionSessionId: 77,
      transport: fakeTransport(),
      onSnapshot: vi.fn(),
      onEntries: vi.fn(),
      onConnection: vi.fn(),
      onError: vi.fn(),
    });

    await expect(session.steer("   ")).rejects.toThrow("Message is required");
  });

  it("retries a transient subscription failure until the execution transcript is ready", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const onConnection = vi.fn();
    const onError = vi.fn();
    vi.mocked(transport.subscribe)
      .mockRejectedValueOnce(new Error("RPC method failed"))
      .mockResolvedValueOnce(vi.fn());
    const session = createRpcOrchestratorSession({
      executionSessionId: 77,
      transport,
      onSnapshot: vi.fn(),
      onEntries: vi.fn(),
      onConnection,
      onError,
    });

    session.connect();
    await vi.waitFor(() => expect(onConnection).toHaveBeenLastCalledWith("offline"));
    expect(onError).toHaveBeenLastCalledWith("RPC method failed");

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(onConnection).toHaveBeenLastCalledWith("live"));

    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(null);

    session.disconnect();
    vi.useRealTimers();
  });

  it("refreshes only the selected transcript when its stream stays silent after steer", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    vi.mocked(transport.subscribe)
      .mockResolvedValueOnce(firstCleanup)
      .mockResolvedValueOnce(secondCleanup);
    const session = createRpcOrchestratorSession({
      executionSessionId: 77,
      transport,
      onSnapshot: vi.fn(),
      onEntries: vi.fn(),
      onConnection: vi.fn(),
      onError: vi.fn(),
    });

    session.connect();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledTimes(1));
    await session.steer("Show the latest result");
    await vi.advanceTimersByTimeAsync(3_000);

    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    expect(transport.reconnect).not.toHaveBeenCalled();

    session.disconnect();
    vi.useRealTimers();
  });

  it("does not refresh a transcript that publishes entries after steer", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const session = createRpcOrchestratorSession({
      executionSessionId: 77,
      transport,
      onSnapshot: vi.fn(),
      onEntries: vi.fn(),
      onConnection: vi.fn(),
      onError: vi.fn(),
    });

    session.connect();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledTimes(1));
    await session.steer("Show the latest result");
    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.(
      { entries: [{ kind: "user", title: "You", body: "Show the latest result" }] },
      "orchestrator.session.entries",
    );
    await vi.advanceTimersByTimeAsync(3_000);

    expect(transport.subscribe).toHaveBeenCalledTimes(1);

    session.disconnect();
    vi.useRealTimers();
  });
});

function fakeTransport(): HostTransport {
  return {
    hostId: "host-1",
    call: vi.fn(async () => ({ accepted: true })),
    subscribe: vi.fn(async () => vi.fn()),
    reconnect: vi.fn(),
    deactivate: vi.fn(),
    close: vi.fn(),
  };
}
