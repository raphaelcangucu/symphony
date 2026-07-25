import type { RpcClient } from "@/rpc/client";

import type { HostTransport } from "./HostTransport";

type RpcHostTransportOptions = {
  reconnect: () => void;
  close?: () => void;
};

export class RpcHostTransport implements HostTransport {
  readonly hostId: string;
  private readonly client: RpcClient;
  private readonly options: RpcHostTransportOptions;

  constructor(hostId: string, client: RpcClient, options: RpcHostTransportOptions) {
    this.hostId = hostId;
    this.client = client;
    this.options = options;
  }

  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult> {
    return this.client.call<TResult>(method, params, signal ? { signal } : {});
  }

  async subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent) => void,
  ): Promise<() => void> {
    const subscriptionMethod = method.endsWith(".events")
      ? `${method.slice(0, -".events".length)}.subscribe`
      : method;
    const result = await this.client.call<{ subscription_id: string }>(subscriptionMethod, params);
    return this.client.trackSubscription(result.subscription_id, (payload) =>
      onEvent(payload as TEvent),
    );
  }

  reconnect(): void {
    this.options.reconnect();
  }

  close(): void {
    this.client.close();
    this.options.close?.();
  }
}
