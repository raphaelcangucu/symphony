import type { IssueDevServer } from "@/types/issue";

/** Picks the server to feature: explicit primary, else first ready, else first. */
export function selectPrimaryServer(servers: IssueDevServer[]): IssueDevServer | null {
  return servers.find((server) => server.primary) ?? servers.find((server) => server.status === "ready") ?? servers[0] ?? null;
}

export function readyPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.url) {
    return null;
  }

  return server.url;
}

export function publicTunnelPreviewUrl(server: IssueDevServer | null): string | null {
  const url = readyPreviewUrl(server);
  if (!url || isLoopbackUrl(url)) {
    return null;
  }

  return url;
}

export function localPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.port) {
    return null;
  }

  if (isLoopbackUrl(server.url)) {
    return null;
  }

  // Use `localhost` (not `127.0.0.1`): the browser may run on a different host
  // than the dev server (e.g. Windows browser + WSL2 dev servers). `localhost`
  // resolves to both ::1 and 127.0.0.1, so it reaches IPv6-bound listeners
  // (Go's default `[::]` bind, e.g. goapi) as well as IPv4 `0.0.0.0` listeners,
  // whereas a hardcoded `127.0.0.1` fails for IPv6-only forwarded listeners.
  return `http://localhost:${server.port}${pathFromUrl(server.url)}`;
}

/** URL to open for a server: public tunnel URL when running, local URL otherwise. */
export function openablePreviewUrl(server: IssueDevServer | null, tunnelRunning: boolean): string | null {
  const previewUrl = readyPreviewUrl(server);
  const localUrl = localPreviewUrl(server);
  return tunnelRunning ? previewUrl : (localUrl ?? previewUrl);
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
