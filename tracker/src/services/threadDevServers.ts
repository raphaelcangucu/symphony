import { getTrackerToken } from "@/config";
import { requirePositiveInteger } from "@/lib/serviceValidation";
import type { IssueDevServersResponse } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import type {
  DevServerOutputPayload,
  DevServerOutputStreamHandlers,
  IssueDevServersStreamHandlers,
} from "./issueDevServers";

type DevServerAction = "start" | "stop" | "restart";

export async function fetchThreadDevServers(threadId: number): Promise<IssueDevServersResponse> {
  const response = await http.get(threadDevServersPath(threadId));
  return unwrapData<IssueDevServersResponse>(response);
}

export async function startThreadDevServers(threadId: number): Promise<IssueDevServersResponse> {
  return postThreadAction(threadId, "start");
}

export async function stopThreadDevServers(threadId: number): Promise<IssueDevServersResponse> {
  return postThreadAction(threadId, "stop");
}

export async function restartThreadDevServers(threadId: number): Promise<IssueDevServersResponse> {
  return postThreadAction(threadId, "restart");
}

export async function startThreadDevServer(
  threadId: number,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postThreadServerAction(threadId, serverId, "start");
}

export async function stopThreadDevServer(
  threadId: number,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postThreadServerAction(threadId, serverId, "stop");
}

export async function restartThreadDevServer(
  threadId: number,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postThreadServerAction(threadId, serverId, "restart");
}

export async function fetchThreadDevServerOutput(
  threadId: number,
  serverId: number,
): Promise<{ output: string; session_name: string }> {
  requirePositiveInteger(serverId, "serverId");

  const response = await http.get(
    `${threadDevServersPath(threadId)}/${encodeURIComponent(String(serverId))}/output`,
  );
  const data = unwrapData<{ output?: string; session_name?: string }>(response);

  return {
    output: data.output ?? "",
    session_name: data.session_name ?? "",
  };
}

export function subscribeThreadDevServers(
  threadId: number,
  handlers: IssueDevServersStreamHandlers,
): () => void {
  const source = eventSourceFor(`${threadDevServersPath(threadId)}/events`, handlers.onError);
  if (!source) return () => undefined;

  const handlePayload = (
    event: MessageEvent<string>,
    handler: (response: IssueDevServersResponse) => void,
  ) => {
    try {
      const payload = JSON.parse(event.data) as { data?: IssueDevServersResponse };
      if (payload.data) handler(payload.data);
    } catch {
      handlers.onError?.();
    }
  };

  source.addEventListener("snapshot", (event) => {
    handlePayload(event as MessageEvent<string>, handlers.onSnapshot);
  });
  source.addEventListener("update", (event) => {
    handlePayload(event as MessageEvent<string>, handlers.onUpdate);
  });
  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

export function subscribeThreadDevServerOutput(
  threadId: number,
  serverId: number,
  handlers: DevServerOutputStreamHandlers,
): () => void {
  if (!Number.isInteger(serverId) || serverId <= 0) {
    handlers.onError?.();
    return () => undefined;
  }

  const source = eventSourceFor(
    `${threadDevServersPath(threadId)}/${encodeURIComponent(String(serverId))}/output/events`,
    handlers.onError,
  );
  if (!source) return () => undefined;

  let closed = false;
  const handlePayload = (
    event: MessageEvent<string>,
    handler: (payload: DevServerOutputPayload) => void,
  ) => {
    try {
      const payload = JSON.parse(event.data) as { data?: DevServerOutputPayload };
      if (payload.data) handler(payload.data);
    } catch {
      handlers.onError?.();
    }
  };

  source.addEventListener("snapshot", (event) => {
    handlePayload(event as MessageEvent<string>, handlers.onSnapshot);
  });
  source.addEventListener("update", (event) => {
    handlePayload(event as MessageEvent<string>, handlers.onUpdate);
  });
  source.addEventListener("done", (event) => {
    closed = true;
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        data?: { status?: string };
      };
      if (payload.data?.status) handlers.onDone?.({ status: payload.data.status });
    } catch {
      handlers.onError?.();
    }
    source.close();
  });
  source.addEventListener("failure", () => {
    closed = true;
    handlers.onError?.();
    source.close();
  });
  source.onerror = () => {
    if (!closed) handlers.onError?.();
  };

  return () => source.close();
}

async function postThreadAction(
  threadId: number,
  action: DevServerAction,
): Promise<IssueDevServersResponse> {
  const response = await http.post(`${threadDevServersPath(threadId)}/${action}`);
  return unwrapData<IssueDevServersResponse>(response);
}

async function postThreadServerAction(
  threadId: number,
  serverId: number,
  action: DevServerAction,
): Promise<IssueDevServersResponse> {
  requirePositiveInteger(serverId, "serverId");
  const response = await http.post(
    `${threadDevServersPath(threadId)}/${encodeURIComponent(String(serverId))}/${action}`,
  );
  return unwrapData<IssueDevServersResponse>(response);
}

function threadDevServersPath(threadId: number): string {
  const validThreadId = requirePositiveInteger(threadId, "threadId");
  return trackerPath(`/assistant/threads/${encodeURIComponent(String(validThreadId))}/dev_servers`);
}

function eventSourceFor(path: string, onError?: () => void): EventSource | null {
  if (typeof EventSource === "undefined") {
    onError?.();
    return null;
  }

  const url = new URL(path, window.location.origin);
  const token = getTrackerToken();
  if (token) url.searchParams.set("token", token);
  return new EventSource(url.toString());
}
