import { describe, expect, it, vi } from "vitest";

import {
  assistantThreadTopic,
  createAssistantSession,
  type AssistantChannelLike,
  type AssistantPushLike,
  type AssistantSocketLike,
} from "./assistant-session";

class FakePush implements AssistantPushLike {
  receivers = new Map<string, (payload: unknown) => void>();

  receive(status: string, callback: (payload: unknown) => void) {
    this.receivers.set(status, callback);
    return this;
  }

  trigger(status: string, payload: unknown = {}) {
    this.receivers.get(status)?.(payload);
  }
}

class FakeChannel implements AssistantChannelLike {
  handlers = new Map<string, (payload: unknown) => void>();
  joinPush = new FakePush();
  pushes: { event: string; payload: Record<string, unknown>; push: FakePush }[] = [];
  leave = vi.fn();

  on(event: string, callback: (payload: unknown) => void) {
    this.handlers.set(event, callback);
    return 1;
  }

  join() {
    return this.joinPush;
  }

  push(event: string, payload: Record<string, unknown>) {
    const push = new FakePush();
    this.pushes.push({ event, payload, push });
    return push;
  }

  trigger(event: string, payload: unknown) {
    this.handlers.get(event)?.(payload);
  }
}

class FakeSocket implements AssistantSocketLike {
  channelInstance = new FakeChannel();
  connect = vi.fn();
  disconnect = vi.fn();
  channel = vi.fn(() => this.channelInstance);
  openCallbacks: (() => void)[] = [];

  onOpen(callback: () => void) {
    this.openCallbacks.push(callback);
    return 1;
  }

  triggerOpen() {
    this.openCallbacks.forEach((callback) => callback());
  }
}

describe("assistant session adapter", () => {
  it("requires a positive thread id for its exact topic", () => {
    expect(assistantThreadTopic(42)).toBe("assistant:thread:42");
    expect(() => assistantThreadTopic(0)).toThrow("positive");
  });

  it("connects, binds the snake_case contract, syncs after reconnect, and cleans up once", () => {
    const socket = new FakeSocket();
    const onAction = vi.fn();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      socketFactory: () => socket,
      onAction,
    });

    session.connect();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.channel).toHaveBeenCalledWith("assistant:thread:42", {});
    expect([...socket.channelInstance.handlers.keys()]).toEqual(
      expect.arrayContaining([
        "history_loaded",
        "history_synced",
        "message_created",
        "assistant_delta",
        "tool_call_started",
        "tool_call_completed",
        "assistant_completed",
        "assistant_error",
      ]),
    );
    socket.channelInstance.joinPush.trigger("ok");
    socket.triggerOpen();
    expect(socket.channelInstance.pushes).toContainEqual(
      expect.objectContaining({ event: "sync_history", payload: {} }),
    );
    socket.channelInstance.trigger("assistant_delta", { delta: "Olá" });
    expect(onAction).toHaveBeenCalledWith({ type: "assistant_delta", delta: "Olá" });

    session.disconnect();
    session.disconnect();
    expect(socket.channelInstance.leave).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sends a seed at most once after a successful join", async () => {
    const socket = new FakeSocket();
    const onSeedAccepted = vi.fn();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      seed: "Build it",
      socketFactory: () => socket,
      onAction: vi.fn(),
      onSeedAccepted,
    });

    session.connect();
    expect(socket.channelInstance.pushes).toHaveLength(0);
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.joinPush.trigger("ok");

    const sends = socket.channelInstance.pushes.filter((item) => item.event === "send_message");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.payload).toEqual({ message: "Build it" });
    sends[0]?.push.trigger("ok");
    await Promise.resolve();
    expect(onSeedAccepted).toHaveBeenCalledTimes(1);
  });

  it("sends composer messages with the channel payload contract", async () => {
    const socket = new FakeSocket();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      socketFactory: () => socket,
      onAction: vi.fn(),
    });
    session.connect();
    socket.channelInstance.joinPush.trigger("ok");

    const sent = session.sendMessage("Continue");
    const push = socket.channelInstance.pushes.at(-1);
    expect(push).toMatchObject({
      event: "send_message",
      payload: { message: "Continue" },
    });
    push?.push.trigger("ok");
    await expect(sent).resolves.toBeUndefined();
  });
});
