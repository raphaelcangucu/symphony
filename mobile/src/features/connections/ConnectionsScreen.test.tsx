import { fireEvent, render, screen } from "@testing-library/react-native";

import type { ConnectionProfile } from "@/auth/connection-profile";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { ConnectionsScreen } from "./ConnectionsScreen";

const profiles: ConnectionProfile[] = [
  {
    id: "profile-1",
    name: "Remote",
    origin: "https://demo.test",
    createdAt: "2026-07-24T00:00:00Z",
    lastConnectedAt: "2026-07-24T01:00:00Z",
  },
  {
    id: "profile-2",
    name: "Local",
    origin: "http://127.0.0.1:4000",
    createdAt: "2026-07-24T00:00:00Z",
    lastConnectedAt: null,
  },
];

function renderScreen(props: Partial<React.ComponentProps<typeof ConnectionsScreen>> = {}) {
  const defaults: React.ComponentProps<typeof ConnectionsScreen> = {
    activeProfileId: "profile-1",
    busyProfileId: null,
    error: null,
    health: { "profile-1": "live", "profile-2": "offline" },
    onAdd: jest.fn(),
    onBack: jest.fn(),
    onReconnect: jest.fn(),
    onRemove: jest.fn(),
    onReplaceToken: jest.fn(),
    onSelect: jest.fn(),
    profiles,
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <ConnectionsScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("ConnectionsScreen", () => {
  it("switches, reconnects, replaces a token, and removes profiles", () => {
    const onSelect = jest.fn();
    const onReconnect = jest.fn();
    const onReplaceToken = jest.fn();
    const onRemove = jest.fn();
    renderScreen({ onReconnect, onRemove, onReplaceToken, onSelect });

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Use Local" }));
    fireEvent.press(screen.getByRole("button", { name: "Reconnect Local" }));
    fireEvent.press(screen.getByRole("button", { name: "Replace token for Local" }));
    fireEvent.changeText(screen.getByLabelText("New token for Local"), "new-secret");
    fireEvent.press(screen.getByRole("button", { name: "Save token for Local" }));
    fireEvent.press(screen.getByRole("button", { name: "Remove Local" }));

    expect(onSelect).toHaveBeenCalledWith("profile-2");
    expect(onReconnect).toHaveBeenCalledWith("profile-2");
    expect(onReplaceToken).toHaveBeenCalledWith("profile-2", "new-secret");
    expect(onRemove).toHaveBeenCalledWith("profile-2");
  });

  it("retains profiles while presenting a recoverable error", () => {
    renderScreen({ error: "Server is offline" });
    expect(screen.getByText("Remote")).toBeTruthy();
    expect(screen.getByText("Server is offline")).toBeTruthy();
  });
});
