import type { RpcCancel, RpcRequest, RpcResult, StreamEvent } from "./contracts";

export interface RpcWireTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): () => void;
}

export type RpcCallOptions = {
  deadlineMs?: number;
  signal?: AbortSignal;
};

type RpcClientOptions = {
  createId: () => string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: RpcError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal | null;
  abortHandler: (() => void) | null;
};

type Subscription = {
  sequence: number;
  onEvent: (payload: unknown, event: string) => void;
};

export class RpcError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly data: unknown;

  constructor(code: string, message: string, retryable: boolean, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.retryable = retryable;
    this.data = data;
  }
}

export class RpcClient {
  private readonly transport: RpcWireTransport;
  private readonly createId: () => string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly usedIds = new Set<string>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly stopListening: () => void;
  private closed = false;

  constructor(transport: RpcWireTransport, options: RpcClientOptions) {
    this.transport = transport;
    this.createId = options.createId;
    this.stopListening = transport.onMessage((message) => this.handleMessage(message));
  }

  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  call<TResult>(method: string, params: unknown, options: RpcCallOptions = {}): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new RpcError("connection_closed", "RPC connection is closed", true));
    }

    const id = this.uniqueId();
    const request: RpcRequest = { type: "rpc", id, method, params };
    if (options.deadlineMs !== undefined) request.deadline_ms = options.deadlineMs;

    return new Promise<TResult>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer: null,
        signal: options.signal ?? null,
        abortHandler: null,
      };

      if (options.deadlineMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.cancel(id, new RpcError("deadline_exceeded", "RPC request deadline exceeded", true));
        }, options.deadlineMs);
      }

      this.pending.set(id, pending);
      this.usedIds.add(id);

      if (options.signal) {
        pending.abortHandler = () => {
          this.cancel(id, new RpcError("cancelled", "RPC request was cancelled", false));
        };
        options.signal.addEventListener("abort", pending.abortHandler, { once: true });
        if (options.signal.aborted) {
          pending.abortHandler();
          return;
        }
      }

      try {
        this.transport.send(JSON.stringify(request));
      } catch {
        this.rejectPending(
          id,
          new RpcError(
            "connection_unavailable",
            "RPC request could not be sent while the connection is offline",
            true,
          ),
        );
      }
    });
  }

  trackSubscription(
    subscriptionId: string,
    onEvent: (payload: unknown, event: string) => void,
  ): () => void {
    if (!subscriptionId.trim() || this.subscriptions.has(subscriptionId)) {
      throw new Error("Invalid or duplicate RPC subscription id");
    }
    this.subscriptions.set(subscriptionId, { sequence: 0, onEvent });

    return () => {
      if (!this.subscriptions.delete(subscriptionId)) return;
      try {
        this.transport.send(
          JSON.stringify({ type: "unsubscribe", subscription_id: subscriptionId }),
        );
      } catch {
        // The remote subscription already dies with the disconnected socket.
      }
    };
  }

  resetConnection(): void {
    if (this.closed) return;
    for (const [id] of this.pending) {
      this.rejectPending(
        id,
        new RpcError("connection_lost", "RPC connection lost before response", true),
      );
    }
    this.subscriptions.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopListening();

    for (const [id] of this.pending) {
      this.rejectPending(
        id,
        new RpcError("connection_closed", "RPC connection closed before response", true),
      );
    }
    this.subscriptions.clear();
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (isRpcResult(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.cleanupPending(message.id, pending);

      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new RpcError(
            message.error.code,
            message.error.message,
            message.error.retryable,
            message.error.data,
          ),
        );
      }
      return;
    }

    if (isStreamEvent(message)) {
      const subscription = this.subscriptions.get(message.subscription_id);
      if (!subscription || message.sequence !== subscription.sequence + 1) return;
      subscription.sequence = message.sequence;
      subscription.onEvent(message.payload, message.event);
    }
  }

  private cancel(id: string, error: RpcError): void {
    if (!this.pending.has(id)) return;
    const cancel: RpcCancel = { type: "cancel", id };
    try {
      this.transport.send(JSON.stringify(cancel));
    } catch {
      // Cancellation remains local when the wire is already unavailable.
    }
    this.rejectPending(id, error);
  }

  private rejectPending(id: string, error: RpcError): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupPending(id, pending);
    pending.reject(error);
  }

  private cleanupPending(id: string, pending: PendingRequest): void {
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
  }

  private uniqueId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.createId();
      if (id.trim() && !this.usedIds.has(id)) return id;
    }
    throw new Error("Unable to allocate a unique RPC request id");
  }
}

function isRpcResult(value: unknown): value is RpcResult {
  if (!isRecord(value) || value.type !== "result" || typeof value.id !== "string") return false;
  if (!isMetadata(value.meta) || typeof value.ok !== "boolean") return false;
  if (value.ok) return "result" in value;

  return (
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.retryable === "boolean"
  );
}

function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    isRecord(value) &&
    value.type === "event" &&
    typeof value.subscription_id === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    typeof value.event === "string" &&
    "payload" in value
  );
}

function isMetadata(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.host_id === "string" &&
    Number.isSafeInteger(value.protocol) &&
    typeof value.server_timestamp === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
