import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return {
    ...actual,
    getTrackerToken: vi.fn(() => "secret"),
  };
});

import { http } from "@/services/http";
import {
  fetchThreadDevServers,
  startThreadDevServer,
  subscribeThreadDevServers,
} from "@/services/threadDevServers";
import type { IssueDevServersResponse } from "@/types/issue";

describe("thread dev-server service", () => {
  const response: IssueDevServersResponse = {
    available: true,
    reason: null,
    servers: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses thread-scoped fetch and server-action routes", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: response } });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    await expect(fetchThreadDevServers(42)).resolves.toEqual(response);
    await expect(startThreadDevServer(42, 7)).resolves.toEqual(response);

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/42/dev_servers");
    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/assistant/threads/42/dev_servers/7/start",
    );
  });

  it("rejects invalid thread ids before calling the API", async () => {
    const get = vi.spyOn(http, "get");

    await expect(fetchThreadDevServers(0)).rejects.toThrow(/threadId/);
    expect(get).not.toHaveBeenCalled();
  });

  it("subscribes to the thread-scoped event stream with token auth", () => {
    const close = vi.fn();
    let createdUrl = "";

    class MockEventSource {
      addEventListener = vi.fn();
      close = close;
      onerror: (() => void) | null = null;

      constructor(url: string) {
        createdUrl = url;
      }
    }

    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    const unsubscribe = subscribeThreadDevServers(42, {
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
    });

    expect(new URL(createdUrl).pathname).toBe(
      "/api/tracker/v1/assistant/threads/42/dev_servers/events",
    );
    expect(new URL(createdUrl).searchParams.get("token")).toBe("secret");

    unsubscribe();
    expect(close).toHaveBeenCalled();
  });
});
