import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcOrchestratorExecutions } from "./rpc-orchestrator-executions";

describe("orchestrator execution RPC stream", () => {
  it("loads and follows execution snapshots on the selected host", async () => {
    const transport = fakeTransport();
    vi.mocked(transport.call).mockResolvedValue({
      executions: [
        {
          issue_identifier: "DEV-10",
          execution_session_id: 77,
          status: "live",
          agent_kind: "codex",
        },
      ],
    });
    const onSnapshot = vi.fn();
    const onConnection = vi.fn();
    const stream = createRpcOrchestratorExecutions({
      transport,
      onSnapshot,
      onConnection,
      onError: vi.fn(),
    });

    stream.connect();
    await vi.waitFor(() =>
      expect(onSnapshot).toHaveBeenCalledWith([
        expect.objectContaining({
          issueIdentifier: "DEV-10",
          executionSessionId: 77,
        }),
      ]),
    );
    await vi.waitFor(() =>
      expect(onConnection).toHaveBeenLastCalledWith("live"),
    );

    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.(
      {
        data: [
          {
            issue_identifier: "DEV-11",
            execution_session_id: 78,
            status: "paused",
            agent_kind: "claude",
          },
        ],
      },
      "orchestrator.executions.snapshot",
    );
    expect(onSnapshot).toHaveBeenLastCalledWith([
      expect.objectContaining({
        issueIdentifier: "DEV-11",
        executionSessionId: 78,
      }),
    ]);

    stream.disconnect();
  });

  it("waits for the encrypted subscription before requesting the initial snapshot", async () => {
    let bind!: (cleanup: () => void) => void;
    const transport = fakeTransport();
    vi.mocked(transport.subscribe).mockImplementation(
      () =>
        new Promise<(cleanup: () => void) => void>(
          (resolve) => (bind = resolve),
        ),
    );
    const stream = createRpcOrchestratorExecutions({
      transport,
      onSnapshot: vi.fn(),
      onConnection: vi.fn(),
      onError: vi.fn(),
    });

    stream.connect();
    expect(transport.call).not.toHaveBeenCalled();

    bind(vi.fn());
    await vi.waitFor(() =>
      expect(transport.call).toHaveBeenCalledWith(
        "orchestrator.executions.list",
        {},
      ),
    );
    stream.disconnect();
  });
});

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
