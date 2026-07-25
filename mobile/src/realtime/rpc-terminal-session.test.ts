import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcTerminalSession } from "./rpc-terminal-session";

describe("RPC terminal session", () => {
  it("streams snapshots and sends input/resize to the selected host", async () => {
    const transport = fakeTransport();
    const onOutput = vi.fn();
    const onState = vi.fn();
    const session = createRpcTerminalSession({
      threadId: 42,
      projectSlug: "symphony",
      transport,
      onOutput,
      onState,
      onError: vi.fn(),
    });

    session.connect();
    await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledTimes(1));
    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.({ session: { output: "$ pwd\n/work/symphony" } }, "terminal.joined");
    await vi.waitFor(() => expect(transport.call).toHaveBeenCalledTimes(1));
    expect(transport.call).toHaveBeenNthCalledWith(1, "terminal.command", {
      thread_id: 42,
      event: "resize",
      payload: { cols: 80, rows: 24 },
    });
    handler?.({ data: "$ git status\nclean" }, "terminal.output");

    expect(onState).toHaveBeenCalledWith("live");
    expect(onOutput).toHaveBeenLastCalledWith("$ git status\nclean");

    session.sendInput("ls\n");
    session.resize(120, 40);
    await vi.waitFor(() => expect(transport.call).toHaveBeenCalledTimes(3));
    expect(transport.call).toHaveBeenNthCalledWith(2, "terminal.command", {
      thread_id: 42,
      event: "input",
      payload: { data: "ls\n" },
    });
    expect(transport.call).toHaveBeenNthCalledWith(3, "terminal.command", {
      thread_id: 42,
      event: "resize",
      payload: { cols: 120, rows: 40 },
    });
  });
});

function fakeTransport(): HostTransport {
  return {
    hostId: "host-1",
    call: vi.fn(async () => ({ accepted: true })),
    subscribe: vi.fn(async () => vi.fn()),
    reconnect: vi.fn(),
    close: vi.fn(),
  };
}
