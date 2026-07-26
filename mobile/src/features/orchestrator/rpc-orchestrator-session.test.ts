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
    handler?.({ entries: [{ kind: "assistant", title: "Codex", body: "Restored" }] }, "orchestrator.session.joined");
    handler?.({ entries: [{ kind: "assistant", title: "Codex", body: "Streaming" }] }, "orchestrator.session.entries");

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
