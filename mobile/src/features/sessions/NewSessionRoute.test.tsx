import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import type { TrackerClient } from "@/api/contracts";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { NewSessionRoute } from "./NewSessionRoute";

jest.mock("expo-router", () => ({ useLocalSearchParams: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const router = { back: jest.fn(), replace: jest.fn() };

function createClient(): jest.Mocked<TrackerClient> {
  return {
    health: jest.fn(),
    viewer: jest.fn(),
    projects: jest
      .fn()
      .mockResolvedValue([{ id: "project-1", slug: "symphony", name: "Symphony" }]),
    threads: jest.fn(),
    projectSessions: jest.fn(),
    assistantCatalog: jest.fn().mockResolvedValue({
      defaultAgent: "codex",
      agents: [],
    }),
    createThread: jest.fn().mockResolvedValue({
      id: 42,
      scope: "freeform",
      projectSlug: null,
      projectName: null,
      issueIdentifier: null,
      workspacePath: null,
      title: null,
      status: "idle",
      preview: null,
      updatedAt: "2026-07-24T02:00:00Z",
      agentKind: "codex",
      needsReview: false,
    }),
  };
}

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider colorScheme="dark">
          <NewSessionRoute />
        </ThemeProvider>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

describe("NewSessionRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue(router as never);
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: {
        id: "remote-1",
        name: "Remote",
        origin: "https://demo.test",
        createdAt: "2026-07-24T00:00:00Z",
        lastConnectedAt: null,
      },
    } as ReturnType<typeof useConnection>);
    jest.mocked(useTrackerClient).mockReturnValue(createClient());
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue();
    jest.mocked(AsyncStorage.removeItem).mockResolvedValue();
  });

  it("keeps the profile draft until the created session accepts its seed", async () => {
    const view = renderRoute();
    const message = await screen.findByLabelText("Message");

    fireEvent.changeText(message, "Build clean & fast");
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "symphony.new-session.draft.remote-1",
        expect.stringContaining("Build clean & fast"),
      ),
    );
    fireEvent.press(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/codex/session/42?seed=Build%20clean%20%26%20fast",
      ),
    );
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    view.queryClient.clear();
  });

  it("prefills an ordinary task issue session with its persisted agent settings", async () => {
    const client = createClient();
    client.assistantCatalog.mockResolvedValue({
      defaultAgent: "codex",
      agents: [
        {
          agent: "claude",
          agentLabel: "Claude",
          defaultModel: "claude-opus-5",
          models: [
            {
              model: "claude-opus-5",
              label: "Opus 5",
              efforts: [{ effort: "high", label: "High" }],
            },
          ],
        },
      ],
    });
    jest.mocked(useTrackerClient).mockReturnValue(client);
    jest.mocked(useLocalSearchParams).mockReturnValue({
      projectSlug: "symphony",
      issueIdentifier: "MOB-7",
      agentKind: "claude",
      model: "claude-opus-5",
      effort: "high",
    });

    const view = renderRoute();
    await screen.findByLabelText("Message");
    fireEvent.changeText(screen.getByLabelText("Message"), "Build the site");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(client.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "issue_session",
          projectSlug: "symphony",
          issueIdentifier: "MOB-7",
          isolatedWorkspace: true,
          agentKind: "claude",
          model: "claude-opus-5",
          effort: "high",
        }),
      ),
    );
    view.queryClient.clear();
  });
});
