import { Socket } from "phoenix";

import { diagnosticLog, type DiagnosticLog } from "@/diagnostics/diagnostic-log";

export type TerminalConnectionState = "connecting" | "live" | "offline";

export type TerminalPushLike = {
  receive(status: string, callback: (payload: unknown) => void): TerminalPushLike;
};

export type TerminalChannelLike = {
  on(event: string, callback: (payload: unknown) => void): unknown;
  join(): TerminalPushLike;
  leave(): unknown;
  push(event: string, payload: Record<string, unknown>): TerminalPushLike;
};

export type TerminalSocketLike = {
  connect(): void;
  disconnect(): void;
  channel(topic: string, params: Record<string, unknown>): TerminalChannelLike;
  onClose?(callback: () => void): unknown;
  onError?(callback: () => void): unknown;
};

type CreateTerminalSessionOptions = {
  threadId: number;
  projectSlug: string;
  origin: string;
  token: string;
  locale?: string;
  cols?: number;
  rows?: number;
  socketFactory?: (endpoint: string, params: Record<string, string>) => TerminalSocketLike;
  diagnostics?: DiagnosticLog;
  onOutput(output: string): void;
  onState(state: TerminalConnectionState): void;
  onError(message: string): void;
};

export type TerminalSession = {
  connect(): void;
  disconnect(): void;
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
};

export function terminalThreadTopic(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return `terminal:thread:${threadId}`;
}

export function createTerminalSession({
  threadId,
  projectSlug,
  origin,
  token,
  locale = "en",
  cols = 80,
  rows = 24,
  socketFactory = createSocket,
  diagnostics = diagnosticLog,
  onOutput,
  onState,
  onError,
}: CreateTerminalSessionOptions): TerminalSession {
  const topic = terminalThreadTopic(threadId);
  const project = projectSlug.trim();
  if (!project) throw new Error("projectSlug is required");
  let socket: TerminalSocketLike | null = null;
  let channel: TerminalChannelLike | null = null;
  let started = false;
  let joined = false;
  let lastOutput = "";
  let dimensions = validDimensions(cols, rows);
  const recordSocket = (event: string, details: Record<string, unknown> = {}) =>
    diagnostics.record(
      {
        scope: "socket",
        event: `terminal socket ${event}`,
        details: { topic, projectSlug: project, ...details },
      },
      [token],
    );

  function renderSnapshot(output: string) {
    if (output === lastOutput) return;
    lastOutput = output;
    onOutput(output);
  }

  function connect() {
    if (started) return;
    started = true;
    recordSocket("connecting");
    onState("connecting");
    const nextSocket = socketFactory(socketEndpoint(origin), { token, locale });
    const nextChannel = nextSocket.channel(topic, { project_slug: project });
    socket = nextSocket;
    channel = nextChannel;
    nextSocket.onClose?.(() => {
      recordSocket("closed");
      joined = false;
      if (started) onState("offline");
    });
    nextSocket.onError?.(() => {
      recordSocket("error");
      joined = false;
      if (started) onState("offline");
    });
    nextChannel.on("output", (payload) => {
      const output = field(payload, "data");
      if (typeof output === "string") renderSnapshot(output);
    });
    nextChannel.on("error", (payload) => {
      recordSocket("channel error", { payload });
      joined = false;
      onState("offline");
      onError(textField(payload, "message") ?? "Terminal session failed");
    });
    nextChannel
      .join()
      .receive("ok", (payload) => {
        joined = true;
        recordSocket("live");
        onState("live");
        const session = field(payload, "session");
        const output = field(session, "output");
        if (typeof output === "string") renderSnapshot(output);
        nextChannel.push("resize", { cols: dimensions.cols, rows: dimensions.rows });
      })
      .receive("error", (payload) => {
        recordSocket("join failed", { payload });
        joined = false;
        onState("offline");
        onError(textField(payload, "reason") ?? "Could not join terminal");
      })
      .receive("timeout", () => {
        recordSocket("join timeout");
        joined = false;
        onState("offline");
        onError("Terminal connection timed out");
      });
    nextSocket.connect();
  }

  function disconnect() {
    if (!started) return;
    started = false;
    joined = false;
    channel?.leave();
    socket?.disconnect();
    recordSocket("disconnected");
    channel = null;
    socket = null;
  }

  function sendInput(data: string) {
    if (!joined || !channel || !data) return;
    channel.push("input", { data });
  }

  function resize(nextCols: number, nextRows: number) {
    dimensions = validDimensions(nextCols, nextRows);
    if (joined && channel) {
      channel.push("resize", { cols: dimensions.cols, rows: dimensions.rows });
    }
  }

  return { connect, disconnect, resize, sendInput };
}

function validDimensions(cols: number, rows: number) {
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new Error("Terminal dimensions must be positive integers");
  }
  return { cols, rows };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function textField(value: unknown, key: string): string | null {
  const result = field(value, key);
  return typeof result === "string" && result.trim() ? result : null;
}

function socketEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/socket`;
}

function createSocket(endpoint: string, params: Record<string, string>): TerminalSocketLike {
  return new Socket(endpoint, { params }) as unknown as TerminalSocketLike;
}
