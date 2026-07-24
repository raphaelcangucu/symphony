import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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

const router = { back: jest.fn(), replace: jest.fn() };
const session = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(undefined),
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

  it("connects the route, consumes the seed after acceptance, and disconnects", () => {
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
    expect(router.replace).toHaveBeenCalledWith("/session/42");

    view.unmount();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
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
