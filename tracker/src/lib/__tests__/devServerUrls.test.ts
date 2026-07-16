import { describe, expect, it } from "vitest";

import {
  isEmbeddableServer,
  isServerInSync,
  localPreviewUrl,
  openablePreviewUrl,
  publicTunnelPreviewUrl,
  readyPreviewUrl,
  selectPrimaryServer,
} from "@/lib/devServerUrls";
import type { IssueDevServer } from "@/types/issue";

function server(overrides: Partial<IssueDevServer> = {}): IssueDevServer {
  return {
    id: 1,
    slug: "web",
    working_dir: "web",
    port: 5173,
    url: "http://myhost:5173/app",
    status: "ready",
    primary: false,
    session_name: null,
    ...overrides,
  };
}

describe("selectPrimaryServer", () => {
  it("prefers the explicit primary server", () => {
    const primary = server({ id: 2, primary: true, status: "stopped" });
    expect(selectPrimaryServer([server(), primary])).toBe(primary);
  });

  it("falls back to the first ready server, then the first server", () => {
    const ready = server({ id: 2 });
    expect(selectPrimaryServer([server({ status: "stopped" }), ready])).toBe(ready);

    const stopped = server({ status: "stopped" });
    expect(selectPrimaryServer([stopped])).toBe(stopped);
    expect(selectPrimaryServer([])).toBeNull();
  });
});

describe("readyPreviewUrl", () => {
  it("returns the url only for ready servers", () => {
    expect(readyPreviewUrl(server())).toBe("http://myhost:5173/app");
    expect(readyPreviewUrl(server({ status: "starting" }))).toBeNull();
    expect(readyPreviewUrl(server({ url: null }))).toBeNull();
    expect(readyPreviewUrl(null)).toBeNull();
  });
});

describe("publicTunnelPreviewUrl", () => {
  it("rejects loopback urls", () => {
    expect(publicTunnelPreviewUrl(server({ url: "http://127.0.0.1:5173/" }))).toBeNull();
    expect(publicTunnelPreviewUrl(server({ url: "https://demo.tracker.cods.dev/" }))).toBe(
      "https://demo.tracker.cods.dev/",
    );
  });
});

describe("localPreviewUrl", () => {
  it("builds a localhost url preserving the path", () => {
    expect(localPreviewUrl(server())).toBe("http://localhost:5173/app");
  });

  it("returns null for loopback urls or missing ports", () => {
    expect(localPreviewUrl(server({ url: "http://localhost:5173/" }))).toBeNull();
    expect(localPreviewUrl(server({ port: null }))).toBeNull();
  });
});

describe("openablePreviewUrl", () => {
  it("prefers the tunnel url when the tunnel runs, local url otherwise", () => {
    const s = server();
    expect(openablePreviewUrl(s, true)).toBe("http://myhost:5173/app");
    expect(openablePreviewUrl(s, false)).toBe("http://localhost:5173/app");
  });
});

describe("runtime contract sync gating", () => {
  it("treats missing or in_sync contracts as in sync, everything else as out of sync", () => {
    expect(isServerInSync(server())).toBe(true);
    expect(isServerInSync(server({ sync_state: "in_sync" }))).toBe(true);
    expect(isServerInSync(server({ sync_state: "conflict" }))).toBe(false);
    expect(isServerInSync(server({ sync_state: "awaiting_report" }))).toBe(false);
    expect(isServerInSync(null)).toBe(false);
  });

  it("only embeds a ready + in-sync server", () => {
    expect(isEmbeddableServer(server())).toBe(true);
    expect(isEmbeddableServer(server({ status: "ready", sync_state: "conflict" }))).toBe(false);
    expect(isEmbeddableServer(server({ status: "starting" }))).toBe(false);
  });

  it("produces no openable URL for an out-of-lease (conflict) server", () => {
    const conflicted = server({
      status: "ready",
      sync_state: "conflict",
      sync_reason: "actual port 59595 is outside allowed ports [4300, 4301]",
      local_url: "http://127.0.0.1:59595/health",
    });

    expect(readyPreviewUrl(conflicted)).toBeNull();
    expect(localPreviewUrl(conflicted)).toBeNull();
    expect(openablePreviewUrl(conflicted, false)).toBeNull();
    expect(openablePreviewUrl(conflicted, true)).toBeNull();
  });

  it("consumes the API local_url and rewrites the loopback host to localhost", () => {
    const s = server({ url: "http://127.0.0.1:4300/", local_url: "http://127.0.0.1:4300/health" });
    expect(localPreviewUrl(s)).toBe("http://localhost:4300/health");
  });

  it("prefers the API public_url for the ready/tunnel URL", () => {
    const s = server({
      url: "http://127.0.0.1:4300/",
      public_url: "https://demo.tracker.cods.dev/",
      local_url: "http://127.0.0.1:4300/",
    });
    expect(readyPreviewUrl(s)).toBe("https://demo.tracker.cods.dev/");
    expect(publicTunnelPreviewUrl(s)).toBe("https://demo.tracker.cods.dev/");
    expect(openablePreviewUrl(s, true)).toBe("https://demo.tracker.cods.dev/");
  });
});
