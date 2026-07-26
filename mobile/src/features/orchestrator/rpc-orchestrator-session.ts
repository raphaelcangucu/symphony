import type { SessionTimelineState } from "@/features/sessions/session-reducer";
import type { HostTransport } from "@/transport/HostTransport";

import {
  payloadSessionLogEntries,
  type SessionLogEntry,
} from "./orchestrator-session-adapter";

export type RpcOrchestratorSession = {
  connect(): void;
  disconnect(): void;
  steer(message: string): Promise<void>;
};

export function createRpcOrchestratorSession({
  executionSessionId,
  transport,
  onSnapshot,
  onEntries,
  onConnection,
  onError,
}: {
  executionSessionId: number;
  transport: HostTransport;
  onSnapshot(entries: SessionLogEntry[]): void;
  onEntries(entries: SessionLogEntry[]): void;
  onConnection(state: SessionTimelineState["connectionState"]): void;
  onError(message: string | null): void;
}): RpcOrchestratorSession {
  let active = false;
  let connected = false;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;

  function connect(): void {
    if (active) return;
    active = true;
    connected = false;
    const currentGeneration = ++generation;
    onConnection("connecting");
    onError(null);

    void transport
      .subscribe<Record<string, unknown>>(
        "orchestrator.session.subscribe",
        { execution_session_id: executionSessionId },
        (payload, eventName) => {
          if (!active || currentGeneration !== generation || !eventName) return;
          if (eventName === "orchestrator.session.joined") {
            onSnapshot(payloadSessionLogEntries(payload));
          } else if (eventName === "orchestrator.session.entries") {
            onEntries(payloadSessionLogEntries(payload));
          } else if (eventName === "orchestrator.session.steer_ok") {
            onError(null);
          } else if (eventName === "orchestrator.session.steer_failed") {
            onError(payloadReason(payload, "Unable to steer this execution"));
          } else if (eventName === "orchestrator.session.resync_required") {
            onError("Execution transcript needs to reconnect");
          }
        },
      )
      .then((cleanup) => {
        if (!active || currentGeneration !== generation) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
        connected = true;
        onConnection("live");
      })
      .catch((error: unknown) => {
        if (!active || currentGeneration !== generation) return;
        connected = false;
        onConnection("offline");
        onError(errorMessage(error));
      });
  }

  function disconnect(): void {
    if (!active) return;
    active = false;
    connected = false;
    generation += 1;
    unsubscribe?.();
    unsubscribe = null;
    onConnection("offline");
  }

  async function steer(message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized) throw new Error("Message is required");
    if (!connected && active) throw new Error("Execution session is not connected");
    await transport.call("orchestrator.session.command", {
      execution_session_id: executionSessionId,
      event: "steer",
      payload: { message: normalized, attachments: [], context_refs: [] },
    });
  }

  return { connect, disconnect, steer };
}

function payloadReason(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.reason === "string" ? payload.reason : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to follow this execution";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
