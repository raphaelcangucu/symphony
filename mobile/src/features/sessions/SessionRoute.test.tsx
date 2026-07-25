import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useConnection } from "@/auth/ConnectionProvider";
import { createAssistantSession } from "@/realtime/assistant-session";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { SessionRoute } from "./SessionRoute";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));
jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));
jest.mock("@/realtime/assistant-session", () => ({
  createAssistantSession: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const router = { back: jest.fn(), replace: jest.fn() };
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
    expect(screen.getByText("Ready")).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("Message"), "Continue");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    expect(session.sendMessage).toHaveBeenCalledWith("Continue");
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveProp("value", ""));
  });
});
