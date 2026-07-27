import type { HostTransport } from "@/transport/HostTransport";

import {
  normalizeComparisonSnapshot,
  type ComparisonCellId,
  type ComparisonSnapshot,
} from "./comparison-contract";

export type ComparisonConnectionState = "connecting" | "live" | "offline";

export function createRpcComparison({
  transport,
  projectSlug,
  identifier,
  onSnapshot,
  onConnection,
  onError,
}: {
  transport: HostTransport;
  projectSlug: string;
  identifier: string;
  onSnapshot(snapshot: ComparisonSnapshot): void;
  onConnection(state: ComparisonConnectionState): void;
  onError(message: string | null): void;
}) {
  const params = { project_slug: projectSlug, identifier };
  let active = false;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;

  function connect(): void {
    if (active) return;
    active = true;
    const currentGeneration = ++generation;
    onConnection("connecting");
    onError(null);
    void establish(currentGeneration);
  }

  async function establish(currentGeneration: number): Promise<void> {
    try {
      const initial = await transport.call<unknown>("comparisons.get", params);
      if (!current(currentGeneration)) return;
      const initialSnapshot = normalizeComparisonSnapshot(initial);
      if (!initialSnapshot) {
        throw new Error("Symphony host returned an invalid comparison snapshot");
      }
      onSnapshot(initialSnapshot);

      const cleanup = await transport.subscribe<unknown>(
        "comparisons.subscribe",
        params,
        (payload, eventName) => {
          if (current(currentGeneration) && eventName === "comparisons.snapshot") {
            publish(payload);
          }
        },
      );

      if (!current(currentGeneration)) {
        cleanup();
        return;
      }

      unsubscribe = cleanup;
      onConnection("live");
    } catch (error: unknown) {
      if (!current(currentGeneration)) return;
      onConnection("offline");
      onError(errorMessage(error));
    }
  }

  function disconnect(): void {
    if (!active) return;
    active = false;
    generation += 1;
    unsubscribe?.();
    unsubscribe = null;
    onConnection("offline");
  }

  function reconnect(): void {
    disconnect();
    transport.reconnect();
    connect();
  }

  async function start(requestKey: string, signal?: AbortSignal): Promise<ComparisonSnapshot> {
    return mutate("comparisons.start", { ...params, request_key: requestKey }, signal);
  }

  async function retryCell(
    cellId: ComparisonCellId,
    requestKey: string,
    signal?: AbortSignal,
  ): Promise<ComparisonSnapshot> {
    return mutate(
      "comparisons.retry_cell",
      { ...params, request_key: requestKey, cell_id: cellId },
      signal,
    );
  }

  async function mutate(
    method: "comparisons.start" | "comparisons.retry_cell",
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ComparisonSnapshot> {
    const payload = signal
      ? await transport.call<unknown>(method, request, signal)
      : await transport.call<unknown>(method, request);
    const snapshot = normalizeComparisonSnapshot(payload);
    if (!snapshot) throw new Error("Symphony host returned an invalid comparison snapshot");
    onSnapshot(snapshot);
    return snapshot;
  }

  function publish(payload: unknown): void {
    const snapshot = normalizeComparisonSnapshot(payload);
    if (snapshot) onSnapshot(snapshot);
  }

  function current(candidate: number): boolean {
    return active && candidate === generation;
  }

  return { connect, disconnect, reconnect, start, retryCell };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Dev10x comparison";
}
