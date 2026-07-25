export interface HostTransport {
  readonly hostId: string;
  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult>;
  subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent, eventName?: string) => void,
  ): Promise<() => void>;
  reconnect(): void;
  close(): void;
}
