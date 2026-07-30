import { describe, expect, it, vi } from "vitest";

import { createDiagnosticLog } from "@/diagnostics/diagnostic-log";

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
  closeCallbacks: (() => void)[] = [];
  errorCallbacks: (() => void)[] = [];

  onOpen(callback: () => void) {
    this.openCallbacks.push(callback);
    return 1;
  }

  onClose(callback: () => void) {
    this.closeCallbacks.push(callback);
    return 1;
  }

  onError(callback: () => void) {
    this.errorCallbacks.push(callback);
    return 1;
  }

  triggerOpen() {
    this.openCallbacks.forEach((callback) => callback());
  }

  triggerClose() {
    this.closeCallbacks.forEach((callback) => callback());
  }

  triggerError() {
    this.errorCallbacks.forEach((callback) => callback());
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
    const diagnostics = createDiagnosticLog();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      diagnostics,
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
    expect(diagnostics.list().map((entry) => entry.event)).toEqual(
      expect.arrayContaining(["assistant socket live", "assistant socket disconnected"]),
    );
    expect(JSON.stringify(diagnostics.list())).not.toContain("secret");
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
    expect(sends[0]?.payload).toEqual({
      message: "Build it",
      client_message_id: "mobile-seed-42",
    });
    sends[0]?.push.trigger("ok");
    await Promise.resolve();
    expect(onSeedAccepted).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected seed retryable until it is accepted", async () => {
    const socket = new FakeSocket();
    const onAction = vi.fn();
    const onSeedAccepted = vi.fn();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      seed: "Build it",
      socketFactory: () => socket,
      onAction,
      onSeedAccepted,
    });

    session.connect();
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.pushes[0]?.push.trigger("timeout");
    await Promise.resolve();
    await Promise.resolve();
    expect(onAction).toHaveBeenCalledWith({ type: "error", message: "Message send timed out" });

    const retry = session.retrySeed();
    socket.channelInstance.trigger("history_synced", { messages: [] });
    const sends = socket.channelInstance.pushes.filter((item) => item.event === "send_message");
    expect(sends).toHaveLength(2);
    sends[1]?.push.trigger("ok");
    await expect(retry).resolves.toBeUndefined();
    expect(onSeedAccepted).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguously accepted seed without sending it twice", async () => {
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
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.pushes[0]?.push.trigger("timeout");
    await Promise.resolve();
    await Promise.resolve();

    const retry = session.retrySeed();
    socket.channelInstance.trigger("history_synced", {
      messages: [{ id: 7, role: "user", content: "Build it" }],
    });
    await expect(retry).resolves.toBeUndefined();
    expect(
      socket.channelInstance.pushes.filter((item) => item.event === "send_message"),
    ).toHaveLength(1);
    expect(onSeedAccepted).toHaveBeenCalledTimes(1);
  });

  it("shares one reconciliation across concurrent seed retry taps", async () => {
    const socket = new FakeSocket();
    const session = createAssistantSession({
      threadId: 42,
      origin: "https://demo.test",
      token: "secret",
      seed: "Build it",
      socketFactory: () => socket,
      onAction: vi.fn(),
    });
    session.connect();
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.pushes[0]?.push.trigger("timeout");
    await Promise.resolve();
    await Promise.resolve();

    const first = session.retrySeed();
    const second = session.retrySeed();
    expect(first).toBe(second);
    socket.channelInstance.trigger("history_synced", {
      messages: [{ id: 7, role: "user", content: "Build it" }],
    });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(
      socket.channelInstance.pushes.filter((item) => item.event === "sync_history"),
    ).toHaveLength(1);
  });

  it("reports socket errors, closures, and reconnects", async () => {
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
    socket.channelInstance.joinPush.trigger("ok");
    socket.triggerError();
    socket.triggerClose();
    await expect(session.sendMessage("Offline mutation")).rejects.toThrow("not connected");
    socket.channelInstance.joinPush.trigger("ok");
    const afterRejoin = session.sendMessage("After rejoin");
    socket.channelInstance.pushes.at(-1)?.push.trigger("ok");
    await expect(afterRejoin).resolves.toBeUndefined();
    socket.triggerOpen();

    expect(onAction).toHaveBeenCalledWith({
      type: "connection_changed",
      state: "reconnecting",
    });
    expect(onAction).toHaveBeenCalledWith({ type: "connection_changed", state: "offline" });
    expect(socket.channelInstance.pushes).toContainEqual(
      expect.objectContaining({ event: "sync_history", payload: {} }),
    );
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

    const contextual = session.sendMessage("Review", [{ type: "file", id: "src/app.tsx" }]);
    const contextualPush = socket.channelInstance.pushes.at(-1);
    expect(contextualPush).toMatchObject({
      event: "send_message",
      payload: {
        message: "Review",
        context_refs: [{ type: "file", id: "src/app.tsx" }],
      },
    });
    contextualPush?.push.trigger("ok");
    await expect(contextual).resolves.toBeUndefined();
  });

  it("normalizes approvals, questions, and turn status and submits responses", async () => {
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
    socket.channelInstance.joinPush.trigger("ok");

    socket.channelInstance.trigger("approval_required", {
      request_id: "approval-1",
      command: "git push",
      cwd: "/work/symphony",
      reason: "Push the branch",
      tool_name: "exec",
      agent: "codex",
    });
    socket.channelInstance.trigger("user_input_required", {
      request_id: "question-1",
      questions: [
        {
          id: "target",
          header: "Target",
          question: "Where?",
          isOther: false,
          isSecret: false,
          options: [{ label: "Production", description: "Public app" }],
        },
      ],
    });
    socket.channelInstance.trigger("turn_status", {
      status: "interrupted",
      can_resume: true,
      queued_messages: [
        { id: "queue-1", message: "Run the focused tests next", provider: "codex" },
      ],
    });

    expect(onAction).toHaveBeenCalledWith({
      type: "approval_required",
      request: expect.objectContaining({ requestId: "approval-1", command: "git push" }),
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "user_input_required",
      request: expect.objectContaining({
        requestId: "question-1",
        questions: [expect.objectContaining({ id: "target" })],
      }),
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "turn_status",
      status: {
        status: "interrupted",
        canResume: true,
        queuedMessages: [
          { id: "queue-1", message: "Run the focused tests next", provider: "codex" },
        ],
      },
    });

    const approval = session.submitApproval("approval-1", "approve");
    const approvalPush = socket.channelInstance.pushes.at(-1);
    expect(approvalPush).toMatchObject({
      event: "submit_approval",
      payload: { request_id: "approval-1", action: "approve" },
    });
    approvalPush?.push.trigger("ok");
    await expect(approval).resolves.toBeUndefined();

    const answers = session.submitUserInput("question-1", { target: "Production" });
    const answersPush = socket.channelInstance.pushes.at(-1);
    expect(answersPush).toMatchObject({
      event: "submit_user_input",
      payload: { request_id: "question-1", answers: { target: "Production" } },
    });
    answersPush?.push.trigger("ok");
    await expect(answers).resolves.toBeUndefined();

    const stop = session.stopTurn();
    socket.channelInstance.pushes.at(-1)?.push.trigger("ok");
    await expect(stop).resolves.toBeUndefined();
    const resume = session.resumeTurn();
    socket.channelInstance.pushes.at(-1)?.push.trigger("ok");
    await expect(resume).resolves.toBeUndefined();
    expect(socket.channelInstance.pushes.slice(-2).map(({ event }) => event)).toEqual([
      "stop_turn",
      "resume_turn",
    ]);
  });

  it("normalizes joined metadata, preferences, and provider-neutral goal status", () => {
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
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.trigger("joined", {
      project_slug: "vinext-health",
      effective_agent: "claude",
      requested_model: "claude-opus-5",
      requested_effort: "high",
      execution_mode: "build",
      skill_profile: "implementation",
    });
    socket.channelInstance.trigger("goal_status", {
      enabled: true,
      available: true,
      status: "running",
      objective: "Ship /health",
      source: "claude",
      provider: "claude",
      capabilities: ["pause", "resume", "clear", "set_objective"],
      time_used_seconds: 18,
      running: true,
      resumable: false,
    });

    expect(onAction).toHaveBeenCalledWith({
      type: "session_metadata",
      metadata: expect.objectContaining({ projectSlug: "vinext-health", agentKind: "claude" }),
      preferences: expect.objectContaining({ executionMode: "build", model: "claude-opus-5" }),
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "goal_status",
      goal: expect.objectContaining({ objective: "Ship /health", source: "claude", running: true }),
    });
  });

  it("does not advertise Goal controls for an unsupported provider", () => {
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
    socket.channelInstance.joinPush.trigger("ok");
    socket.channelInstance.trigger("goal_status", {
      enabled: false,
      source: "unsupported",
      provider: "cursor",
      capabilities: [],
    });

    expect(onAction).toHaveBeenCalledWith({
      type: "goal_status",
      goal: expect.objectContaining({ available: false, provider: "cursor" }),
    });
  });
});
