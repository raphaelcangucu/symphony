import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { ConnectionGate } from "./ConnectionGate";

const mockUseConnection = jest.fn();

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => mockUseConnection(),
}));

jest.mock("expo-router", () => {
  const React = require("react");
  const { Text: NativeText } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(NativeText, null, `redirect:${href}`),
  };
});

function renderGate() {
  return render(
    <ThemeProvider colorScheme="dark">
      <ConnectionGate>
        <Text>Session library</Text>
      </ConnectionGate>
    </ThemeProvider>,
  );
}

describe("ConnectionGate", () => {
  it("waits for secure connection hydration", () => {
    mockUseConnection.mockReturnValue({
      hydrated: false,
      activeProfile: null,
    });

    renderGate();

    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByText("redirect:/connect")).toBeNull();
  });

  it("redirects to connection setup without an active profile", () => {
    mockUseConnection.mockReturnValue({
      hydrated: true,
      activeProfile: null,
    });

    renderGate();

    expect(screen.getByText("redirect:/connect")).toBeTruthy();
  });

  it("renders the session library for an active profile", () => {
    mockUseConnection.mockReturnValue({
      hydrated: true,
      activeProfile: { id: "profile-1", name: "Remote" },
    });

    renderGate();

    expect(screen.getByText("Session library")).toBeTruthy();
  });
});
