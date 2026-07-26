import type { SessionTimelineState } from "@/features/sessions/session-reducer";
import type { HostTransport } from "@/transport/HostTransport";

import {
  normalizeExecutionPayload,
  type OrchestratorExecution,
} from "./orchestrator-executions";

export function createRpcOrchestratorExecutions({
  transport,
  onSnapshot,
  onConnection,
  onError,
}: {
  transport: HostTransport;
  onSnapshot(executions: OrchestratorExecution[]): void;
  onConnection(state: SessionTimelineState["connectionState"]): void;
  onError(message: string | null): void;
}) {
  let active = false;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;

  function connect(): void {
    if (active) return;
    active = true;
    const currentGeneration = ++generation;
    onConnection("connecting");
    onError(null);

    const subscription = transport.subscribe<Record<string, unknown>>(
      "orchestrator.executions.subscribe",
      {},
      (payload, eventName) => {
        if (
          active &&
          currentGeneration === generation &&
          eventName === "orchestrator.executions.snapshot"
        ) {
          onSnapshot(normalizeExecutionPayload(payload));
        }
      },
    );
    const initial = transport
      .call<Record<string, unknown>>("orchestrator.executions.list", {})
      .then((payload) => {
        if (active && currentGeneration === generation) {
          onSnapshot(normalizeExecutionPayload(payload));
        }
      });

    void Promise.all([subscription, initial])
      .then(([cleanup]) => {
        if (!active || currentGeneration !== generation) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
        onConnection("live");
      })
      .catch((error: unknown) => {
        if (!active || currentGeneration !== generation) return;
        onConnection("offline");
        onError(errorMessage(error));
      });
  }

  function disconnect(): void {
    if (!active) return;
    active = false;
    generation += 1;
    unsubscribe?.();
    unsubscribe = null;
    onConnection("offline");
  }

  return { connect, disconnect };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load orchestrator executions";
}
