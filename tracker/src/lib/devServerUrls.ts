import type { IssueDevServer } from "@/types/issue";

/** Picks the server to feature: explicit primary, else first ready, else first. */
export function selectPrimaryServer(servers: IssueDevServer[]): IssueDevServer | null {
  return servers.find((server) => server.primary) ?? servers.find((server) => server.status === "ready") ?? servers[0] ?? null;
}

/**
 * A server is in sync when it carries no contract (legacy / flag off) or its
 * runtime contract reports `in_sync`. Any other sync state (conflict, awaiting,
 * not_ready, stale) means the accepted runtime does not match the lease, so the
 * dock must NOT embed it.
 */
export function isServerInSync(server: IssueDevServer | null): boolean {
  if (!server) {
    return false;
  }

  return server.sync_state == null || server.sync_state === "in_sync";
}

/** Only a ready + in-sync server may be embedded or opened. */
export function isEmbeddableServer(server: IssueDevServer | null): boolean {
  return server != null && server.status === "ready" && isServerInSync(server);
}

export function readyPreviewUrl(server: IssueDevServer | null): string | null {
  if (!isEmbeddableServer(server)) {
    return null;
  }

  return server?.public_url ?? server?.url ?? null;
}

export function publicTunnelPreviewUrl(server: IssueDevServer | null): string | null {
  const url = readyPreviewUrl(server);
  if (!url || isLoopbackUrl(url)) {
    return null;
  }

  return url;
}

export function localPreviewUrl(server: IssueDevServer | null): string | null {
  if (!isEmbeddableServer(server) || !server) {
    return null;
  }

  // Prefer the API-provided local URL (single source of truth), rewriting the
  // loopback host to `localhost`: the browser may run on a different host than
  // the dev server (e.g. Windows browser + WSL2), and `localhost` resolves to
  // both ::1 and 127.0.0.1, reaching IPv6-bound listeners (Go's default `[::]`)
  // as well as IPv4 listeners.
  if (server.local_url) {
    return toLocalhostUrl(server.local_url);
  }

  // Legacy fallback for payloads without a local_url: rebuild from the port and
  // the path of a non-loopback public URL.
  if (!server.port || isLoopbackUrl(server.url)) {
    return null;
  }

  return `http://localhost:${server.port}${pathFromUrl(server.url)}`;
}

/** URL to open for a server: public tunnel URL when running, local URL otherwise. */
export function openablePreviewUrl(server: IssueDevServer | null, tunnelRunning: boolean): string | null {
  const previewUrl = readyPreviewUrl(server);
  const localUrl = localPreviewUrl(server);
  return tunnelRunning ? previewUrl : (localUrl ?? previewUrl);
}

function toLocalhostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
      parsed.hostname = "localhost";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function pathFromUrl(url: string | null): string {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return "/";
  }
}

function isLoopbackUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
