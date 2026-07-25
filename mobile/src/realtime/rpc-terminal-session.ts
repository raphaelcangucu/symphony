import type { HostTransport } from "@/transport/HostTransport";

import type { TerminalConnectionState, TerminalSession } from "./terminal-session";

type CreateRpcTerminalSessionOptions = {
  threadId: number;
  projectSlug: string;
  transport: HostTransport;
  cols?: number;
  rows?: number;
  onOutput(output: string): void;
  onState(state: TerminalConnectionState): void;
  onError(message: string): void;
};

export function createRpcTerminalSession({
  threadId,
  projectSlug,
  transport,
  cols = 80,
  rows = 24,
  onOutput,
  onState,
  onError,
}: CreateRpcTerminalSessionOptions): TerminalSession {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  const project = projectSlug.trim();
  if (!project) throw new Error("projectSlug is required");

  let started = false;
  let live = false;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;
  let dimensions = validDimensions(cols, rows);
  let lastOutput = "";

  function connect(): void {
    if (started) return;
    started = true;
    live = false;
    const currentGeneration = ++generation;
    onState("connecting");

    void transport
      .subscribe<Record<string, unknown>>(
        "terminal.events",
        { thread_id: threadId, project_slug: project },
        (payload, eventName) => {
          if (!started || generation !== currentGeneration) return;
          if (eventName === "terminal.joined") {
            live = true;
            onState("live");
            renderOutput(field(field(payload, "session"), "output"));
            void sendCommand("resize", dimensions).catch(handleError);
            return;
          }
          if (eventName === "terminal.output") {
            renderOutput(field(payload, "data"));
            return;
          }
          if (eventName === "terminal.error") {
            live = false;
            onState("offline");
            onError(textField(payload, "message") ?? "Terminal session failed");
          }
        },
      )
      .then((cleanup) => {
        if (!started || generation !== currentGeneration) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
      })
      .catch(handleError);
  }

  function disconnect(): void {
    if (!started) return;
    started = false;
    live = false;
    generation += 1;
    unsubscribe?.();
    unsubscribe = null;
    onState("offline");
  }

  function sendInput(data: string): void {
    if (!live || !data) return;
    void sendCommand("input", { data }).catch(handleError);
  }

  function resize(nextCols: number, nextRows: number): void {
    dimensions = validDimensions(nextCols, nextRows);
    if (live) void sendCommand("resize", dimensions).catch(handleError);
  }

  function sendCommand(event: "input" | "resize", payload: Record<string, unknown>) {
    return transport.call("terminal.command", {
      thread_id: threadId,
      event,
      payload,
    });
  }

  function renderOutput(value: unknown): void {
    if (typeof value !== "string" || value === lastOutput) return;
    lastOutput = value;
    onOutput(value);
  }

  function handleError(error: unknown): void {
    if (!started) return;
    live = false;
    onState("offline");
    onError(error instanceof Error ? error.message : "Terminal session failed");
  }

  return { connect, disconnect, resize, sendInput };
}

function validDimensions(cols: number, rows: number): { cols: number; rows: number } {
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
