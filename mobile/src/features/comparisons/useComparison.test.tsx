import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { HostTransport } from "@/transport/HostTransport";

import type { ComparisonSnapshot } from "./comparison-contract";
import { comparisonQueryKey, useComparison } from "./useComparison";

const persistedSnapshot: ComparisonSnapshot = {
  projectSlug: "dev10x-mobile",
  identifier: "DEV-1",
  title: "Compare Dev10x sites",
  status: "running",
  progress: { terminal: 0, passed: 0, failed: 0, total: 0 },
  cells: [],
  decision: null,
};

describe("useComparison persistence", () => {
  it("uses the selected host namespace so snapshots are included in the durable cache", () => {
    expect(comparisonQueryKey("host-1", "dev10x-mobile", "DEV-1")).toEqual([
      "host",
      "host-1",
      "comparison",
      "dev10x-mobile",
      "DEV-1",
    ]);
  });

  it("reacts when a persisted snapshot hydrates after the route mounts", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const transport = pendingTransport();
    const { result } = renderHook(
      () =>
        useComparison({
          transport,
          projectSlug: "dev10x-mobile",
          identifier: "DEV-1",
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.snapshot).toBeNull();

    act(() => {
      queryClient.setQueryData(
        comparisonQueryKey("host-1", "dev10x-mobile", "DEV-1"),
        persistedSnapshot,
      );
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(persistedSnapshot));
  });
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function pendingTransport(): HostTransport {
  return {
    hostId: "host-1",
    call: jest.fn(() => new Promise(() => undefined)),
    subscribe: jest.fn(async () => jest.fn()),
    reconnect: jest.fn(),
    deactivate: jest.fn(),
    close: jest.fn(),
  };
}
