import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useThreadDevServers } from "@/hooks/useThreadDevServers";
import * as threadDevServersService from "@/services/threadDevServers";
import type { IssueDevServersResponse } from "@/types/issue";

vi.mock("@/services/threadDevServers", () => ({
  fetchThreadDevServers: vi.fn(),
  restartThreadDevServer: vi.fn(),
  restartThreadDevServers: vi.fn(),
  startThreadDevServer: vi.fn(),
  startThreadDevServers: vi.fn(),
  stopThreadDevServer: vi.fn(),
  stopThreadDevServers: vi.fn(),
  subscribeThreadDevServers: vi.fn(),
}));

const stoppedResponse: IssueDevServersResponse = {
  available: true,
  reason: null,
  servers: [
    {
      id: 7,
      slug: "web",
      working_dir: "tracker",
      port: null,
      url: null,
      status: "stopped",
      primary: true,
      session_name: null,
    },
  ],
};

const startingResponse: IssueDevServersResponse = {
  ...stoppedResponse,
  servers: [{ ...stoppedResponse.servers[0], status: "starting" }],
};

describe("useThreadDevServers", () => {
  const subscribeThreadDevServers = vi.mocked(
    threadDevServersService.subscribeThreadDevServers,
  );
  const startThreadDevServers = vi.mocked(threadDevServersService.startThreadDevServers);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    subscribeThreadDevServers.mockImplementation((_threadId, handlers) => {
      handlers.onSnapshot(stoppedResponse);
      return () => undefined;
    });
  });

  it("subscribes and starts dev servers through the thread scope", async () => {
    startThreadDevServers.mockResolvedValueOnce(startingResponse);
    const { result } = renderHook(() => useThreadDevServers(42));

    await waitFor(() => expect(result.current.data).toEqual(stoppedResponse));
    expect(subscribeThreadDevServers).toHaveBeenCalledWith(42, expect.any(Object));

    await act(async () => {
      await result.current.start();
    });

    expect(startThreadDevServers).toHaveBeenCalledWith(42);
    expect(result.current.data).toEqual(startingResponse);
  });
});
