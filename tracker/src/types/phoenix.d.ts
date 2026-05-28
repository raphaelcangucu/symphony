declare module "phoenix" {
  export interface Push {
    receive(status: string, callback: (response: unknown) => void): Push;
  }

  export interface Channel {
    on(event: string, callback: (payload: unknown) => void): void;
    join(): Push;
    leave(): Push;
    push(event: string, payload: Record<string, unknown>): Push;
  }

  export class Socket {
    constructor(endpoint: string, options?: { params?: Record<string, string> });
    connect(): void;
    disconnect(): void;
    channel(topic: string, params?: Record<string, unknown>): Channel;
  }
}
