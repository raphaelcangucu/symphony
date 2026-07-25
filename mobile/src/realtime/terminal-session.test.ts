import { describe, expect, it, vi } from "vitest";

import type { TerminalChannelLike, TerminalPushLike, TerminalSocketLike } from "./terminal-session";
import { createTerminalSession, terminalThreadTopic } from "./terminal-session";

class FakePush implements TerminalPushLike {
  receivers = new Map<string, (payload: unknown) => void>();

  receive(status: string, callback: (payload: unknown) => void) {
    this.receivers.set(status, callback);
    return this;
  }

  trigger(status: string, payload: unknown = {}) {
    this.receivers.get(status)?.(payload);
  }
}

class FakeChannel implements TerminalChannelLike {
  handlers = new Map<string, (payload: unknown) => void>();
  joinPush = new FakePush();
  pushes: Array<{ event: string; payload: Record<string, unknown> }> = [];
  leave = vi.fn();

  on(event: string, callback: (payload: unknown) => void) {
    this.handlers.set(event, callback);
    return 1;
  }

  join() {
    return this.joinPush;
  }

  push(event: string, payload: Record<string, unknown>) {
    this.pushes.push({ event, payload });
    return new FakePush();
  }

  trigger(event: string, payload: unknown) {
    this.handlers.get(event)?.(payload);
  }
}

class FakeSocket implements TerminalSocketLike {
  channelInstance = new FakeChannel();
  connect = vi.fn();
  disconnect = vi.fn();
  channel = vi.fn(() => this.channelInstance);
}

describe("terminal session adapter", () => {
  it("joins a thread workspace and streams deduplicated snapshots", () => {
    const socket = new FakeSocket();
    const onOutput = vi.fn();
    const onState = vi.fn();
    const session = createTerminalSession({
      threadId: 42,
      projectSlug: "symphony",
      origin: "https://demo.test",
      token: "secret",
      socketFactory: () => socket,
      onOutput,
      onState,
      onError: vi.fn(),
    });

    session.connect();
    expect(socket.channel).toHaveBeenCalledWith("terminal:thread:42", {
      project_slug: "symphony",
    });
    socket.channelInstance.joinPush.trigger("ok", {
      session: { output: "$ npm test\n" },
    });
    expect(onState).toHaveBeenLastCalledWith("live");
    expect(onOutput).toHaveBeenCalledWith("$ npm test\n");

    socket.channelInstance.trigger("output", { data: "$ npm test\n" });
    socket.channelInstance.trigger("output", { data: "$ npm test\n12 passed\n" });
    expect(onOutput).toHaveBeenCalledTimes(2);
    expect(onOutput).toHaveBeenLastCalledWith("$ npm test\n12 passed\n");
  });

  it("sends input and resize and cleans up once", () => {
    const socket = new FakeSocket();
    const session = createTerminalSession({
      threadId: 42,
      projectSlug: "symphony",
      origin: "https://demo.test",
      token: "secret",
      socketFactory: () => socket,
      onOutput: vi.fn(),
      onState: vi.fn(),
      onError: vi.fn(),
    });
    session.connect();
    socket.channelInstance.joinPush.trigger("ok", { session: { output: "" } });
    session.sendInput("ls\n");
    session.resize(80, 24);
    expect(socket.channelInstance.pushes).toEqual([
      { event: "resize", payload: { cols: 80, rows: 24 } },
      { event: "input", payload: { data: "ls\n" } },
      { event: "resize", payload: { cols: 80, rows: 24 } },
    ]);

    session.disconnect();
    session.disconnect();
    expect(socket.channelInstance.leave).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("validates thread and project context", () => {
    expect(terminalThreadTopic(42)).toBe("terminal:thread:42");
    expect(() => terminalThreadTopic(0)).toThrow("positive");
    expect(() =>
      createTerminalSession({
        threadId: 42,
        projectSlug: " ",
        origin: "https://demo.test",
        token: "secret",
        onOutput: vi.fn(),
        onState: vi.fn(),
        onError: vi.fn(),
      }),
    ).toThrow("projectSlug");
  });
});
