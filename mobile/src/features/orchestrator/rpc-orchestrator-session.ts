import type { SessionTimelineState } from "@/features/sessions/session-reducer";
import type { HostTransport } from "@/transport/HostTransport";

import {
  payloadSessionLogEntries,
  type SessionLogEntry,
} from "./orchestrator-session-adapter";

const STEER_STREAM_REFRESH_MS = 2_500;
const SUBSCRIBE_RETRY_MS = 1_000;
const MAX_SUBSCRIBE_RETRY_MS = 10_000;

export type RpcOrchestratorSession = {
  connect(): void;
  disconnect(): void;
  steer(
    message: string,
    contextRefs?: Array<{ type: "issue" | "file" | "pr"; id: string }>,
  ): Promise<void>;
};

export function createRpcOrchestratorSession({
  executionSessionId,
  transport,
  onSnapshot,
  onEntries,
  onContext,
  onConnection,
  onError,
}: {
  executionSessionId: number;
  transport: HostTransport;
  onSnapshot(entries: SessionLogEntry[]): void;
  onEntries(entries: SessionLogEntry[]): void;
  onContext?(payload: unknown): void;
  onConnection(state: SessionTimelineState["connectionState"]): void;
  onError(message: string | null): void;
}): RpcOrchestratorSession {
  let active = false;
  let connected = false;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;
  let transcriptRevision = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;

  function connect(): void {
    if (active) return;
    active = true;
    onConnection("connecting");
    onError(null);
    subscribe();
  }

  function subscribe(): void {
    connected = false;
    const currentGeneration = ++generation;

    void transport
      .subscribe<Record<string, unknown>>(
        "orchestrator.session.subscribe",
        { execution_session_id: executionSessionId },
        (payload, eventName) => {
          if (!active || currentGeneration !== generation || !eventName) return;
          if (eventName === "orchestrator.session.joined") {
            noteTranscriptUpdate();
            if (isRecord(payload) && "context" in payload) {
              onContext?.(payload.context);
            }
            onSnapshot(payloadSessionLogEntries(payload));
          } else if (eventName === "orchestrator.session.entries") {
            noteTranscriptUpdate();
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
        retryAttempts = 0;
        onConnection("live");
        onError(null);
      })
      .catch(() => {
        if (!active || currentGeneration !== generation) return;
        connected = false;
        // The previous screen may still be releasing this execution channel.
        // Present the automatic retry as reconnecting instead of flashing a
        // terminal-looking RPC failure that normally disappears one second later.
        onConnection("reconnecting");
        onError(null);
        scheduleSubscriptionRetry(currentGeneration);
      });
  }

  function scheduleSubscriptionRetry(failedGeneration: number): void {
    clearRetryTimer();
    const retryDelayMs = Math.min(
      SUBSCRIBE_RETRY_MS * 2 ** retryAttempts,
      MAX_SUBSCRIBE_RETRY_MS,
    );
    retryAttempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!active || failedGeneration !== generation) return;
      onConnection("connecting");
      subscribe();
    }, retryDelayMs);
  }

  function noteTranscriptUpdate(): void {
    transcriptRevision += 1;
    clearRefreshTimer();
  }

  function refreshTranscript(): void {
    if (!active) return;
    connected = false;
    retryAttempts = 0;
    generation += 1;
    clearRetryTimer();
    unsubscribe?.();
    unsubscribe = null;
    onConnection("connecting");
    subscribe();
  }

  function clearRefreshTimer(): void {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function clearRetryTimer(): void {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  function disconnect(): void {
    if (!active) return;
    active = false;
    connected = false;
    generation += 1;
    clearRefreshTimer();
    clearRetryTimer();
    unsubscribe?.();
    unsubscribe = null;
    onConnection("offline");
  }

  async function steer(
    message: string,
    contextRefs: Array<{ type: "issue" | "file" | "pr"; id: string }> = [],
  ): Promise<void> {
    const normalized = message.trim();
    if (!normalized) throw new Error("Message is required");
    if (!connected && active)
      throw new Error("Execution session is not connected");
    const revisionBeforeSteer = transcriptRevision;
    await transport.call("orchestrator.session.command", {
      execution_session_id: executionSessionId,
      event: "steer",
      payload: {
        message: normalized,
        attachments: [],
        context_refs: contextRefs,
      },
    });
    clearRefreshTimer();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (active && transcriptRevision === revisionBeforeSteer)
        refreshTranscript();
    }, STEER_STREAM_REFRESH_MS);
  }

  return { connect, disconnect, steer };
}

function payloadReason(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.reason === "string"
    ? payload.reason
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
