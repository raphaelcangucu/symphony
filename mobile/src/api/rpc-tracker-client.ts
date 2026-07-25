import type { HostTransport } from "@/transport/HostTransport";

import { createTrackerClientFromRequest, type TrackerRequestOptions } from "./client";
import type { TrackerClient } from "./contracts";

type RpcTrackerRequest = {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body: unknown | null;
  idempotency_key: string | null;
};

export function createRpcTrackerClient(transport: HostTransport): TrackerClient {
  return createTrackerClientFromRequest(async (path, options = {}) => {
    if (options.tracker === false && path === "/health") {
      return transport.call("system.health", {}, options.signal);
    }

    return transport.call(methodForPath(path), rpcRequest(path, options), options.signal);
  });
}

function rpcRequest(path: string, options: TrackerRequestOptions): RpcTrackerRequest {
  return {
    path,
    method: options.method ?? "GET",
    body: options.body ?? null,
    idempotency_key: options.idempotencyKey ?? null,
  };
}

function methodForPath(path: string): string {
  const pathname = path.split("?", 1)[0] ?? "";

  if (pathname === "/viewer" || pathname.startsWith("/settings/")) {
    return "system.tracker";
  }
  if (pathname.startsWith("/mobile_push/")) return "notifications.request";
  if (pathname === "/projects") return "projects.request";
  if (/^\/assistant\/threads\/[^/]+\/(?:documents|files)(?:\/|$)/.test(pathname)) {
    return "workspace.request";
  }
  if (/^\/assistant\/threads\/[^/]+\/diff(?:\/|$)/.test(pathname)) {
    return "git.request";
  }
  if (/^\/assistant\/threads\/[^/]+\/dev_servers(?:\/|$)/.test(pathname)) {
    return "previews.request";
  }
  if (pathname.startsWith("/assistant/threads")) return "sessions.request";
  if (/^\/projects\/[^/]+\/sessions$/.test(pathname)) return "sessions.request";
  if (/^\/projects\/[^/]+\/assistant\/config$/.test(pathname)) return "sessions.request";
  if (/^\/projects\/[^/]+\/issues\/[^/]+\/pull_requests(?:\/|$)/.test(pathname)) {
    return "pull_requests.request";
  }
  if (/^\/projects\/[^/]+\/issues(?:\/|$)/.test(pathname)) return "tasks.request";

  throw new Error(`Tracker route is not available over Symphony mobile RPC: ${pathname}`);
}
