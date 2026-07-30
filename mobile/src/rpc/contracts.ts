export type RpcMetadata = {
  host_id: string;
  protocol: number;
  server_timestamp: string;
};

export type RpcRequest = {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
  deadline_ms?: number;
};

export type RpcCancel = {
  type: "cancel";
  id: string;
};

export type RpcResult =
  | {
      type: "result";
      id: string;
      ok: true;
      result: unknown;
      meta: RpcMetadata;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
        data?: unknown;
      };
      meta: RpcMetadata;
    };

export type StreamEvent = {
  type: "event";
  subscription_id: string;
  sequence: number;
  event: string;
  payload: unknown;
};
