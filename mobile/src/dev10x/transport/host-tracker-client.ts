import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import type { TrackerClient } from "@/api/contracts";
import type { HostTransport } from "@/transport/HostTransport";

import type { RpcClient } from "./rpc-client";

/**
 * Adapts the direct encrypted Dev10x RPC client to the shared tracker client.
 * Keeping the API-shaped client here lets project, task and session screens use
 * the same typed contracts regardless of whether the host was paired by E2EE.
 */
export function createHostTrackerClient(hostId: string, client: RpcClient): TrackerClient {
  const transport: HostTransport = {
    hostId,
    async call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult> {
      if (signal?.aborted) {
        throw new Error("Request cancelled");
      }
      const response = await client.sendRequest(method, params);
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return response.result as TResult;
    },
    async subscribe<TEvent>(
      method: string,
      params: unknown,
      onEvent: (event: TEvent, eventName?: string) => void,
    ): Promise<() => void> {
      return client.subscribe(method, params, (event) => onEvent(event as TEvent));
    },
    reconnect() {
      client.notifyForeground();
    },
    deactivate() {
      client.close();
    },
    close() {
      client.close();
    },
  };

  return createRpcTrackerClient(transport);
}
