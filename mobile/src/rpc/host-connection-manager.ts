import type { HostTransport } from "@/transport/HostTransport";

export type HostConnectionStatus =
  | "offline"
  | "connecting"
  | "online"
  | "reconnecting"
  | "revoked"
  | "host_key_mismatch"
  | "protocol_incompatible";

export type ManagedHost = {
  hostId: string;
  endpoint: string;
  fingerprint: string;
  protocolVersion: number | null;
  transport: HostTransport;
};

type HostState = {
  status: HostConnectionStatus;
  missedHeartbeats: number;
  lastHeartbeatAt: number | null;
  failureCode: string | null;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

type HostConnectionManagerOptions = {
  heartbeatIntervalMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  jitter?: () => number;
  now?: () => number;
};

const terminalStates = new Set<HostConnectionStatus>([
  "revoked",
  "host_key_mismatch",
  "protocol_incompatible",
]);

export class HostConnectionManager {
  private readonly hosts = new Map<string, ManagedHost>();
  private readonly states = new Map<string, HostState>();
  private readonly cleanups = new Map<string, Set<() => void>>();
  private readonly heartbeatIntervalMs: number;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly jitter: () => number;
  private readonly now: () => number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private selectedHostId: string | null = null;

  constructor(options: HostConnectionManagerOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 500;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.jitter = options.jitter ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  get activeHostId(): string | null {
    return this.selectedHostId;
  }

  register(host: ManagedHost): void {
    if (host.hostId !== host.transport.hostId) {
      throw new Error("Managed host and transport identities differ");
    }
    this.hosts.set(host.hostId, host);
    this.states.set(host.hostId, initialState());
    this.cleanups.set(host.hostId, new Set());
  }

  select(hostId: string): void {
    const next = this.requireHost(hostId);
    const previousId = this.selectedHostId;
    if (previousId === hostId) return;

    if (previousId) {
      this.cleanupSubscriptions(previousId);
      this.clearReconnect(previousId);
      this.hosts.get(previousId)?.transport.close();
    }

    this.selectedHostId = next.hostId;
    const state = this.requireState(hostId);
    if (!terminalStates.has(state.status)) state.status = "connecting";
  }

  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult> {
    return this.activeHost().transport.call<TResult>(method, params, signal);
  }

  async subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent, eventName?: string) => void,
  ): Promise<() => void> {
    const host = this.activeHost();
    const cleanup = await host.transport.subscribe(method, params, onEvent);
    const cleanups = this.cleanups.get(host.hostId)!;
    let active = true;
    const trackedCleanup = () => {
      if (!active) return;
      active = false;
      cleanups.delete(trackedCleanup);
      cleanup();
    };
    cleanups.add(trackedCleanup);
    return trackedCleanup;
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.heartbeatIntervalMs);
  }

  markFailure(hostId: string, status: HostConnectionStatus): void {
    const state = this.requireState(hostId);
    state.status = status;
    state.failureCode = status;
    if (terminalStates.has(status)) this.clearReconnect(hostId);
  }

  onForeground(): void {
    this.retryActiveHost();
  }

  onNetworkReachable(): void {
    this.retryActiveHost();
  }

  state(hostId: string): Readonly<HostState> {
    return { ...this.requireState(hostId) };
  }

  diagnostics(hostId: string) {
    const host = this.requireHost(hostId);
    const state = this.requireState(hostId);
    return {
      hostId,
      endpoint: host.endpoint,
      fingerprint: host.fingerprint,
      protocolVersion: host.protocolVersion,
      heartbeatAgeMs:
        state.lastHeartbeatAt === null ? null : Math.max(0, this.now() - state.lastHeartbeatAt),
      failureCode: state.failureCode,
    };
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const hostId of this.hosts.keys()) {
      this.cleanupSubscriptions(hostId);
      this.clearReconnect(hostId);
      this.hosts.get(hostId)?.transport.close();
    }
    this.selectedHostId = null;
  }

  private async heartbeat(): Promise<void> {
    if (!this.selectedHostId) return;
    const hostId = this.selectedHostId;
    const state = this.requireState(hostId);
    if (terminalStates.has(state.status)) return;

    try {
      await this.requireHost(hostId).transport.call("system.heartbeat", {
        nonce: "heartbeat",
      });
      state.status = "online";
      state.missedHeartbeats = 0;
      state.lastHeartbeatAt = this.now();
      state.failureCode = null;
      state.reconnectAttempt = 0;
      this.clearReconnect(hostId);
    } catch {
      state.missedHeartbeats += 1;
      state.failureCode = "heartbeat_missed";
      if (state.missedHeartbeats >= 2) {
        state.status = "reconnecting";
        this.scheduleReconnect(hostId);
      }
    }
  }

  private scheduleReconnect(hostId: string): void {
    const state = this.requireState(hostId);
    if (state.reconnectTimer || terminalStates.has(state.status)) return;
    const base = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * 2 ** state.reconnectAttempt,
    );
    const delay = Math.min(
      this.maxReconnectDelayMs,
      base + Math.floor(base * 0.25 * this.jitter()),
    );
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (terminalStates.has(state.status)) return;
      this.requireHost(hostId).transport.reconnect();
      state.reconnectAttempt += 1;
      this.scheduleReconnect(hostId);
    }, delay);
  }

  private retryActiveHost(): void {
    if (!this.selectedHostId) return;
    const state = this.requireState(this.selectedHostId);
    if (terminalStates.has(state.status)) return;
    this.clearReconnect(this.selectedHostId);
    this.requireHost(this.selectedHostId).transport.reconnect();
    state.status = "reconnecting";
  }

  private clearReconnect(hostId: string): void {
    const state = this.states.get(hostId);
    if (!state?.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  private cleanupSubscriptions(hostId: string): void {
    const cleanups = this.cleanups.get(hostId);
    if (!cleanups) return;
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  private activeHost(): ManagedHost {
    if (!this.selectedHostId) throw new Error("No Symphony host is selected");
    return this.requireHost(this.selectedHostId);
  }

  private requireHost(hostId: string): ManagedHost {
    const host = this.hosts.get(hostId);
    if (!host) throw new Error("Symphony host is not registered");
    return host;
  }

  private requireState(hostId: string): HostState {
    const state = this.states.get(hostId);
    if (!state) throw new Error("Symphony host is not registered");
    return state;
  }
}

export function hostQueryKey(hostId: string, ...parts: readonly unknown[]): readonly unknown[] {
  if (!hostId.trim()) throw new Error("Host query key requires a host id");
  return ["host", hostId, ...parts];
}

function initialState(): HostState {
  return {
    status: "offline",
    missedHeartbeats: 0,
    lastHeartbeatAt: null,
    failureCode: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
  };
}
