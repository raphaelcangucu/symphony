import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import type { SessionTreeGroup } from "./session-tree";
import { SessionLibraryScreen } from "./SessionLibraryScreen";

const groups: SessionTreeGroup[] = [
  {
    key: "project:symphony",
    projectSlug: "symphony",
    title: "symphony",
    count: 2,
    collapsed: false,
    sessions: [
      {
        id: "thread:42",
        threadId: 42,
        projectSlug: "symphony",
        title: "Implement mobile sessions",
        preview: "Continue with the native app",
        issueIdentifier: "MOB-42",
        workspacePath: "/work/symphony",
        updatedAt: "2026-07-24T02:00:00Z",
        agentKind: "codex",
        state: "running",
        pinned: false,
        archived: false,
      },
      {
        id: "thread:41",
        threadId: 41,
        projectSlug: "symphony",
        title: "Review authentication",
        preview: null,
        issueIdentifier: null,
        workspacePath: "/work/symphony",
        updatedAt: "2026-07-24T01:00:00Z",
        agentKind: "codex",
        state: "attention",
        pinned: false,
        archived: false,
      },
    ],
  },
];

function renderScreen(props: Partial<React.ComponentProps<typeof SessionLibraryScreen>> = {}) {
  const defaults: React.ComponentProps<typeof SessionLibraryScreen> = {
    connectionName: "Remote",
    connectionDetail: "raphael",
    connectionState: "live",
    groups,
    query: "",
    loading: false,
    error: null,
    onNewChat: jest.fn(),
    onOpenConnections: jest.fn(),
    onOpenDiagnostics: jest.fn(),
    onOpenNotifications: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenTasks: jest.fn(),
    onOpenSession: jest.fn(),
    onQueryChange: jest.fn(),
    onRefresh: jest.fn(),
    onToggleGroup: jest.fn(),
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <SessionLibraryScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("SessionLibraryScreen", () => {
  it("renders the connection, project groups, and textual session states", () => {
    renderScreen();

    expect(screen.getByText("Remote")).toBeTruthy();
    expect(screen.getByText("raphael")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("symphony")).toBeTruthy();
    expect(screen.getByText("Implement mobile sessions")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });

  it("opens sessions and toggles project groups accessibly", () => {
    const onOpenSession = jest.fn();
    const onToggleGroup = jest.fn();
    renderScreen({ onOpenSession, onToggleGroup });

    fireEvent.press(
      screen.getByRole("button", {
        name: "Open session Implement mobile sessions",
      }),
    );
    fireEvent.press(
      screen.getByRole("button", {
        name: "Collapse symphony project",
      }),
    );

    expect(onOpenSession).toHaveBeenCalledWith(42);
    expect(onToggleGroup).toHaveBeenCalledWith("project:symphony");
  });

  it("keeps search and Chat in the persistent bottom dock", () => {
    const onNewChat = jest.fn();
    const onQueryChange = jest.fn();
    renderScreen({ onNewChat, onQueryChange });

    fireEvent.changeText(screen.getByPlaceholderText("Search chats"), "mobile");
    fireEvent.press(screen.getByRole("button", { name: "Start a new chat" }));

    expect(onQueryChange).toHaveBeenCalledWith("mobile");
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("session-library-dock")).toBeTruthy();
  });

  it("opens the operational menu and routes to Orca-inspired tools", () => {
    const onOpenTasks = jest.fn();
    const onOpenConnections = jest.fn();
    renderScreen({ onOpenTasks, onOpenConnections });

    fireEvent.press(screen.getByRole("button", { name: "Open main menu" }));
    expect(screen.getByTestId("root-menu")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Tasks" }));
    expect(onOpenTasks).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", { name: "Open main menu" }));
    fireEvent.press(screen.getByRole("button", { name: "Connections" }));
    expect(onOpenConnections).toHaveBeenCalledTimes(1);
  });

  it("renders loading and retryable failures without hiding the dock", () => {
    const loading = renderScreen({ groups: [], loading: true });
    expect(loading.getByRole("progressbar")).toBeTruthy();
    expect(loading.getByRole("button", { name: "Start a new chat" })).toBeTruthy();
    loading.unmount();

    const onRefresh = jest.fn();
    renderScreen({
      groups: [],
      loading: false,
      error: "Could not load sessions",
      onRefresh,
    });
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start a new chat" })).toBeTruthy();
  });

  it("shows cached update timestamps when the connection is offline", () => {
    renderScreen({
      connectionState: "offline",
      error: "Tracker offline",
    });

    expect(screen.getByText("Updated 2026-07-24 02:00 UTC")).toBeTruthy();
    expect(screen.getByText("Updated 2026-07-24 01:00 UTC")).toBeTruthy();
  });
});
