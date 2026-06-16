import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { getTrackerToken } from "@/config";
import type { IssueDevServerTunnel, IssueDevServersResponse } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";

type IssueDevServerAction = "start" | "stop" | "restart";

const DEV_SERVERS_PATH_SEGMENT = "dev_servers";

export async function fetchIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  const response = await http.get(issueDevServersPath(projectSlug, issueIdentifier));

  return unwrapData<IssueDevServersResponse>(response);
}

export async function startIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "start");
}

export async function stopIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "stop");
}

export async function restartIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "restart");
}

export async function startIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "start");
}

export async function stopIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "stop");
}

export async function restartIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "restart");
}

async function postIssueDevServerAction(
  projectSlug: string,
  issueIdentifier: string,
  action: IssueDevServerAction,
): Promise<IssueDevServersResponse> {
  const response = await http.post(`${issueDevServersPath(projectSlug, issueIdentifier)}/${action}`);

  return unwrapData<IssueDevServersResponse>(response);
}

async function postIssueDevServerInstanceAction(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
  action: IssueDevServerAction,
): Promise<IssueDevServersResponse> {
  if (!Number.isInteger(serverId) || serverId <= 0) {
    throw new Error("serverId must be a positive integer");
  }

  const response = await http.post(
    `${issueDevServersPath(projectSlug, issueIdentifier)}/${encodeURIComponent(String(serverId))}/${action}`,
  );

  return unwrapData<IssueDevServersResponse>(response);
}

export async function fetchDevServerOutput(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<{ output: string; session_name: string }> {
  if (!Number.isInteger(serverId) || serverId <= 0) {
    throw new Error("serverId must be a positive integer");
  }

  const response = await http.get(
    `${issueDevServersPath(projectSlug, issueIdentifier)}/${encodeURIComponent(String(serverId))}/output`,
  );

  const data = unwrapData<{ output: string; session_name: string }>(response);

  return {
    output: data.output ?? "",
    session_name: data.session_name ?? "",
  };
}

export interface DevServerOutputPayload {
  output: string;
  session_name: string;
  status?: string;
}

export interface DevServerOutputStreamHandlers {
  onSnapshot: (payload: DevServerOutputPayload) => void;
  onUpdate: (payload: DevServerOutputPayload) => void;
  onDone?: (payload: { status: string }) => void;
  onError?: () => void;
}

export function subscribeDevServerOutput(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
  handlers: DevServerOutputStreamHandlers,
): () => void {
  if (!Number.isInteger(serverId) || serverId <= 0) {
    handlers.onError?.();
    return () => undefined;
  }

  if (typeof EventSource === "undefined") {
    handlers.onError?.();
    return () => undefined;
  }

  const url = new URL(
    `${issueDevServersPath(projectSlug, issueIdentifier)}/${encodeURIComponent(String(serverId))}/output/events`,
    window.location.origin,
  );
  const token = getTrackerToken();

  if (token) {
    url.searchParams.set("token", token);
  }

  const source = new EventSource(url.toString());
  let closed = false;

  const handlePayload = (
    event: MessageEvent<string>,
    handler: (payload: DevServerOutputPayload) => void,
  ) => {
    try {
      const payload = JSON.parse(event.data) as { data?: DevServerOutputPayload };
      if (payload.data) {
        handler(payload.data);
      }
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
      const payload = JSON.parse((event as MessageEvent<string>).data) as { data?: { status?: string } };
      if (payload.data?.status) {
        handlers.onDone?.({ status: payload.data.status });
      }
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
    if (closed) {
      return;
    }

    handlers.onError?.();
  };

  return () => {
    source.close();
  };
}

export async function startPublicTunnel(): Promise<IssueDevServerTunnel> {
  const response = await http.post(trackerPath("/tunnel/start"));

  return unwrapData<IssueDevServerTunnel>(response);
}

export interface IssueDevServersStreamHandlers {
  onSnapshot: (response: IssueDevServersResponse) => void;
  onUpdate: (response: IssueDevServersResponse) => void;
  onError?: () => void;
}

export function subscribeIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
  handlers: IssueDevServersStreamHandlers,
): () => void {
  if (typeof EventSource === "undefined") {
    handlers.onError?.();
    return () => undefined;
  }

  const url = new URL(issueDevServersEventsPath(projectSlug, issueIdentifier), window.location.origin);
  const token = getTrackerToken();

  if (token) {
    url.searchParams.set("token", token);
  }

  const source = new EventSource(url.toString());

  const handlePayload = (event: MessageEvent<string>, handler: (response: IssueDevServersResponse) => void) => {
    try {
      const payload = JSON.parse(event.data) as { data?: IssueDevServersResponse };
      if (payload.data) {
        handler(payload.data);
      }
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

  source.onerror = () => {
    handlers.onError?.();
  };

  return () => {
    source.close();
  };
}

function issueDevServersEventsPath(projectSlug: string, issueIdentifier: string): string {
  return `${issueDevServersPath(projectSlug, issueIdentifier)}/events`;
}

function issueDevServersPath(projectSlug: string, issueIdentifier: string): string {
  requireNonBlank(projectSlug, "projectSlug");
  const normalizedIssueIdentifier = normalizeIssueIdentifier(issueIdentifier);
  requireNonBlank(normalizedIssueIdentifier, "issueIdentifier");

  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(normalizedIssueIdentifier)}/${DEV_SERVERS_PATH_SEGMENT}`,
  );
}

function requireNonBlank(value: string, fieldName: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}
