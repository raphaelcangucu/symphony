import { RpcError, type RpcClient } from "@/rpc/client";

import type { HostTransport } from "./HostTransport";

type RpcHostTransportOptions = {
  reconnect: () => void;
  close?: () => void;
};

type LogicalSubscription<TEvent = unknown> = {
  method: string;
  params: unknown;
  onEvent: (event: TEvent, eventName?: string) => void;
  remoteCleanup: (() => void) | null;
  cleanup: () => void;
  binding: Promise<void> | null;
  active: boolean;
  settled: boolean;
  resolve: (cleanup: () => void) => void;
  reject: (reason: unknown) => void;
};

export class RpcHostTransport implements HostTransport {
  readonly hostId: string;
  private readonly client: RpcClient;
  private readonly options: RpcHostTransportOptions;
  private readonly subscriptions = new Set<LogicalSubscription>();
  private closed = false;

  constructor(hostId: string, client: RpcClient, options: RpcHostTransportOptions) {
    this.hostId = hostId;
    this.client = client;
    this.options = options;
  }

  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult> {
    return this.client.call<TResult>(method, params, signal ? { signal } : {});
  }

  subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent, eventName?: string) => void,
  ): Promise<() => void> {
    if (this.closed) {
      return Promise.reject(new RpcError("connection_closed", "RPC connection is closed", true));
    }

    let resolveReady!: (cleanup: () => void) => void;
    let rejectReady!: (reason: unknown) => void;
    const ready = new Promise<() => void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const subscription: LogicalSubscription<TEvent> = {
      method,
      params,
      onEvent,
      remoteCleanup: null,
      cleanup: () => undefined,
      binding: null,
      active: true,
      settled: false,
      resolve: resolveReady,
      reject: rejectReady,
    };
    subscription.cleanup = () => {
      if (!subscription.active) return;
      subscription.active = false;
      this.subscriptions.delete(subscription as LogicalSubscription);
      subscription.remoteCleanup?.();
      subscription.remoteCleanup = null;
    };
    this.subscriptions.add(subscription as LogicalSubscription);
    void this.ensureBound(subscription).catch(() => undefined);

    return ready;
  }

  reconnect(): void {
    if (this.closed) return;
    this.handleDisconnect();
    this.options.reconnect();
  }

  handleDisconnect(): void {
    if (this.closed) return;
    this.client.resetConnection();
    for (const subscription of this.subscriptions) subscription.remoteCleanup = null;
  }

  async handleOnline(): Promise<void> {
    if (this.closed) return;
    await Promise.all(
      [...this.subscriptions].map(async (subscription) => {
        await subscription.binding;
        if (subscription.active && !subscription.remoteCleanup) {
          await this.ensureBound(subscription);
        }
      }),
    );
  }

  deactivate(): void {
    if (this.closed) return;
    for (const subscription of this.subscriptions) {
      subscription.remoteCleanup?.();
      subscription.remoteCleanup = null;
    }
    this.client.resetConnection();
    this.options.close?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions) {
      subscription.active = false;
      subscription.remoteCleanup?.();
      if (!subscription.settled) {
        subscription.settled = true;
        subscription.reject(
          new RpcError("connection_closed", "RPC connection closed before subscribing", true),
        );
      }
    }
    this.subscriptions.clear();
    this.client.close();
    this.options.close?.();
  }

  private ensureBound<TEvent>(subscription: LogicalSubscription<TEvent>): Promise<void> {
    if (!subscription.active || subscription.remoteCleanup) return Promise.resolve();
    if (subscription.binding) return subscription.binding;

    const binding = this.bindSubscription(subscription)
      .then(() => {
        if (!subscription.active) {
          subscription.remoteCleanup?.();
          subscription.remoteCleanup = null;
          return;
        }
        if (!subscription.settled) {
          subscription.settled = true;
          subscription.resolve(subscription.cleanup);
        }
      })
      .catch((error: unknown) => {
        if (!subscription.active || retryableConnectionError(error)) return;
        subscription.active = false;
        this.subscriptions.delete(subscription as LogicalSubscription);
        if (!subscription.settled) {
          subscription.settled = true;
          subscription.reject(error);
        }
        throw error;
      })
      .finally(() => {
        if (subscription.binding === binding) subscription.binding = null;
      });
    subscription.binding = binding;
    return binding;
  }

  private async bindSubscription<TEvent>(subscription: LogicalSubscription<TEvent>): Promise<void> {
    const subscriptionMethod = subscription.method.endsWith(".events")
      ? `${subscription.method.slice(0, -".events".length)}.subscribe`
      : subscription.method;
    const result = await this.client.call<{ subscription_id: string }>(
      subscriptionMethod,
      subscription.params,
    );
    subscription.remoteCleanup = this.client.trackSubscription(
      result.subscription_id,
      (payload, event) => subscription.onEvent(payload as TEvent, event),
    );
  }
}

function retryableConnectionError(error: unknown): boolean {
  return (
    error instanceof RpcError &&
    (error.code === "connection_unavailable" || error.code === "connection_lost")
  );
}
