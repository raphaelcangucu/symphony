import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useConnection } from "@/auth/ConnectionProvider";
import { createAssistantSession } from "@/realtime/assistant-session";
import { createRpcAssistantSession } from "@/realtime/rpc-assistant-session";
import { useHostRuntime } from "@/runtime/HostRuntimeProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { HostSessionRoute, SessionRoute } from "./SessionRoute";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@/realtime/assistant-session", () => ({
  createAssistantSession: jest.fn(),
}));
jest.mock("@/realtime/rpc-assistant-session", () => ({
  createRpcAssistantSession: jest.fn(),
}));
jest.mock("@/runtime/HostRuntimeProvider", () => ({
  useHostRuntime: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const router = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const session = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(undefined),
  retrySeed: jest.fn().mockResolvedValue(undefined),
  resumeTurn: jest.fn().mockResolvedValue(undefined),
  stopTurn: jest.fn().mockResolvedValue(undefined),
  submitApproval: jest.fn().mockResolvedValue(undefined),
  submitUserInput: jest.fn().mockResolvedValue(undefined),
};

describe("SessionRoute", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue(router as never);
    jest.mocked(useLocalSearchParams).mockReturnValue({
      threadId: "42",
      seed: "Build it",
    });
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
    jest.mocked(createAssistantSession).mockReturnValue(session);
    jest.mocked(createRpcAssistantSession).mockReturnValue(session);
    jest.mocked(useHostRuntime).mockReturnValue({
      transport: jest.fn().mockReturnValue(null),
    } as never);
  });

  it("connects the route, clears the draft only after seed acceptance, and disconnects", async () => {
    const view = render(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );

    expect(createAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 42,
        origin: "https://demo.test",
        token: "secret",
        seed: "Build it",
      }),
    );
    expect(session.connect).toHaveBeenCalledTimes(1);
    const options = jest.mocked(createAssistantSession).mock.calls[0]?.[0];
    act(() => options?.onSeedAccepted?.());
    await waitFor(() =>
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith("symphony.new-session.draft.remote-1"),
    );
    expect(router.replace).toHaveBeenCalledWith("/session/42");

    view.unmount();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
  });

  it("consumes the route seed even when draft cleanup fails", async () => {
    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error("storage unavailable"));
    render(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );
    const options = jest.mocked(createAssistantSession).mock.calls[0]?.[0];
    act(() => options?.onSeedAccepted?.());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/session/42"));
  });

  it("surfaces an explicit seed retry after a push failure", async () => {
    render(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );
    const options = jest.mocked(createAssistantSession).mock.calls[0]?.[0];
    act(() => options?.onAction({ type: "error", message: "Message send timed out" }));

    fireEvent.press(screen.getByRole("button", { name: "Retry first message" }));
    await waitFor(() => expect(session.retrySeed).toHaveBeenCalledTimes(1));
  });

  it("forwards channel actions to the screen and sends follow-ups", async () => {
    render(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );
    const options = jest.mocked(createAssistantSession).mock.calls[0]?.[0];
    act(() =>
      options?.onAction({
        type: "history_loaded",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "Ready",
            toolCalls: [],
            insertedAt: null,
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText("Message"), "Continue");
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveProp("value", "Continue"));
    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(session.sendMessage).toHaveBeenCalledWith("Continue"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveProp("value", ""));
  });

  it("clears the previous host timeline before connecting the same route on another host", async () => {
    const firstSession = { ...session, connect: jest.fn(), disconnect: jest.fn() };
    const secondSession = { ...session, connect: jest.fn(), disconnect: jest.fn() };
    jest
      .mocked(createAssistantSession)
      .mockReturnValueOnce(firstSession)
      .mockReturnValueOnce(secondSession);
    const view = render(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );
    const firstOptions = jest.mocked(createAssistantSession).mock.calls[0]?.[0];
    act(() =>
      firstOptions?.onAction({
        type: "history_loaded",
        messages: [
          {
            id: "alpha-message",
            role: "assistant",
            content: "Studio Alpha private history",
            toolCalls: [],
            insertedAt: null,
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText("Studio Alpha private history")).toBeTruthy());

    jest.mocked(useConnection).mockReturnValue({
      activeProfile: {
        id: "remote-2",
        name: "Remote Beta",
        origin: "https://beta.test",
        createdAt: "2026-07-24T00:00:00Z",
        lastConnectedAt: null,
      },
      activeToken: "beta-secret",
    } as ReturnType<typeof useConnection>);
    view.rerender(
      <ThemeProvider colorScheme="dark">
        <SessionRoute />
      </ThemeProvider>,
    );

    expect(screen.queryByText("Studio Alpha private history")).toBeNull();
    expect(firstSession.disconnect).toHaveBeenCalledTimes(1);
    expect(secondSession.connect).toHaveBeenCalledTimes(1);
  });

  it("opens a paired host thread as chat and keeps terminal as an explicit action", async () => {
    const transport = { hostId: "host-1" };
    jest.mocked(useLocalSearchParams).mockReturnValue({
      hostId: "host-1",
      threadId: "42",
      name: "Studio Alpha",
    });
    jest.mocked(useConnection).mockReturnValue({
      hydrated: true,
      profiles: [
        {
          id: "profile-1",
          hostId: "host-1",
          name: "Studio Alpha",
          origin: "wss://studio.test/mobile",
          endpoint: "wss://studio.test/mobile",
          hostPublicKeyFingerprint: "fingerprint",
          protocolVersion: 1,
          transport: "rpc",
          createdAt: "2026-07-24T00:00:00Z",
          lastConnectedAt: null,
        },
      ],
    } as ReturnType<typeof useConnection>);
    jest.mocked(useHostRuntime).mockReturnValue({
      transport: jest.fn().mockReturnValue(transport),
    } as never);

    render(
      <ThemeProvider colorScheme="dark">
        <HostSessionRoute />
      </ThemeProvider>,
    );

    expect(createRpcAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 42, transport }),
    );
    expect(screen.getByText("Studio Alpha")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Open terminal" }));
    expect(router.push).toHaveBeenCalledWith("/h/host-1/session/42?name=Studio%20Alpha");
  });
});
