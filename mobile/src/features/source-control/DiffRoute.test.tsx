import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { DiffRoute } from "./DiffRoute";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));

describe("DiffRoute", () => {
  it("loads metadata first and fetches a patch only after selection", async () => {
    const threadDiffPatch = jest.fn().mockResolvedValue({
      repo: "mobile",
      path: "src/App.tsx",
      status: "modified",
      binary: false,
      truncated: false,
      patch: "@@ -1 +1 @@\n-old\n+new",
      workspace: { path: "/tmp/mobile", available: true },
    });
    jest.mocked(useLocalSearchParams).mockReturnValue({ threadId: "42" });
    jest.mocked(useRouter).mockReturnValue({ back: jest.fn() } as never);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTrackerClient).mockReturnValue({
      threadDiffStats: jest.fn().mockResolvedValue({
        stats: [
          {
            repo: "mobile",
            branch: "agent/mobile",
            base: "main",
            filesChanged: 1,
            additions: 4,
            deletions: 1,
            untracked: 0,
          },
        ],
        workspace: { path: "/tmp/mobile", available: true },
      }),
      threadDiffFiles: jest.fn().mockResolvedValue({
        files: [
          {
            repo: "mobile",
            path: "src/App.tsx",
            oldPath: null,
            status: "modified",
            additions: 4,
            deletions: 1,
            binary: false,
          },
        ],
        total: 1,
        limit: 50,
        nextCursor: null,
        workspace: { path: "/tmp/mobile", available: true },
      }),
      threadDiffPatch,
      commitThreadDiff: jest.fn(),
      pushThreadDiff: jest.fn(),
    } as never);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider colorScheme="dark">
          <DiffRoute />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(threadDiffPatch).not.toHaveBeenCalled();
    await screen.findByRole("button", { name: "Open diff mobile src/App.tsx" });
    fireEvent.press(screen.getByRole("button", { name: "Open diff mobile src/App.tsx" }));
    await waitFor(() =>
      expect(threadDiffPatch).toHaveBeenCalledWith(
        42,
        { type: "uncommitted", repo: "mobile", path: "src/App.tsx" },
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText("+new")).toBeTruthy();
    view.unmount();
    queryClient.clear();
  });
});
