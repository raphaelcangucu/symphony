import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return {
    ...actual,
    getTrackerToken: vi.fn(() => "secret"),
  };
});

import {
  fetchIssueDevServers,
  restartIssueDevServer,
  restartIssueDevServers,
  startIssueDevServer,
  startIssueDevServers,
  stopIssueDevServer,
  stopIssueDevServers,
  subscribeDevServerOutput,
} from "@/services/issueDevServers";
import { http } from "@/services/http";
import type { IssueDevServersResponse } from "@/types/issue";

describe("issue dev-server service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const response: IssueDevServersResponse = {
    available: true,
    reason: null,
    servers: [
      {
        id: 1,
        slug: "web",
        working_dir: "tracker",
        port: 5173,
        url: "http://127.0.0.1:5173",
        status: "ready",
        primary: true,
        session_name: "sym-issue-macro-markets-#508-web",
      },
    ],
  };

  it("fetches issue dev servers and unwraps the response data", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: response } });

    const result = await fetchIssueDevServers("macro markets", "#508");

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro%20markets/issues/508/dev_servers",
    );
    expect(result).toEqual(response);
  });

  it("starts issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await startIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/start",
    );
    expect(result).toEqual(response);
  });

  it("stops issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await stopIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/stop",
    );
    expect(result).toEqual(response);
  });

  it("restarts issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await restartIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/restart",
    );
    expect(result).toEqual(response);
  });

  it("starts a single issue dev server through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await startIssueDevServer("macro-markets", "MAC-1", 42);

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/42/start",
    );
    expect(result).toEqual(response);
  });

  it("stops a single issue dev server through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await stopIssueDevServer("macro-markets", "MAC-1", 42);

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/42/stop",
    );
    expect(result).toEqual(response);
  });

  it("restarts a single issue dev server through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await restartIssueDevServer("macro-markets", "MAC-1", 42);

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/42/restart",
    );
    expect(result).toEqual(response);
  });

  it("validates required project and issue identifiers", async () => {
    await expect(fetchIssueDevServers(" ", "508")).rejects.toThrow(/projectSlug/);
    await expect(fetchIssueDevServers("macro-markets", " ")).rejects.toThrow(/issueIdentifier/);
    await expect(fetchIssueDevServers("macro-markets", " # ")).rejects.toThrow(/issueIdentifier/);
  });

  it("subscribes to dev-server output events", () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    const close = vi.fn();
    let createdUrl = "";

    class MockEventSource {
      addEventListener = vi.fn((event: string, handler: (event: MessageEvent<string>) => void) => {
        listeners.set(event, handler);
      });

      close = close;

      onerror: (() => void) | null = null;

      constructor(url: string) {
        createdUrl = url;
      }
    }

    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    const onSnapshot = vi.fn();
    const unsubscribe = subscribeDevServerOutput("gamba", "1878", 42, { onSnapshot, onUpdate: vi.fn() });

    expect(listeners.has("snapshot")).toBe(true);
    expect(new URL(createdUrl).pathname).toBe(
      "/api/tracker/v1/projects/gamba/issues/1878/dev_servers/42/output/events",
    );
    expect(new URL(createdUrl).searchParams.get("token")).toBe("secret");

    listeners.get("snapshot")?.({ data: JSON.stringify({ data: { output: "boot\n", session_name: "sym-dev" } }) } as MessageEvent<string>);
    expect(onSnapshot).toHaveBeenCalledWith({ output: "boot\n", session_name: "sym-dev" });

    unsubscribe();
    expect(close).toHaveBeenCalled();
  });
});
