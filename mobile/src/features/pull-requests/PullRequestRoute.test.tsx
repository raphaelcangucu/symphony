import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { PullRequestRoute } from "./PullRequestRoute";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));

describe("PullRequestRoute", () => {
  it("preserves loaded PR state when an operational mutation fails", async () => {
    const updatePullRequestBranch = jest.fn().mockRejectedValue(new Error("Branch has conflicts"));
    jest.mocked(useLocalSearchParams).mockReturnValue({
      projectSlug: "symphony",
      identifier: "MOB-7",
    });
    jest.mocked(useRouter).mockReturnValue({ back: jest.fn() } as never);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTrackerClient).mockReturnValue({
      issuePullRequests: jest.fn().mockResolvedValue({
        supported: true,
        available: true,
        children: [],
        pullRequests: [
          {
            number: 7,
            title: "Complete mobile parity",
            url: "https://github.com/acme/mobile/pull/7",
            state: "open",
            repo: "acme/mobile",
            origin: "auto",
            isDraft: false,
            merged: false,
            headRef: "agent/mobile",
            baseRef: "main",
            author: "raphael",
            mergeable: "CONFLICTING",
            checksState: "failure",
            pipelines: [],
            statuses: [],
            conversation: [],
            baseBehindBy: 2,
          },
        ],
      }),
      updatePullRequestBranch,
      linkIssuePullRequest: jest.fn(),
      unlinkIssuePullRequest: jest.fn(),
      requestPullRequestFix: jest.fn(),
      rerunPullRequestJobs: jest.fn(),
      mergeIssuePullRequest: jest.fn(),
    } as never);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider colorScheme="dark">
          <PullRequestRoute />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("Complete mobile parity");
    fireEvent.press(screen.getByRole("button", { name: "Update branch for PR 7" }));
    expect(await screen.findByText("Branch has conflicts")).toBeTruthy();
    expect(screen.getByText("Complete mobile parity")).toBeTruthy();
    view.unmount();
    queryClient.clear();
  });
});
