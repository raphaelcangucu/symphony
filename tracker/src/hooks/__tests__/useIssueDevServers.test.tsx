import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import * as issueDevServersService from "@/services/issueDevServers";
import type { IssueDevServersResponse } from "@/types/issue";

vi.mock("@/services/issueDevServers", () => ({
  fetchIssueDevServers: vi.fn(),
  restartIssueDevServers: vi.fn(),
  startIssueDevServers: vi.fn(),
  stopIssueDevServers: vi.fn(),
  startPublicTunnel: vi.fn(),
  subscribeIssueDevServers: vi.fn(),
}));

const readyResponse: IssueDevServersResponse = {
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
      session_name: "sym-issue-macro-markets-MAC-1-web",
    },
  ],
};

const stoppedResponse: IssueDevServersResponse = {
  available: true,
  reason: null,
  servers: [
    {
      ...readyResponse.servers[0],
      port: null,
      url: null,
      status: "stopped",
      session_name: null,
    },
  ],
};

const startingResponse: IssueDevServersResponse = {
  available: true,
  reason: null,
  servers: [
    {
      ...readyResponse.servers[0],
      port: null,
      url: null,
      status: "starting",
      session_name: "sym-issue-macro-markets-MAC-1-web",
    },
  ],
};

describe("useIssueDevServers", () => {
  const fetchIssueDevServers = vi.mocked(issueDevServersService.fetchIssueDevServers);
  const startIssueDevServers = vi.mocked(issueDevServersService.startIssueDevServers);
  const subscribeIssueDevServers = vi.mocked(issueDevServersService.subscribeIssueDevServers);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    subscribeIssueDevServers.mockImplementation((_projectSlug, _issueIdentifier, handlers) => {
      handlers.onSnapshot(readyResponse);
      return () => undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("receives the initial snapshot from the SSE stream", async () => {
    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(readyResponse));
    expect(subscribeIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1", expect.any(Object));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not subscribe when identifiers are missing", () => {
    const { result } = renderHook(() => useIssueDevServers(null, "MAC-1"));

    expect(subscribeIssueDevServers).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("updates data after starting issue dev servers", async () => {
    startIssueDevServers.mockResolvedValueOnce(startingResponse);

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(readyResponse));

    await act(async () => {
      await result.current.start();
    });

    expect(startIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");
    expect(result.current.data).toEqual(startingResponse);
    expect(result.current.error).toBeNull();
  });

  it("does not start another action while one is already in flight", async () => {
    const startDeferred = createDeferred<IssueDevServersResponse>();
    startIssueDevServers.mockReturnValue(startDeferred.promise);

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(readyResponse));

    let firstStart: Promise<void>;
    let secondStart: Promise<void>;
    act(() => {
      firstStart = result.current.start();
      secondStart = result.current.start();
    });

    expect(startIssueDevServers).toHaveBeenCalledTimes(1);

    await act(async () => {
      startDeferred.resolve(startingResponse);
      await firstStart;
      await secondStart;
    });
  });

  it("does not let a stale action clear the current issue action guard", async () => {
    const issueAStart = createDeferred<IssueDevServersResponse>();
    const issueBStart = createDeferred<IssueDevServersResponse>();
    startIssueDevServers.mockReturnValueOnce(issueAStart.promise).mockReturnValueOnce(issueBStart.promise);

    const { rerender, result } = renderHook(
      ({ issueIdentifier }) => useIssueDevServers("macro-markets", issueIdentifier),
      { initialProps: { issueIdentifier: "MAC-1" } },
    );

    await waitFor(() => expect(result.current.data).toEqual(readyResponse));

    let issueAStartPromise: Promise<void>;
    act(() => {
      issueAStartPromise = result.current.start();
    });
    expect(startIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");

    rerender({ issueIdentifier: "MAC-2" });
    await waitFor(() => expect(subscribeIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-2", expect.any(Object)));

    let issueBStartPromise: Promise<void>;
    act(() => {
      issueBStartPromise = result.current.start();
    });
    expect(startIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-2");
    expect(startIssueDevServers).toHaveBeenCalledTimes(2);

    await act(async () => {
      issueAStart.resolve(startingResponse);
      await issueAStartPromise;
    });

    act(() => {
      void result.current.start();
    });

    expect(startIssueDevServers).toHaveBeenCalledTimes(2);

    await act(async () => {
      issueBStart.resolve(startingResponse);
      await issueBStartPromise;
    });
  });

  it("applies live SSE updates", async () => {
    let emitUpdate: (() => void) | undefined;
    subscribeIssueDevServers.mockImplementation((_projectSlug, _issueIdentifier, handlers) => {
      handlers.onSnapshot(stoppedResponse);
      emitUpdate = () => handlers.onUpdate(startingResponse);
      return () => undefined;
    });

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(stoppedResponse));

    act(() => {
      emitUpdate?.();
    });

    expect(result.current.data).toEqual(startingResponse);
  });

  it("falls back to REST when the SSE stream fails", async () => {
    fetchIssueDevServers.mockResolvedValueOnce(stoppedResponse);
    subscribeIssueDevServers.mockImplementation((_projectSlug, _issueIdentifier, handlers) => {
      handlers.onError?.();
      return () => undefined;
    });

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(stoppedResponse));
    expect(fetchIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");
  });

  it("sets error when fetching fails after SSE fallback", async () => {
    fetchIssueDevServers.mockRejectedValueOnce(new Error("boom"));
    subscribeIssueDevServers.mockImplementation((_projectSlug, _issueIdentifier, handlers) => {
      handlers.onError?.();
      return () => undefined;
    });

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.error).toBe("Could not load issue dev servers."));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}
