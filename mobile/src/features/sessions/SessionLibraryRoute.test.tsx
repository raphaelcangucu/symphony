import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { SessionLibraryRoute } from "./SessionLibraryRoute";
import { useSessionLibrary } from "./useSessionLibrary";

jest.mock("expo-router", () => ({ useRouter: jest.fn() }));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("./useSessionLibrary", () => ({ useSessionLibrary: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const push = jest.fn();
const client = {} as ReturnType<typeof useTrackerClient>;

describe("SessionLibraryRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useTrackerClient).mockReturnValue(client);
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: {
        id: "remote-1",
        name: "Remote",
        origin: "https://demo.test",
        createdAt: "2026-07-24T00:00:00Z",
        lastConnectedAt: null,
      },
      activeToken: "secret",
    } as ReturnType<typeof useConnection>);
    jest.mocked(useSessionLibrary).mockReturnValue({
      groups: [
        {
          key: "project:symphony",
          projectSlug: "symphony",
          title: "Symphony",
          count: 1,
          collapsed: false,
          sessions: [
            {
              id: "thread:42",
              threadId: 42,
              projectSlug: "symphony",
              title: "Mobile session library",
              preview: null,
              issueIdentifier: null,
              workspacePath: "/work/symphony",
              updatedAt: "2026-07-24T02:00:00Z",
              agentKind: "codex",
              state: "running",
              pinned: false,
              archived: false,
            },
          ],
        },
      ],
      loading: false,
      refreshing: false,
      error: null,
      viewerName: "Raphael",
      refresh: jest.fn(),
    });
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue();
  });

  it("navigates from Chat and a session row to their focused routes", async () => {
    render(
      <ThemeProvider colorScheme="dark">
        <SessionLibraryRoute />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Start a new chat" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session Mobile session library" }));

    expect(push).toHaveBeenNthCalledWith(1, "/codex/new-session");
    expect(push).toHaveBeenNthCalledWith(2, "/codex/session/42");
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1));
  });

  it("restores and persists collapsed project slugs per connection", async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('["symphony"]');

    render(
      <ThemeProvider colorScheme="dark">
        <SessionLibraryRoute />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(useSessionLibrary).toHaveBeenLastCalledWith(
        expect.objectContaining({
          collapsedProjectSlugs: new Set(["symphony"]),
        }),
      ),
    );
    fireEvent.press(screen.getByRole("button", { name: "Collapse Symphony project" }));

    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "symphony.session-library.collapsed.remote-1",
        JSON.stringify([]),
      ),
    );
  });
});
