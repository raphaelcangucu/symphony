import { act, render, screen } from "@testing-library/react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useHostTransport } from "@/api/HostTransportContext";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { useAppRuntime } from "@/runtime/AppRuntime";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { TerminalRoute } from "./TerminalRoute";

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/api/HostTransportContext", () => ({ useHostTransport: jest.fn() }));
jest.mock("@/api/TrackerClientProvider", () => ({ useTrackerClient: jest.fn() }));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@/runtime/AppRuntime", () => ({ useAppRuntime: jest.fn() }));

const router = { back: jest.fn() };
const createTerminalSession = jest.fn();
const firstSession = terminalSession();
const secondSession = terminalSession();

describe("TerminalRoute", () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ threadId: "42" });
    jest.mocked(useRouter).mockReturnValue(router as never);
    jest.mocked(useTrackerClient).mockReturnValue({} as ReturnType<typeof useTrackerClient>);
    jest.mocked(useHostTransport).mockReturnValue(null);
    jest.mocked(useQuery).mockReturnValue({
      data: { projectSlug: "alpha" },
      isError: false,
    } as ReturnType<typeof useQuery>);
    jest.mocked(useConnection).mockReturnValue(legacyConnection("alpha", "alpha-token"));
    jest.mocked(useAppRuntime).mockReturnValue({
      createTerminalSession,
    } as unknown as ReturnType<typeof useAppRuntime>);
    createTerminalSession.mockReturnValueOnce(firstSession).mockReturnValueOnce(secondSession);
  });

  it("clears terminal output before connecting the same route on another host", () => {
    const view = render(
      <ThemeProvider colorScheme="dark">
        <TerminalRoute />
      </ThemeProvider>,
    );
    const firstOptions = createTerminalSession.mock.calls[0]?.[0];
    act(() => firstOptions?.onOutput("Studio Alpha private terminal output"));
    expect(screen.getByText("Studio Alpha private terminal output")).toBeTruthy();

    jest.mocked(useConnection).mockReturnValue(legacyConnection("beta", "beta-token"));
    jest.mocked(useQuery).mockReturnValue({
      data: { projectSlug: "beta" },
      isError: false,
    } as ReturnType<typeof useQuery>);
    view.rerender(
      <ThemeProvider colorScheme="dark">
        <TerminalRoute />
      </ThemeProvider>,
    );

    expect(screen.queryByText("Studio Alpha private terminal output")).toBeNull();
    expect(firstSession.disconnect).toHaveBeenCalledTimes(1);
    expect(secondSession.connect).toHaveBeenCalledTimes(1);
  });
});

function terminalSession() {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendInput: jest.fn(),
    resize: jest.fn(),
  };
}

function legacyConnection(id: string, token: string): ReturnType<typeof useConnection> {
  return {
    activeProfile: {
      id,
      name: `Studio ${id}`,
      origin: `https://${id}.test`,
      transport: "legacy",
      createdAt: "2026-07-25T12:00:00.000Z",
      lastConnectedAt: null,
    },
    activeToken: token,
  } as ReturnType<typeof useConnection>;
}
