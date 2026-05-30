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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches issue dev servers on mount", async () => {
    fetchIssueDevServers.mockResolvedValueOnce(readyResponse);

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(readyResponse));
    expect(fetchIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when identifiers are missing", () => {
    const { result } = renderHook(() => useIssueDevServers(null, "MAC-1"));

    expect(fetchIssueDevServers).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("updates data after starting issue dev servers", async () => {
    fetchIssueDevServers.mockResolvedValueOnce(stoppedResponse);
    startIssueDevServers.mockResolvedValueOnce(startingResponse);

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.data).toEqual(stoppedResponse));

    await act(async () => {
      await result.current.start();
    });

    expect(startIssueDevServers).toHaveBeenCalledWith("macro-markets", "MAC-1");
    expect(result.current.data).toEqual(startingResponse);
    expect(result.current.error).toBeNull();
  });

  it("polls while a server is starting", async () => {
    vi.useFakeTimers();
    fetchIssueDevServers.mockResolvedValueOnce(startingResponse).mockResolvedValueOnce(readyResponse);

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await act(async () => {});

    expect(result.current.data).toEqual(startingResponse);
    expect(fetchIssueDevServers).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.data).toEqual(readyResponse);
    expect(fetchIssueDevServers).toHaveBeenCalledTimes(2);
  });

  it("sets error when fetching fails", async () => {
    fetchIssueDevServers.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useIssueDevServers("macro-markets", "MAC-1"));

    await waitFor(() => expect(result.current.error).toBe("Could not load issue dev servers."));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
