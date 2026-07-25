import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { createRpcAssistantSession } from "./rpc-assistant-session";

describe("RPC assistant session", () => {
  it("streams history and commands through the selected encrypted host", async () => {
    const transport = fakeTransport();
    const onAction = vi.fn();
    const session = createRpcAssistantSession({
      threadId: 42,
      transport,
      onAction,
    });

    session.connect();
    await vi.waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({ type: "connection_changed", state: "live" }),
    );

    const handler = vi.mocked(transport.subscribe).mock.calls[0]?.[2];
    handler?.(
      {
        messages: [{ id: 1, role: "assistant", content: "Ready", tool_calls: [] }],
      },
      "sessions.history_loaded",
    );
    expect(onAction).toHaveBeenCalledWith({
      type: "history_loaded",
      messages: [expect.objectContaining({ id: "1", content: "Ready" })],
    });

    handler?.({ reason: "preactivation_overflow" }, "sessions.resync_required");
    await vi.waitFor(() =>
      expect(transport.call).toHaveBeenCalledWith("sessions.command", {
        thread_id: 42,
        event: "sync_history",
        payload: {},
      }),
    );

    await session.sendMessage("Continue");
    expect(transport.call).toHaveBeenCalledWith("sessions.command", {
      thread_id: 42,
      event: "send_message",
      payload: { message: "Continue" },
    });

    session.disconnect();
    await expect(vi.mocked(transport.subscribe).mock.results[0]?.value).resolves.toBeTypeOf(
      "function",
    );
  });

  it("submits approvals, questions and a first message without a tracker token", async () => {
    const transport = fakeTransport();
    const onSeedAccepted = vi.fn();
    const session = createRpcAssistantSession({
      threadId: 42,
      transport,
      seed: "Build it",
      onAction: vi.fn(),
      onSeedAccepted,
    });

    session.connect();
    await vi.waitFor(() => expect(onSeedAccepted).toHaveBeenCalledTimes(1));
    await session.submitApproval("approval-1", "approve");
    await session.submitUserInput("question-1", { target: "Production" });

    expect(transport.call).toHaveBeenCalledWith(
      "sessions.command",
      expect.objectContaining({
        event: "submit_approval",
        payload: { request_id: "approval-1", action: "approve" },
      }),
    );
    expect(transport.call).toHaveBeenCalledWith(
      "sessions.command",
      expect.objectContaining({
        event: "submit_user_input",
        payload: { request_id: "question-1", answers: { target: "Production" } },
      }),
    );
    expect(JSON.stringify(vi.mocked(transport.call).mock.calls)).not.toMatch(/token|Bearer/i);
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
