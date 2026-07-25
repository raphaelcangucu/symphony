import { RpcError } from "@/rpc/client";
import type { HostTransport } from "@/transport/HostTransport";

import type { BrowserScreencastFrame } from "./browser-screencast-protocol";
import type { ConnectionState, RpcFailure, RpcResponse, RpcSuccess } from "./types";

type SendRequestOptions = {
  timeoutMs?: number;
};

type SubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void;
};

type StreamingListener = (result: unknown) => void;

export type RpcClient = {
  sendRequest(method: string, params?: unknown, options?: SendRequestOptions): Promise<RpcResponse>;
  subscribe(
    method: string,
    params: unknown,
    onData: StreamingListener,
    options?: SubscribeOptions,
  ): () => void;
  updateTerminalSubscriptionViewport(
    terminal: string,
    viewport: { cols: number; rows: number },
  ): void;
  getState(): ConnectionState;
  getReconnectAttempt(): number;
  getLastConnectedAt(): number | null;
  onStateChange(listener: (state: ConnectionState) => void): () => void;
  notifyForeground(): void;
  close(): void;
};

export type OrcaConnectionStateSource = {
  getState(): ConnectionState;
  getReconnectAttempt(): number;
  getLastConnectedAt(): number | null;
  subscribe(listener: (state: ConnectionState) => void): () => void;
};

export function createSymphonyOrcaRpcClient(
  hostId: string,
  transport: HostTransport,
  state: OrcaConnectionStateSource,
): RpcClient {
  if (transport.hostId !== hostId) {
    throw new Error("Orca client and Symphony transport identities differ");
  }

  return {
    async sendRequest(method, params = {}, options = {}) {
      const id = createRequestId();
      const timeout = timeoutSignal(options.timeoutMs);
      try {
        const result = await transport.call(method, params, timeout.signal);
        return success(id, hostId, result);
      } catch (error) {
        return failure(id, hostId, error);
      } finally {
        timeout.dispose();
      }
    },
    subscribe(method, params, onData, options) {
      let disposed = false;
      let cleanup: (() => void) | null = null;
      void transport
        .subscribe(method, params ?? {}, (payload) => {
          if (disposed) return;
          if (isBrowserScreencastFrame(payload) && options?.onBinaryFrame) {
            options.onBinaryFrame(payload);
          } else {
            onData(payload);
          }
        })
        .then((boundCleanup) => {
          if (disposed) boundCleanup();
          else cleanup = boundCleanup;
        })
        .catch(() => undefined);
      return () => {
        disposed = true;
        cleanup?.();
      };
    },
    updateTerminalSubscriptionViewport: () => undefined,
    getState: state.getState,
    getReconnectAttempt: state.getReconnectAttempt,
    getLastConnectedAt: state.getLastConnectedAt,
    onStateChange: state.subscribe,
    notifyForeground: transport.reconnect,
    close: transport.deactivate,
  };
}

function success(id: string, hostId: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: hostId } };
}

function failure(id: string, hostId: string, error: unknown): RpcFailure {
  const publicError =
    error instanceof RpcError
      ? { code: error.code, message: error.message }
      : { code: "request_failed", message: publicMessage(error) };
  return { id, ok: false, error: publicError, _meta: { runtimeId: hostId } };
}

function publicMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Symphony host request failed";
}

function createRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function timeoutSignal(timeoutMs: number | undefined): {
  signal: AbortSignal | undefined;
  dispose(): void;
} {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: undefined, dispose: () => undefined };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

function isBrowserScreencastFrame(payload: unknown): payload is BrowserScreencastFrame {
  return (
    typeof payload === "object" && payload !== null && "data" in payload && "metadata" in payload
  );
}
